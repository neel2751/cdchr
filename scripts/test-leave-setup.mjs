/**
 * Leave setup, and what it makes the rest of the leave module do.
 *
 * scripts/test-leave-entitlement.mjs covers the arithmetic. This covers the part
 * that needs a database and a session: a brand new company choosing its leave
 * year and leave types, the entitlements that choice produces, and what a staff
 * import does before and after it has been made.
 *
 * Section C is the regression that mattered most. `getLeaveSettings()` returns
 * `{ success, data }`, and four call sites read `settings.leaveYearStartMonth`
 * straight off the wrapper — always undefined, always falling back to April. A
 * company on a January leave year therefore had its entitlements filed under one
 * set of twelve months and read back under another, so everybody appeared to
 * have no leave at all.
 *
 * Needs a LOCAL database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-leave-setup.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

const uniq = () => Math.random().toString(36).slice(2, 8);
const d = (text) => {
  const [y, m, day] = text.split("-").map(Number);
  return new Date(y, m - 1, day);
};

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database. This script writes.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const { actAs } = await import("@/scripts/lib/session-stub");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const Company = (await import("@/models/companyModel")).default;
  const RoleType = (await import("@/models/roleTypeModel")).default;
  const OfficeEmploye = (await import("@/models/officeEmployeeModel")).default;
  const LeaveCategory = (await import("@/models/leaveCategoryModel")).default;
  const LeaveSetting = (await import("@/models/leaveSettingModel")).default;
  const CommonLeave = (await import("@/models/commonLeaveModel")).default;
  const {
    completeLeaveSetup,
    generateEntitlementsForEveryone,
    getLeaveConfiguredState,
    getLeaveSetupState,
    previewEntitlements,
  } = await import("@/server/leaveServer/leaveSetupServer");
  const { commitMigration, analyseMigration } = await import(
    "@/server/migrationServer/migrationServer"
  );

  const run = uniq();
  const email = (name) => `${name}.${run}@leave-test.invalid`;

  /** A fresh company with one employee, so each section starts clean. */
  async function newCompany({ joinDate = d("2020-01-01"), dayPerWeek = 5 } = {}) {
    const company = await Company.create({ name: `Leave Test ${run}-${uniq()}` });
    const tenantId = String(company._id);

    const department = await runWithTenant(tenantId, () =>
      RoleType.create({
        roleTitle: `Operations ${uniq()}`,
        isActive: true,
        delete: false,
      })
    );

    const founderEmail = email(`founder-${uniq()}`);
    const founder = await runWithTenant(tenantId, () =>
      OfficeEmploye.create({
        name: "Founder",
        email: founderEmail,
        phoneNumber: Number(`77${Math.floor(Math.random() * 100000000)}`),
        password: "$2a$10$notarealhashnotarealhashno",
        roleType: "Manager",
        department: department._id,
        company: company._id,
        employeType: "Full-Time",
        immigrationType: "British",
        joinDate,
        dayPerWeek,
        isActive: true,
        isSuperAdmin: true,
        delete: false,
      })
    );

    const superAdmin = {
      _id: String(founder._id),
      name: "Founder",
      email: founderEmail,
      role: "superAdmin",
      tenantId,
    };

    return { company, tenantId, department, founder, superAdmin };
  }

  /** Run an action as this company's super admin. */
  const as = (ctx, fn) => {
    actAs(ctx.superAdmin);
    return runWithTenant(ctx.tenantId, fn);
  };

  const parse = (response) => {
    assert.ok(response?.success, response?.message);
    return JSON.parse(response.data);
  };

  const tenants = [];
  const track = (ctx) => {
    tenants.push(ctx.tenantId);
    return ctx;
  };

  /* ---------------------------------------------------------------------- */
  /* A. Authorisation                                                        */
  /* ---------------------------------------------------------------------- */

  const authCtx = track(await newCompany());

  await check("A1 signed out cannot set leave up", async () => {
    actAs(null);
    const response = await runWithTenant(authCtx.tenantId, () =>
      completeLeaveSetup({ leaveYearStartMonth: 1 })
    );
    assert.equal(response.success, false);
  });

  await check("A2 an admin cannot set leave up", async () => {
    actAs({ ...authCtx.superAdmin, role: "admin" });
    const response = await runWithTenant(authCtx.tenantId, () =>
      completeLeaveSetup({ leaveYearStartMonth: 1 })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /super admin/i);
  });

  await check("A3 a nonsense month is refused", async () => {
    for (const month of [0, 13, null, "April"]) {
      const response = await as(authCtx, () =>
        completeLeaveSetup({ leaveYearStartMonth: month })
      );
      assert.equal(response.success, false, `month ${month}`);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* B. A brand new company                                                  */
  /* ---------------------------------------------------------------------- */

  const fresh = track(await newCompany());

  await check("B1 a new company is reported as not set up", async () => {
    const state = parse(await as(fresh, () => getLeaveSetupState()));
    assert.equal(state.configured, false);
    // The document exists with April defaults because reading it creates one —
    // which is exactly why its existence cannot be the flag.
    assert.equal(state.leaveYearStartMonth, 4);
    assert.equal(state.catalogue.every((type) => !type.exists), true);
    assert.ok(state.staff.eligible >= 1);
    assert.equal(state.staff.missing, state.staff.eligible);
  });

  await check("B2 A NEW COMPANY HAS NO LEAVE TYPES AT ALL", async () => {
    // The state the setup screen exists to fix: leave "works" via a hard-coded
    // fallback, but the Category screen is empty and nothing can be edited.
    const count = await runWithTenant(fresh.tenantId, () =>
      LeaveCategory.countDocuments({ isDeleted: false })
    );
    assert.equal(count, 0);
  });

  await check("B3 setup creates the required types and marks it configured", async () => {
    const result = parse(
      await as(fresh, () =>
        completeLeaveSetup({
          leaveYearStartMonth: 4,
          leaveTypeKeys: ["bereavement"],
        })
      )
    );

    // The five required ones go in whether or not they were asked for.
    for (const name of [
      "Annual Leave",
      "Sick Leave",
      "Unpaid Leave",
      "Maternity Leave",
      "Paternity Leave",
      "Bereavement Leave",
    ]) {
      assert.ok(result.created.includes(name), `${name} was not created`);
    }

    const settings = await runWithTenant(fresh.tenantId, () =>
      LeaveSetting.findOne().lean()
    );
    assert.ok(settings.configuredAt, "configuredAt was not set");
    assert.equal(String(settings.configuredBy), String(fresh.founder._id));
  });

  await check("B4 the computed types are locked against editing", async () => {
    const annual = await runWithTenant(fresh.tenantId, () =>
      LeaveCategory.findOne({ leaveType: "Annual Leave" }).lean()
    );
    const unpaid = await runWithTenant(fresh.tenantId, () =>
      LeaveCategory.findOne({ leaveType: "Unpaid Leave" }).lean()
    );
    // Annual leave comes from the contract, not from a number somebody types.
    assert.equal(annual.isEditable, false);
    assert.equal(unpaid.isEditable, true);
  });

  await check("B5 setup builds the founder's entitlement from their start date", async () => {
    const entitlement = await runWithTenant(fresh.tenantId, () =>
      CommonLeave.findOne({ employeeId: fresh.founder._id }).lean()
    );
    assert.ok(entitlement, "no entitlement was created");
    const annual = entitlement.leaveData.find(
      (row) => row.leaveType === "Annual Leave"
    );
    // Joined 2020, so a full year: 5.6 × 5.
    assert.equal(annual.total, 28);
    assert.equal(annual.remaining, 28);
    assert.equal(annual.used, 0);
  });

  await check("B6 running setup again adds nothing and overwrites nothing", async () => {
    const before = await runWithTenant(fresh.tenantId, () =>
      LeaveCategory.countDocuments({ isDeleted: false })
    );
    const result = parse(
      await as(fresh, () =>
        completeLeaveSetup({ leaveYearStartMonth: 4, leaveTypeKeys: ["bereavement"] })
      )
    );
    assert.equal(result.created.length, 0);
    assert.ok(result.skipped.includes("Annual Leave"));
    const after = await runWithTenant(fresh.tenantId, () =>
      LeaveCategory.countDocuments({ isDeleted: false })
    );
    assert.equal(after, before);
    assert.equal(result.entitlements.created, 0);
    assert.ok(result.entitlements.skipped >= 1);
  });

  await check("B7 an unrecognised leave type key is ignored, not trusted", async () => {
    const result = parse(
      await as(fresh, () =>
        completeLeaveSetup({
          leaveYearStartMonth: 4,
          leaveTypeKeys: ["'; DROP TABLE", "nonsense", "__proto__"],
        })
      )
    );
    assert.equal(result.created.length, 0);
    const names = await runWithTenant(fresh.tenantId, () =>
      LeaveCategory.find({ isDeleted: false }).select("leaveType").lean()
    );
    assert.ok(
      names.every((row) => !row.leaveType.includes("DROP")),
      "a made-up category was created"
    );
  });

  /* ---------------------------------------------------------------------- */
  /* C. The leave year a company actually chose                              */
  /* ---------------------------------------------------------------------- */

  const jan = track(await newCompany({ joinDate: d("2020-01-01") }));

  await check("C1 A JANUARY COMPANY FILES ENTITLEMENTS UNDER ITS OWN YEAR", async () => {
    parse(await as(jan, () => completeLeaveSetup({ leaveYearStartMonth: 1 })));

    const state = parse(await as(jan, () => getLeaveConfiguredState()));
    assert.equal(state.configured, true);
    assert.equal(state.leaveYearStartMonth, 1);

    const entitlement = await runWithTenant(jan.tenantId, () =>
      CommonLeave.findOne({ employeeId: jan.founder._id }).lean()
    );
    assert.ok(entitlement, "no entitlement was created");
    // The leave year the company chose, not the April one it never asked for.
    assert.equal(entitlement.leaveYear, state.leaveYear);

    const thisYear = new Date().getFullYear();
    assert.equal(
      entitlement.leaveYear,
      `${thisYear}-${String(thisYear + 1).slice(-2)}`,
      "a January leave year should be named for the calendar year it starts in"
    );
  });

  await check("C2 syncing a second time finds the entitlement it just made", async () => {
    // The regression: syncMissingLeaveTypesNew looked under the April year, saw
    // nothing, and tried to create a duplicate under a different key.
    const { syncMissingLeaveTypesNew } = await import(
      "@/server/leaveServer/countLeaveServer"
    );
    const response = await as(jan, () =>
      syncMissingLeaveTypesNew(jan.founder.joinDate, 5, jan.founder._id)
    );
    assert.ok(response.success, response.message);

    const count = await runWithTenant(jan.tenantId, () =>
      CommonLeave.countDocuments({ employeeId: jan.founder._id })
    );
    assert.equal(count, 1, "a second entitlement row was created");
  });

  /* ---------------------------------------------------------------------- */
  /* D. Pro-rata, end to end                                                 */
  /* ---------------------------------------------------------------------- */

  await check("D1 a mid-year joiner is pro-rated, and told why", async () => {
    const ctx = track(await newCompany({ joinDate: d("2020-01-01") }));
    parse(await as(ctx, () => completeLeaveSetup({ leaveYearStartMonth: 4 })));

    // Somebody who joined part way through the current leave year.
    const state = parse(await as(ctx, () => getLeaveSetupState()));
    const midYear = new Date(state.leaveYearStart);
    midYear.setMonth(midYear.getMonth() + 6);

    const joiner = await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.create({
        name: "Mid Year Joiner",
        email: email(`mid-${uniq()}`),
        phoneNumber: Number(`77${Math.floor(Math.random() * 100000000)}`),
        password: "$2a$10$notarealhashnotarealhashno",
        roleType: "Labourer",
        department: ctx.department._id,
        company: ctx.company._id,
        employeType: "Full-Time",
        immigrationType: "British",
        joinDate: midYear,
        dayPerWeek: 5,
        isActive: true,
        delete: false,
      })
    );

    const preview = parse(await as(ctx, () => previewEntitlements({})));
    const row = preview.rows.find((r) => r._id === String(joiner._id));
    assert.ok(row, "the joiner was not previewed");
    assert.equal(row.proRated, true);
    assert.equal(row.fullYear, 28);
    assert.ok(row.annualLeave > 0 && row.annualLeave < 28, `got ${row.annualLeave}`);
    assert.match(row.explanation, /of 36[56] days/);

    // And the preview is exactly what gets written.
    const built = await as(ctx, () => generateEntitlementsForEveryone());
    assert.ok(built.success, built.message);
    const stored = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({ employeeId: joiner._id }).lean()
    );
    const annual = stored.leaveData.find((l) => l.leaveType === "Annual Leave");
    assert.equal(annual.total, row.annualLeave);
  });

  await check("D2 somebody with no contracted week is flagged, not silently skipped", async () => {
    const ctx = track(await newCompany());
    parse(await as(ctx, () => completeLeaveSetup({ leaveYearStartMonth: 4 })));

    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.create({
        name: "No Days Set",
        email: email(`nodays-${uniq()}`),
        phoneNumber: Number(`77${Math.floor(Math.random() * 100000000)}`),
        password: "$2a$10$notarealhashnotarealhashno",
        roleType: "Labourer",
        department: ctx.department._id,
        company: ctx.company._id,
        employeType: "Full-Time",
        immigrationType: "British",
        joinDate: d("2024-01-01"),
        isActive: true,
        delete: false,
      })
    );

    const preview = parse(await as(ctx, () => previewEntitlements({})));
    const row = preview.rows.find((r) => r.name === "No Days Set");
    assert.equal(row.eligible, false);
    assert.match(row.blockedBy, /days per week/);
    assert.ok(preview.totals.blocked >= 1);
  });

  await check("D3 the preview can answer for a month not yet saved", async () => {
    const ctx = track(await newCompany({ joinDate: d("2020-01-01") }));
    const april = parse(await as(ctx, () => previewEntitlements({ month: 4 })));
    const january = parse(await as(ctx, () => previewEntitlements({ month: 1 })));
    assert.equal(april.leaveYearStartMonth, 4);
    assert.equal(january.leaveYearStartMonth, 1);

    // The twelve months differ, which is the point. The *label* may not: the
    // app's naming convention (helper/getLeaveYearString.js) is
    // "<startYear>-<startYear+1>" whatever the start month, so an April and a
    // January company can both be in "2026-27" while covering different months.
    // Harmless, because a company's start month never changes under it — but it
    // means the label is not what distinguishes them.
    assert.notEqual(
      new Date(april.leaveYearStart).getTime(),
      new Date(january.leaveYearStart).getTime()
    );
    assert.notEqual(
      new Date(april.leaveYearEnd).getTime(),
      new Date(january.leaveYearEnd).getTime()
    );
    // Nothing was written by asking.
    const count = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.countDocuments({})
    );
    assert.equal(count, 0);
  });

  /* ---------------------------------------------------------------------- */
  /* E. An established company                                              */
  /* ---------------------------------------------------------------------- */

  await check("E1 AN EXISTING COMPANY IS NOT SENT BACK TO A SETUP WIZARD", async () => {
    // Categories on file mean somebody set leave up before this screen existed.
    // `configuredAt` is back-filled rather than the company being asked again.
    const ctx = track(await newCompany());
    await runWithTenant(ctx.tenantId, () =>
      LeaveCategory.create({
        leaveType: "Annual Leave",
        total: 28,
        isActive: true,
        isDeleted: false,
      })
    );

    const state = parse(await as(ctx, () => getLeaveConfiguredState()));
    assert.equal(state.configured, true);

    const settings = await runWithTenant(ctx.tenantId, () =>
      LeaveSetting.findOne().lean()
    );
    assert.ok(settings.configuredAt, "configuredAt was not back-filled");
  });

  await check("E2 a company's own leave types are left alone by setup", async () => {
    const ctx = track(await newCompany());
    await runWithTenant(ctx.tenantId, () =>
      LeaveCategory.create({
        leaveType: `Duvet Day ${run}`,
        total: 2,
        isActive: true,
        isDeleted: false,
      })
    );

    const state = parse(await as(ctx, () => getLeaveSetupState()));
    assert.ok(state.ownTypes.includes(`Duvet Day ${run}`));

    parse(await as(ctx, () => completeLeaveSetup({ leaveYearStartMonth: 4 })));
    const mine = await runWithTenant(ctx.tenantId, () =>
      LeaveCategory.findOne({ leaveType: `Duvet Day ${run}` }).lean()
    );
    assert.ok(mine, "a company's own leave type was removed");
    assert.equal(mine.total, 2);
  });

  await check("E3 building entitlements is refused before the leave year is chosen", async () => {
    const ctx = track(await newCompany());
    const response = await as(ctx, () => generateEntitlementsForEveryone());
    assert.equal(response.success, false);
    assert.match(response.message, /set your leave year/i);
    const count = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.countDocuments({})
    );
    assert.equal(count, 0, "entitlements were built against a default year");
  });

  /* ---------------------------------------------------------------------- */
  /* F. The staff import                                                     */
  /* ---------------------------------------------------------------------- */

  const OFFICE_HEADERS =
    "Full Name,Email Address,Phone Number,Department,Job Title," +
    "Employment Type,Start Date,Immigration Type,Days Per Week";

  const officeCsv = (ctx, rows) =>
    [
      OFFICE_HEADERS,
      ...rows.map(
        (r) =>
          `${r.name},${r.email},${r.phone},${ctx.department.roleTitle},Manager,Full-Time,${r.start},British,5`
      ),
    ].join("\n");

  await check("F1 importing before leave is set up warns rather than guessing", async () => {
    const ctx = track(await newCompany());
    const csv = officeCsv(ctx, [
      {
        name: "Early Bird",
        email: email(`early-${uniq()}`),
        phone: "07700900801",
        start: "01/04/2020",
      },
    ]);

    const report = parse(await as(ctx, () => analyseMigration({ kind: "office", csvText: csv, options: {} })));
    assert.equal(report.leave.applies, true);
    assert.equal(report.leave.configured, false);

    const result = parse(await as(ctx, () => commitMigration({ kind: "office", csvText: csv, options: {} })));
    assert.equal(result.created, 1);
    // Not built against an April default that the company may then contradict.
    assert.equal(result.leave.built, 0);
    assert.equal(result.leave.skipped, 1);

    const count = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.countDocuments({})
    );
    assert.equal(count, 0);
  });

  await check("F2 …and one press afterwards builds every missing entitlement", async () => {
    const ctx = track(await newCompany());
    const csv = officeCsv(ctx, [
      { name: "Alpha One", email: email(`a-${uniq()}`), phone: "07700900811", start: "01/04/2019" },
      { name: "Beta Two", email: email(`b-${uniq()}`), phone: "07700900812", start: "01/04/2020" },
    ]);
    parse(await as(ctx, () => commitMigration({ kind: "office", csvText: csv, options: {} })));

    parse(await as(ctx, () => completeLeaveSetup({ leaveYearStartMonth: 4 })));

    // The founder plus the two imported.
    const built = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.countDocuments({})
    );
    assert.equal(built, 3, `expected 3 entitlements, got ${built}`);

    const state = parse(await as(ctx, () => getLeaveSetupState()));
    assert.equal(state.staff.missing, 0);
  });

  await check("F3 IMPORTING AFTER SETUP BUILDS ENTITLEMENTS AS IT GOES", async () => {
    const ctx = track(await newCompany());
    parse(await as(ctx, () => completeLeaveSetup({ leaveYearStartMonth: 4 })));

    const importedEmail = email(`after-${uniq()}`);
    const csv = officeCsv(ctx, [
      { name: "After Setup", email: importedEmail, phone: "07700900821", start: "01/04/2019" },
    ]);

    const report = parse(await as(ctx, () => analyseMigration({ kind: "office", csvText: csv, options: {} })));
    assert.equal(report.leave.configured, true);
    assert.ok(report.leave.leaveYear, "the preview should name the leave year");

    const result = parse(await as(ctx, () => commitMigration({ kind: "office", csvText: csv, options: {} })));
    assert.equal(result.created, 1);
    assert.equal(result.leave.built, 1);
    assert.equal(result.leave.failed, 0);

    const employee = await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.findOne({ email: importedEmail }).lean()
    );
    const entitlement = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({ employeeId: employee._id }).lean()
    );
    assert.ok(entitlement, "the imported employee has no entitlement");
    const annual = entitlement.leaveData.find((l) => l.leaveType === "Annual Leave");
    // Joined 2019, so the full year.
    assert.equal(annual.total, 28);
  });

  await check("F4 a site import does not pretend leave applies to it", async () => {
    // CommonLeave references OfficeEmploye; site employees have never had
    // entitlements, so the question does not arise for them.
    const ctx = track(await newCompany());
    const csv = [
      "First Name,Last Name,Email Address,Phone Number,Job Role,Payment Type," +
        "Pay Type,Pay Rate,Start Date,Immigration Type,Address Line 1,Postcode," +
        "Emergency Contact Name",
      `Site,Worker,${email(`site-${uniq()}`)},07700 900831,Labourer,Weekly,Hourly,16,03/06/2024,British,1 Road,M1 1AA,Someone`,
    ].join("\n");

    const report = parse(await as(ctx, () => analyseMigration({ kind: "site", csvText: csv, options: {} })));
    assert.equal(report.leave.applies, false);
  });

  await check("F5 an imported future starter gets zero leave, not negative", async () => {
    const ctx = track(await newCompany());
    parse(await as(ctx, () => completeLeaveSetup({ leaveYearStartMonth: 4 })));

    const futureEmail = email(`future-${uniq()}`);
    const nextYear = new Date().getFullYear() + 2;
    const csv = officeCsv(ctx, [
      {
        name: "Future Starter",
        email: futureEmail,
        phone: "07700900841",
        start: `01/06/${nextYear}`,
      },
    ]);
    parse(await as(ctx, () => commitMigration({ kind: "office", csvText: csv, options: {} })));

    const employee = await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.findOne({ email: futureEmail }).lean()
    );
    const entitlement = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({ employeeId: employee._id }).lean()
    );
    const annual = entitlement.leaveData.find((l) => l.leaveType === "Annual Leave");
    assert.equal(annual.total, 0);
    assert.ok(annual.total >= 0, "a negative entitlement was stored");
  });

  /* ---------------------------------------------------------------------- */

  // Clean up every company this run made, and everything inside them.
  for (const tenantId of tenants) {
    const oid = new mongoose.Types.ObjectId(tenantId);
    for (const Model of [
      OfficeEmploye,
      LeaveCategory,
      LeaveSetting,
      CommonLeave,
      RoleType,
    ]) {
      await Model.collection.deleteMany({ tenantId: oid });
    }
    await Company.collection.deleteMany({ _id: oid });
  }

  await mongoose.disconnect();

  let failures = 0;
  for (const [status, name] of results) {
    if (status === "FAIL") failures++;
    console.log(`${status === "pass" ? "✓" : "✗"} ${name}`);
  }
  console.log(
    `\n${results.length - failures}/${results.length} passed${failures ? ` — ${failures} FAILED` : ""}`
  );
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
