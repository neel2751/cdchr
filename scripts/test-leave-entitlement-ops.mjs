/**
 * Operating on an entitlement once it exists: editing, hiding, adding, removing.
 *
 * The third leave suite. test-leave-entitlement.mjs is the arithmetic and
 * test-leave-setup.mjs is the setup flow; this is the Entitlements screen's own
 * actions, all four of which turned out to be broken in some way:
 *
 *   · none of them checked whether the caller was allowed to write to the
 *     employee whose id they were handed;
 *   · adding a leave type gave it `remaining: 0`, so it could not be used;
 *   · the Hide switch rejected `isHide: false`, so a visible type could never be
 *     hidden — only a hidden one revealed;
 *   · removing a type set a flag nothing read, so it stayed bookable.
 *
 * And section E covers the one that made all of it moot on a company whose leave
 * year does not start in April: two functions named `getLeaveYearString`, with
 * incompatible second parameters, and five call sites importing the wrong one.
 *
 * Needs a LOCAL database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-leave-entitlement-ops.mjs
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

  const { completeLeaveSetup, getLeaveSetupState } = await import(
    "@/server/leaveServer/leaveSetupServer"
  );
  const {
    addOneCommonLeaveToOneEmployee,
    previewCarryForwardForCompany,
    syncMissingLeaveTypesNew,
  } = await import("@/server/leaveServer/countLeaveServer");
  const { getPreviousLeaveYearString } = await import(
    "@/helper/getLeaveYearString"
  );
  const { editCommonLeave, handleCommonLeaveStatus } = await import(
    "@/server/leaveServer/getLeaveServer"
  );
  const {
    deleteOneCommonLeaveToOneEmployee,
    restoreOneCommonLeaveToOneEmployee,
  } = await import("@/server/leaveServer/entitlementServer");
  const { fetchCommonLeave } = await import("@/server/leaveServer/leaveServer");
  const { getSelectLeaveRequestForEmployee } = await import(
    "@/server/selectServer/selectServer"
  );
  const { currentLeaveYear } = await import("@/lib/leaveYear");
  const { carriedState } = await import("@/lib/carryForward");
  const { getCarryForwardExceptions, setCarryForwardMode } = await import(
    "@/server/leaveServer/carryForwardServer"
  );
  const {
    expireCarryForwardNow,
    previewCarryForwardExpiry,
    recomputeCarryForward,
    recomputeCarryForwardForMany,
  } = await import("@/server/leaveServer/carryExpiryServer");

  const run = uniq();
  const tenants = [];

  /** A company with leave set up and one employee who has entitlements. */
  async function newCompany({ startMonth = 4, dayPerWeek = 5 } = {}) {
    const company = await Company.create({ name: `Ops Test ${run}-${uniq()}` });
    const tenantId = String(company._id);
    tenants.push(tenantId);

    const department = await runWithTenant(tenantId, () =>
      RoleType.create({ roleTitle: `Ops ${uniq()}`, isActive: true, delete: false })
    );

    const email = `founder.${uniq()}.${run}@ops-test.invalid`;
    const founder = await runWithTenant(tenantId, () =>
      OfficeEmploye.create({
        name: "Founder",
        email,
        phoneNumber: Number(`77${Math.floor(Math.random() * 100000000)}`),
        password: "$2a$10$notarealhashnotarealhashno",
        roleType: "Manager",
        department: department._id,
        company: company._id,
        employeType: "Full-Time",
        immigrationType: "British",
        joinDate: d("2020-01-01"),
        dayPerWeek,
        isActive: true,
        isSuperAdmin: true,
        delete: false,
      })
    );

    const superAdmin = {
      _id: String(founder._id),
      name: "Founder",
      email,
      role: "superAdmin",
      tenantId,
    };

    actAs(superAdmin);
    const setup = await runWithTenant(tenantId, () =>
      completeLeaveSetup({
        leaveYearStartMonth: startMonth,
        leaveTypeKeys: ["bereavement"],
      })
    );
    assert.ok(setup.success, setup.message);

    const leaveYear = await runWithTenant(tenantId, () => currentLeaveYear());

    return { company, tenantId, department, founder, superAdmin, leaveYear };
  }

  const as = (ctx, fn) => {
    actAs(ctx.superAdmin);
    return runWithTenant(ctx.tenantId, fn);
  };

  const entitlementFor = (ctx, leaveType) =>
    runWithTenant(ctx.tenantId, async () => {
      const doc = await CommonLeave.findOne({
        employeeId: ctx.founder._id,
        leaveYear: ctx.leaveYear,
      }).lean();
      return doc?.leaveData?.find((row) => row.leaveType === leaveType) || null;
    });

  /* ---------------------------------------------------------------------- */
  /* A. Authorisation — none of these had any                                */
  /* ---------------------------------------------------------------------- */

  const authCtx = await newCompany();

  await check("A1 AN ORDINARY EMPLOYEE CANNOT RAISE THEIR OWN ALLOWANCE", async () => {
    // The hole: every one of these is an addressable endpoint that took an
    // employee id from its caller and wrote to that employee's entitlement.
    actAs({ ...authCtx.superAdmin, role: "user" });
    const response = await runWithTenant(authCtx.tenantId, () =>
      editCommonLeave({
        value: 40,
        reason: "Attempting to raise my own allowance",
        initialValues: {
          leaveYear: authCtx.leaveYear,
          employeeId: String(authCtx.founder._id),
          leaveType: "Annual Leave",
        },
      })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /not allowed/i);

    const annual = await entitlementFor(authCtx, "Annual Leave");
    assert.equal(annual.total, 28, "the allowance was changed anyway");
  });

  await check("A2 the other three writes are guarded too", async () => {
    actAs({ ...authCtx.superAdmin, role: "user" });
    const calls = [
      () =>
        addOneCommonLeaveToOneEmployee({
          leaveType: "Bereavement Leave",
          leaveYear: authCtx.leaveYear,
          employeeId: String(authCtx.founder._id),
          leaveDays: 99,
        }),
      () =>
        handleCommonLeaveStatus({
          leaveType: "Annual Leave",
          isHide: false,
          employeeId: String(authCtx.founder._id),
          leaveYear: authCtx.leaveYear,
        }),
      () =>
        deleteOneCommonLeaveToOneEmployee({
          leaveType: "Bereavement Leave",
          leaveYear: authCtx.leaveYear,
          employeeId: String(authCtx.founder._id),
        }),
    ];
    for (const call of calls) {
      const response = await runWithTenant(authCtx.tenantId, call);
      assert.equal(response.success, false, JSON.stringify(response));
    }
  });

  await check("A3 signed out is refused", async () => {
    actAs(null);
    const response = await runWithTenant(authCtx.tenantId, () =>
      editCommonLeave({
        value: 40,
        reason: "Attempting to raise my own allowance",
        initialValues: {
          leaveYear: authCtx.leaveYear,
          employeeId: String(authCtx.founder._id),
          leaveType: "Annual Leave",
        },
      })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /signed in|not allowed/i);
  });

  /* ---------------------------------------------------------------------- */
  /* B. Editing a total                                                      */
  /* ---------------------------------------------------------------------- */

  const editCtx = await newCompany();

  await check("B1 raising a total raises what is left", async () => {
    const before = await entitlementFor(editCtx, "Annual Leave");
    assert.equal(before.total, 28);

    const response = await as(editCtx, () =>
      editCommonLeave({
        value: 30,
        reason: "Contract change — hours or days per week",
        initialValues: {
          leaveYear: editCtx.leaveYear,
          employeeId: String(editCtx.founder._id),
          leaveType: "Annual Leave",
        },
      })
    );
    assert.ok(response.success, response.message);

    const after = await entitlementFor(editCtx, "Annual Leave");
    assert.equal(after.total, 30);
    assert.equal(after.remaining, 30);
    assert.equal(after.used, 0);
  });

  await check("B2 REMAINING IS RECALCULATED FROM WHAT HAS BEEN TAKEN", async () => {
    // Book 5 days by hand, then change the total: the days taken must survive and
    // remaining must be the difference, not the whole new total.
    await runWithTenant(editCtx.tenantId, () =>
      CommonLeave.updateOne(
        {
          employeeId: editCtx.founder._id,
          leaveYear: editCtx.leaveYear,
          "leaveData.leaveType": "Annual Leave",
        },
        { $set: { "leaveData.$.used": 5, "leaveData.$.remaining": 25 } }
      )
    );

    const response = await as(editCtx, () =>
      editCommonLeave({
        value: 32,
        reason: "Contract change — hours or days per week",
        initialValues: {
          leaveYear: editCtx.leaveYear,
          employeeId: String(editCtx.founder._id),
          leaveType: "Annual Leave",
        },
      })
    );
    assert.ok(response.success, response.message);

    const after = await entitlementFor(editCtx, "Annual Leave");
    assert.equal(after.total, 32);
    assert.equal(after.used, 5);
    assert.equal(after.remaining, 27);
  });

  await check("B3 a total below the days already taken is refused", async () => {
    const response = await as(editCtx, () =>
      editCommonLeave({
        value: 3, // 5 already used
        reason: "Correcting an earlier mistake",
        initialValues: {
          leaveYear: editCtx.leaveYear,
          employeeId: String(editCtx.founder._id),
          leaveType: "Annual Leave",
        },
      })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /less then used|less than/i);
    const after = await entitlementFor(editCtx, "Annual Leave");
    assert.equal(after.total, 32, "the refused value was written anyway");
  });

  await check("B4 every change is recorded in the history", async () => {
    const doc = await runWithTenant(editCtx.tenantId, () =>
      CommonLeave.findOne({
        employeeId: editCtx.founder._id,
        leaveYear: editCtx.leaveYear,
      }).lean()
    );
    const edits = doc.leaveHistory.filter((row) => row.newTotal !== undefined);
    assert.equal(edits.length, 2, "two successful edits should be recorded");
    assert.equal(edits[1].oldTotal, 30);
    assert.equal(edits[1].newTotal, 32);
    assert.equal(edits[1].newRemaining, 27);
  });

  /* ---------------------------------------------------------------------- */
  /* B2. The ceiling, per leave type                                         */
  /* ---------------------------------------------------------------------- */

  const capCtx = await newCompany();

  /** Try to set one leave type's total, and say whether it was allowed. */
  const setTotal = async (leaveType, value) =>
    as(capCtx, () =>
      editCommonLeave({
        value,
        reason: "Capping test — adjusting the allowance",
        initialValues: {
          leaveYear: capCtx.leaveYear,
          employeeId: String(capCtx.founder._id),
          leaveType,
        },
      })
    );

  await check("BC1 ANNUAL LEAVE KEEPS A TIGHT CAP, TO CATCH A STRAY DIGIT", async () => {
    // 28 typed as 280 is the mistake this exists for. Anything up to 60 is a
    // real figure — 34 for a six-day week, plus bank holidays, plus carry-forward.
    const generous = await setTotal("Annual Leave", 45);
    assert.ok(generous.success, generous.message);

    const atCeiling = await setTotal("Annual Leave", 60);
    assert.ok(atCeiling.success, atCeiling.message);

    const typo = await setTotal("Annual Leave", 280);
    assert.equal(typo.success, false);
    assert.match(typo.message, /cannot be set above 60 days/);

    const annual = await entitlementFor(capCtx, "Annual Leave");
    assert.equal(annual.total, 60, "the refused value was written anyway");
  });

  await check("BC2 UNPAID LEAVE CAN BE EDITED AT ALL", async () => {
    // The flat cap was 40 and Unpaid Leave starts at 100, so every edit to it
    // was refused as "Invalid Leave days" — the type could not be changed by
    // anybody, ever.
    const before = await entitlementFor(capCtx, "Unpaid Leave");
    assert.equal(before.total, 100, "expected the catalogue's starting figure");

    const response = await setTotal("Unpaid Leave", 120);
    assert.ok(response.success, response.message);

    const after = await entitlementFor(capCtx, "Unpaid Leave");
    assert.equal(after.total, 120);
    assert.equal(after.remaining, 120);
  });

  await check("BC3 a generous company sick-pay scheme is allowed", async () => {
    // Six months of company sick pay is ordinary and was 100 days over the old
    // limit.
    const response = await setTotal("Sick Leave", 130);
    assert.ok(response.success, response.message);
    const sick = await entitlementFor(capCtx, "Sick Leave");
    assert.equal(sick.total, 130);
  });

  await check("BC4 MATERNITY LEAVE'S 52 WEEKS IS NOT OVER THE LIMIT", async () => {
    // Stored in weeks, not days — so the ceiling has to be 52, and the old flat
    // 40 made the statutory figure itself unsettable.
    const row = await entitlementFor(capCtx, "Maternity Leave");
    assert.equal(row.type, "weeks", "maternity should be stored in weeks");

    // The statutory maximum itself has to be settable.
    const statutory = await setTotal("Maternity Leave", 52);
    assert.ok(statutory.success, statutory.message);

    const enhanced = await setTotal("Maternity Leave", 39);
    assert.ok(enhanced.success, enhanced.message);

    const beyond = await setTotal("Maternity Leave", 53);
    assert.equal(beyond.success, false);
    assert.match(beyond.message, /cannot be set above 52 weeks/);
  });

  await check("BC5 a company's own leave type gets the leave-year ceiling", async () => {
    await runWithTenant(capCtx.tenantId, () =>
      LeaveCategory.create({
        leaveType: `Sabbatical ${run}`,
        total: 10,
        isActive: true,
        isDeleted: false,
      })
    );
    const added = await as(capCtx, () =>
      addOneCommonLeaveToOneEmployee({
        leaveType: `Sabbatical ${run}`,
        leaveYear: capCtx.leaveYear,
        employeeId: String(capCtx.founder._id),
      })
    );
    assert.ok(added.success, added.message);

    // Not in the catalogue, so it falls back to a whole leave year of days.
    const ok = await setTotal(`Sabbatical ${run}`, 200);
    assert.ok(ok.success, ok.message);

    const tooMuch = await setTotal(`Sabbatical ${run}`, 400);
    assert.equal(tooMuch.success, false);
    assert.match(tooMuch.message, /cannot be set above 366 days/);
  });

  await check("BC6 the ceiling never overrides the days-already-used rule", async () => {
    await runWithTenant(capCtx.tenantId, () =>
      CommonLeave.updateOne(
        {
          employeeId: capCtx.founder._id,
          leaveYear: capCtx.leaveYear,
          "leaveData.leaveType": "Unpaid Leave",
        },
        { $set: { "leaveData.$.used": 20, "leaveData.$.remaining": 100 } }
      )
    );
    const response = await setTotal("Unpaid Leave", 10);
    assert.equal(response.success, false);
    assert.match(response.message, /less then used|less than/i);
  });

  /* ---------------------------------------------------------------------- */
  /* BR. A reason, on every change                                           */
  /* ---------------------------------------------------------------------- */

  const reasonCtx = await newCompany();

  const editWithReason = async (value, reason) =>
    as(reasonCtx, () =>
      editCommonLeave({
        value,
        reason,
        initialValues: {
          leaveYear: reasonCtx.leaveYear,
          employeeId: String(reasonCtx.founder._id),
          leaveType: "Annual Leave",
        },
      })
    );

  await check("BR1 A CHANGE WITH NO REASON IS REFUSED", async () => {
    // The history recorded who, when, and from what to what — everything except
    // the only question anybody asks afterwards. Enforced on the endpoint rather
    // than in the dialog: a rule that lives only in a form is not a rule.
    for (const reason of [undefined, null, "", "   ", "ok", "n/a", "."]) {
      const response = await editWithReason(30, reason);
      assert.equal(
        response.success,
        false,
        `accepted reason ${JSON.stringify(reason)}`
      );
      assert.match(response.message, /say why/i);
    }
    // And nothing was written on the way past.
    assert.equal((await entitlementFor(reasonCtx, "Annual Leave")).total, 28);
  });

  await check("BR2 the reason is stored against the change", async () => {
    const response = await editWithReason(
      30,
      "Contract change — hours or days per week"
    );
    assert.ok(response.success, response.message);

    const doc = await runWithTenant(reasonCtx.tenantId, () =>
      CommonLeave.findOne({
        employeeId: reasonCtx.founder._id,
        leaveYear: reasonCtx.leaveYear,
      }).lean()
    );
    const entry = doc.leaveHistory.filter((row) => row.newTotal === 30).pop();
    assert.ok(entry, "the change was not recorded");
    assert.equal(entry.reason, "Contract change — hours or days per week");
    assert.equal(entry.oldTotal, 28);
    assert.equal(entry.updatedByName, "Founder");
    // An ordinary raise is not below anything, so it carries no warning flag.
    assert.equal(entry.belowStatutory, undefined);
  });

  await check("BR3 an over-long reason is refused rather than truncated", async () => {
    const response = await editWithReason(31, "x".repeat(501));
    assert.equal(response.success, false);
    assert.match(response.message, /too long/i);
    assert.equal((await entitlementFor(reasonCtx, "Annual Leave")).total, 30);
  });

  await check("BR4 a 500-character reason is accepted whole", async () => {
    const reason = "y".repeat(500);
    const response = await editWithReason(31, reason);
    assert.ok(response.success, response.message);
    const doc = await runWithTenant(reasonCtx.tenantId, () =>
      CommonLeave.findOne({
        employeeId: reasonCtx.founder._id,
        leaveYear: reasonCtx.leaveYear,
      }).lean()
    );
    const entry = doc.leaveHistory.filter((row) => row.newTotal === 31).pop();
    assert.equal(entry.reason.length, 500);
  });

  await check("BR5 surrounding whitespace is trimmed, not counted", async () => {
    // "  ok  " must not pass the five-character bar by virtue of its spaces.
    const padded = await editWithReason(32, "        ");
    assert.equal(padded.success, false);

    const response = await editWithReason(32, "   Carry-forward applied   ");
    assert.ok(response.success, response.message);
    const doc = await runWithTenant(reasonCtx.tenantId, () =>
      CommonLeave.findOne({
        employeeId: reasonCtx.founder._id,
        leaveYear: reasonCtx.leaveYear,
      }).lean()
    );
    const entry = doc.leaveHistory.filter((row) => row.newTotal === 32).pop();
    assert.equal(entry.reason, "Carry-forward applied");
  });

  /* ---------------------------------------------------------------------- */
  /* BZ. Zero, and the statutory floor on annual leave                       */
  /* ---------------------------------------------------------------------- */

  const zeroCtx = await newCompany();

  const setTotalOn = async (
    ctx,
    leaveType,
    value,
    acknowledgement,
    reason = "Zeroing test — adjusting the allowance"
  ) =>
    as(ctx, () =>
      editCommonLeave({
        value,
        reason,
        acknowledgement,
        initialValues: {
          leaveYear: ctx.leaveYear,
          employeeId: String(ctx.founder._id),
          leaveType,
        },
      })
    );

  await check("BZ1 ZERO IS A REAL ALLOWANCE FOR AN ORDINARY LEAVE TYPE", async () => {
    // "No study leave this year" used to be unsayable: `value <= 0` was refused
    // outright, so the only way to express it was to remove the type.
    await runWithTenant(zeroCtx.tenantId, () =>
      LeaveCategory.create({
        leaveType: `Study ${run}-z`,
        total: 5,
        isActive: true,
        isDeleted: false,
      })
    );
    const added = await as(zeroCtx, () =>
      addOneCommonLeaveToOneEmployee({
        leaveType: `Study ${run}-z`,
        leaveYear: zeroCtx.leaveYear,
        employeeId: String(zeroCtx.founder._id),
      })
    );
    assert.ok(added.success, added.message);

    const response = await setTotalOn(zeroCtx, `Study ${run}-z`, 0);
    assert.ok(response.success, response.message);

    const row = await entitlementFor(zeroCtx, `Study ${run}-z`);
    assert.equal(row.total, 0);
    assert.equal(row.remaining, 0);
  });

  await check("BZ2 zeroing Unpaid Leave needs no ceremony either", async () => {
    const response = await setTotalOn(zeroCtx, "Unpaid Leave", 0);
    assert.ok(response.success, response.message);
    assert.equal((await entitlementFor(zeroCtx, "Unpaid Leave")).total, 0);
  });

  await check("BZ3 ANNUAL LEAVE ASKS BEFORE GOING BELOW ENTITLEMENT", async () => {
    // Not refused — asked. The founder joined in 2020 on a five-day week, so the
    // floor is the full 28.
    const response = await setTotalOn(zeroCtx, "Annual Leave", 0);
    // `success: false` because nothing was written, which is what every caller
    // already keys off — plus `requiresConfirmation`, which says the refusal is a
    // question rather than a dead end.
    assert.equal(response.success, false);
    assert.equal(response.requiresConfirmation, true);
    assert.equal(response.statutory, 28);
    assert.equal(response.proposed, 0);
    assert.equal(response.unit, "days");
    assert.match(response.message, /no annual leave at all/i);

    // And nothing was written while the question was outstanding.
    assert.equal((await entitlementFor(zeroCtx, "Annual Leave")).total, 28);
  });

  await check("BZ4 a below-statutory figure short of zero asks too", async () => {
    const response = await setTotalOn(zeroCtx, "Annual Leave", 10);
    assert.equal(response.requiresConfirmation, true);
    assert.equal(response.statutory, 28);
    assert.match(response.message, /below this employee's entitlement of 28 days/);
  });

  await check("BZ5 AN ACKNOWLEDGEMENT WITHOUT A REAL REASON IS NOT ONE", async () => {
    // The reason is a separate, always-required parameter now; what the
    // acknowledgement carries is the single bit "yes, I know this is below what
    // they are owed". Anything short of that is still a question.
    for (const acknowledgement of [
      undefined,
      {},
      { confirmed: false },
      { confirmed: "yes" },
      { confirmed: 1 },
    ]) {
      const response = await setTotalOn(zeroCtx, "Annual Leave", 0, acknowledgement);
      assert.equal(
        response.requiresConfirmation,
        true,
        `accepted ${JSON.stringify(acknowledgement)}`
      );
    }
    assert.equal((await entitlementFor(zeroCtx, "Annual Leave")).total, 28);
  });

  await check("BZ6 confirmed with a reason goes through, and the reason is kept", async () => {
    const response = await setTotalOn(
      zeroCtx,
      "Annual Leave",
      0,
      { confirmed: true },
      "Left on 30 September; entitlement settled in final pay"
    );
    assert.ok(response.success, response.message);

    const annual = await entitlementFor(zeroCtx, "Annual Leave");
    assert.equal(annual.total, 0);
    assert.equal(annual.remaining, 0);

    const doc = await runWithTenant(zeroCtx.tenantId, () =>
      CommonLeave.findOne({
        employeeId: zeroCtx.founder._id,
        leaveYear: zeroCtx.leaveYear,
      }).lean()
    );
    const entry = doc.leaveHistory.filter((row) => row.belowStatutory).pop();
    assert.ok(entry, "the reason was not recorded");
    assert.equal(entry.statutoryEntitlement, 28);
    assert.equal(entry.newTotal, 0);
    assert.match(entry.reason, /30 September/);
  });

  await check("BZ7 raising annual leave back up never needs confirming", async () => {
    const response = await setTotalOn(zeroCtx, "Annual Leave", 28);
    assert.ok(response.success, response.message);
    assert.equal(response.requiresConfirmation, undefined);
  });

  await check("BZ8 A FUTURE STARTER'S LEGITIMATE ZERO IS NOT QUESTIONED", async () => {
    // The case a constant `minTotal: 1` would have got wrong in both directions:
    // annualLeaveForYear() returns 0 for somebody who has not started, so 0 is
    // the correct figure and setting it is not going below anything.
    const ctx = await newCompany();
    const nextYear = new Date().getFullYear() + 2;
    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.updateOne(
        { _id: ctx.founder._id },
        { $set: { joinDate: d(`${nextYear}-06-01`) } }
      )
    );

    const response = await setTotalOn(ctx, "Annual Leave", 0);
    assert.ok(response.success, response.message);
    assert.equal((await entitlementFor(ctx, "Annual Leave")).total, 0);
  });

  await check("BZ9 A LEAVER'S REDUCED ACCRUAL IS A CORRECTION, NOT A CUT", async () => {
    // The floor is computed with the end date, so pro-rating a leaver down to
    // what they actually accrued passes without ceremony — which is the whole
    // reason the floor is derived rather than being the flat full-year figure.
    const ctx = await newCompany();
    const state = await as(ctx, () => getLeaveSetupState());
    const { leaveYearStart } = JSON.parse(state.data);
    const leaveOn = new Date(leaveYearStart);
    leaveOn.setMonth(leaveOn.getMonth() + 6); // roughly half the year

    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.updateOne({ _id: ctx.founder._id }, { $set: { endDate: leaveOn } })
    );

    // About half of 28. Below the full-year figure, but not below what they are
    // owed — so no confirmation.
    const response = await setTotalOn(ctx, "Annual Leave", 15);
    assert.ok(
      response.success,
      `a leaver's pro-rata should not need confirming: ${response.message}`
    );

    // Going under even *that* still asks.
    const under = await setTotalOn(ctx, "Annual Leave", 1);
    assert.equal(under.requiresConfirmation, true);
    assert.ok(under.statutory < 28 && under.statutory > 1, `floor was ${under.statutory}`);
  });

  await check("BZ10 an employee with no contracted week has no floor to enforce", async () => {
    // Nothing to derive a floor from, so there is none — and an admin must not be
    // blocked from fixing precisely that record.
    const ctx = await newCompany();
    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.updateOne(
        { _id: ctx.founder._id },
        { $unset: { dayPerWeek: "" } }
      )
    );
    const response = await setTotalOn(ctx, "Annual Leave", 0);
    assert.ok(response.success, response.message);
  });

  await check("BZ11 a negative total is still refused outright", async () => {
    const response = await setTotalOn(zeroCtx, "Annual Leave", -5);
    assert.equal(response.success, false);
    assert.equal(response.requiresConfirmation, undefined);
    assert.match(response.message, /not negative/i);
  });

  await check("BZ12 zero is still refused when days have been taken", async () => {
    // The used-days rule is independent of the floor and outranks zeroing.
    await runWithTenant(zeroCtx.tenantId, () =>
      CommonLeave.updateOne(
        {
          employeeId: zeroCtx.founder._id,
          leaveYear: zeroCtx.leaveYear,
          "leaveData.leaveType": "Annual Leave",
        },
        { $set: { "leaveData.$.used": 4, "leaveData.$.remaining": 24 } }
      )
    );
    const response = await setTotalOn(
      zeroCtx,
      "Annual Leave",
      0,
      { confirmed: true },
      "trying to zero an allowance that has been drawn on"
    );
    assert.equal(response.success, false);
    assert.match(response.message, /less then used|less than/i);
  });

  /* ---------------------------------------------------------------------- */
  /* BF. Carry-forward — the 44-day report                                   */
  /* ---------------------------------------------------------------------- */

  await check("BF1 THE 44-DAY CASE REPRODUCES, AND IS NOW EXPLAINED", async () => {
    // Reported: a six-day-week employee who joined 25 June 2025 showed 44 days
    // of annual leave for the current year, where a full year is 5.6 × 6 = 34.
    // The extra ten were carried from the previous leave year, which is correct
    // — but nothing stored or showed that, so the figure was unaccountable.
    const ctx = await newCompany({ dayPerWeek: 6 });
    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.updateOne(
        { _id: ctx.founder._id },
        { $set: { joinDate: d("2025-06-25") } }
      )
    );

    // Carry-forward on, ten days of annual leave.
    await runWithTenant(ctx.tenantId, () =>
      LeaveSetting.updateOne(
        {},
        {
          $set: {
            carryForwardEnabled: true,
            carryForwardRules: [
              {
                leaveType: "Annual Leave",
                allowed: true,
                maxDays: 10,
                expireAfterMonths: 3,
                proRated: false,
              },
            ],
          },
        }
      )
    );

    // Last year's record, with plenty left over.
    const previous = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({ employeeId: ctx.founder._id }).lean()
    );
    const prevYear = getPreviousLeaveYearString(previous.leaveYear);
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.create({
        employeeId: ctx.founder._id,
        leaveYear: prevYear,
        leaveData: [
          {
            leaveType: "Annual Leave",
            total: 28,
            used: 0,
            remaining: 28,
            type: "days",
          },
        ],
      })
    );
    // Clear this year's so the scan regenerates it.
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.deleteOne({
        employeeId: ctx.founder._id,
        leaveYear: previous.leaveYear,
      })
    );

    const scan = await as(ctx, () =>
      syncMissingLeaveTypesNew(d("2025-06-25"), 6, String(ctx.founder._id))
    );
    assert.ok(scan.success, scan.message);

    const annual = await entitlementFor(ctx, "Annual Leave");
    // The reported number, reproduced: 34 for the year plus 10 carried.
    assert.equal(annual.total, 44);
    // And now accountable, which is the actual fix.
    assert.equal(annual.carryForwarded, 10);
    assert.equal(annual.baseTotal, 34);
    assert.equal(annual.carriedFrom, prevYear);
    assert.ok(annual.carryForwardExpiresAt, "the expiry was discarded again");

    return ctx;
  });

  await check("BF2 THE PREVIEW NO LONGER DISAGREES WITH WHAT HAPPENS", async () => {
    // The root cause of the surprise: previewCarryForwardForCompany tested
    // `rule.enabled` and the schema field is `allowed`, so it reported zero
    // carry-forward for every employee while the generator carried days.
    const ctx = await newCompany({ dayPerWeek: 6 });
    await runWithTenant(ctx.tenantId, () =>
      LeaveSetting.updateOne(
        {},
        {
          $set: {
            carryForwardEnabled: true,
            carryForwardRules: [
              { leaveType: "Annual Leave", allowed: true, maxDays: 10 },
            ],
          },
        }
      )
    );

    const thisYear = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({ employeeId: ctx.founder._id }).lean()
    );
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.create({
        employeeId: ctx.founder._id,
        leaveYear: getPreviousLeaveYearString(thisYear.leaveYear),
        leaveData: [
          {
            leaveType: "Annual Leave",
            total: 28,
            used: 0,
            remaining: 28,
            type: "days",
          },
        ],
      })
    );

    const preview = await as(ctx, () => previewCarryForwardForCompany());
    assert.ok(preview.success, preview.message);
    const rows = JSON.parse(preview.data);
    const row = rows.find(
      (r) =>
        String(r.employeeId) === String(ctx.founder._id) &&
        r.leaveType === "Annual Leave"
    );
    assert.ok(row, "the employee was not previewed");
    assert.equal(row.willCarry, 10, "the preview still reports nothing");
    assert.equal(row.newTotal, 44);
    assert.ok(row.explanation, "the preview should say why");
  });

  await check("BF3 carry-forward cannot push a total past the type's ceiling", async () => {
    // 34 + 40 carried would store 74, above the 60 anybody may set by hand —
    // leaving the row permanently uneditable.
    const ctx = await newCompany({ dayPerWeek: 6 });
    await runWithTenant(ctx.tenantId, () =>
      LeaveSetting.updateOne(
        {},
        {
          $set: {
            carryForwardEnabled: true,
            carryForwardRules: [
              { leaveType: "Annual Leave", allowed: true, maxDays: 40 },
            ],
          },
        }
      )
    );

    const thisYear = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({ employeeId: ctx.founder._id }).lean()
    );
    const prevYear = getPreviousLeaveYearString(thisYear.leaveYear);
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.create({
        employeeId: ctx.founder._id,
        leaveYear: prevYear,
        leaveData: [
          {
            leaveType: "Annual Leave",
            total: 40,
            used: 0,
            remaining: 40,
            type: "days",
          },
        ],
      })
    );
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.deleteOne({ _id: thisYear._id })
    );

    const scan = await as(ctx, () =>
      syncMissingLeaveTypesNew(ctx.founder.joinDate, 6, String(ctx.founder._id))
    );
    assert.ok(scan.success, scan.message);

    const annual = await entitlementFor(ctx, "Annual Leave");
    assert.equal(annual.total, 60, `stored ${annual.total}, ceiling is 60`);
    assert.equal(annual.carryForwarded, 26);

    // And the row is still editable, which is the point of the cap.
    const edit = await as(ctx, () =>
      editCommonLeave({
        value: 55,
        reason: "Correcting an earlier mistake",
        initialValues: {
          leaveYear: ctx.leaveYear,
          employeeId: String(ctx.founder._id),
          leaveType: "Annual Leave",
        },
      })
    );
    assert.ok(edit.success, edit.message);
  });

  await check("BF4 THE SCAN NO LONGER RESURRECTS DELETED LEAVE TYPES", async () => {
    // checkWithStoreLeaveType called LeaveCategoryModel.find() with no filter,
    // so every press of the scan button re-added leave types an admin had
    // removed — complete with a fresh allowance of each.
    const ctx = await newCompany();
    await runWithTenant(ctx.tenantId, () =>
      LeaveCategory.create({
        leaveType: `Retired Type ${run}`,
        total: 9,
        isActive: true,
        isDeleted: true,
      })
    );

    const scan = await as(ctx, () =>
      syncMissingLeaveTypesNew(ctx.founder.joinDate, 5, String(ctx.founder._id))
    );
    assert.ok(scan.success, scan.message);

    const row = await entitlementFor(ctx, `Retired Type ${run}`);
    assert.equal(row, null, "a deleted leave type was added by the scan");
  });

  await check("BF5 a second scan does not carry twice", async () => {
    const ctx = await newCompany({ dayPerWeek: 6 });
    await runWithTenant(ctx.tenantId, () =>
      LeaveSetting.updateOne(
        {},
        {
          $set: {
            carryForwardEnabled: true,
            carryForwardRules: [
              { leaveType: "Annual Leave", allowed: true, maxDays: 10 },
            ],
          },
        }
      )
    );
    const thisYear = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({ employeeId: ctx.founder._id }).lean()
    );
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.create({
        employeeId: ctx.founder._id,
        leaveYear: getPreviousLeaveYearString(thisYear.leaveYear),
        leaveData: [
          {
            leaveType: "Annual Leave",
            total: 28,
            used: 0,
            remaining: 28,
            type: "days",
          },
        ],
      })
    );
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.deleteOne({ _id: thisYear._id })
    );

    await as(ctx, () =>
      syncMissingLeaveTypesNew(ctx.founder.joinDate, 6, String(ctx.founder._id))
    );
    const first = (await entitlementFor(ctx, "Annual Leave")).total;

    for (let i = 0; i < 3; i++) {
      await as(ctx, () =>
        syncMissingLeaveTypesNew(ctx.founder.joinDate, 6, String(ctx.founder._id))
      );
    }
    const after = await entitlementFor(ctx, "Annual Leave");
    assert.equal(after.total, first, "pressing scan again changed the total");
    assert.equal(after.carryForwarded, 10);

    // And no duplicate rows for the same leave type.
    const doc = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({
        employeeId: ctx.founder._id,
        leaveYear: ctx.leaveYear,
      }).lean()
    );
    const names = doc.leaveData.map((r) => r.leaveType);
    assert.equal(
      names.length,
      new Set(names).size,
      `duplicate leave types: ${names.join(", ")}`
    );
  });

  /* ---------------------------------------------------------------------- */
  /* BX. Carry-forward expiry, enforced                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * A company whose employee holds 34 + 10 carried, with the carry already
   * expired. Built by writing the row directly: the point under test is what
   * happens to an expired carry, not how it got there.
   */
  async function companyWithExpiredCarry({ used = 0 } = {}) {
    const ctx = await newCompany({ dayPerWeek: 6 });
    const expiredOn = new Date();
    expiredOn.setMonth(expiredOn.getMonth() - 1);

    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.updateOne(
        { employeeId: ctx.founder._id, leaveYear: ctx.leaveYear },
        {
          $set: {
            "leaveData.$[annual].total": 44,
            "leaveData.$[annual].used": used,
            "leaveData.$[annual].remaining": 44 - used,
            "leaveData.$[annual].carryForwarded": 10,
            "leaveData.$[annual].baseTotal": 34,
            "leaveData.$[annual].carryForwardExpiresAt": expiredOn,
          },
        },
        { arrayFilters: [{ "annual.leaveType": "Annual Leave" }] }
      )
    );
    return { ctx, expiredOn };
  }

  await check("BX1 AN EXPIRED CARRIED DAY CANNOT BE BOOKED", async () => {
    // The enforcement that did not exist: `expireAfterMonths` was required by the
    // settings form and read by nothing, so these ten days stayed spendable for
    // the rest of the leave year.
    const { ctx } = await companyWithExpiredCarry();

    const annual = await entitlementFor(ctx, "Annual Leave");
    assert.equal(annual.remaining, 44, "the stored balance still says 44");

    // Of that 44, only the 34 of this year's own entitlement is real.
    const state = carriedState(annual);
    assert.equal(state.hasExpired, true);
    assert.equal(state.lapsed, 10);
    assert.equal(state.usable, 34);
  });

  await check("BX2 the nightly job writes the lapse down", async () => {
    const { ctx } = await companyWithExpiredCarry();

    const result = await as(ctx, () => expireCarryForwardNow());
    assert.ok(result.success, result.message);
    assert.match(result.message, /10 expired/);

    const annual = await entitlementFor(ctx, "Annual Leave");
    assert.equal(annual.total, 34, "the total still claims the expired days");
    assert.equal(annual.remaining, 34);
    assert.equal(annual.carryForwardLapsed, 10);
    // total - used === remaining, which every other screen relies on.
    assert.equal(annual.total - (annual.used || 0), annual.remaining);
  });

  await check("BX3 only the untaken carried days lapse", async () => {
    // Four of the ten were taken before the expiry; those are spent, not lost.
    const { ctx } = await companyWithExpiredCarry({ used: 4 });

    const result = await as(ctx, () => expireCarryForwardNow());
    assert.ok(result.success, result.message);

    const annual = await entitlementFor(ctx, "Annual Leave");
    assert.equal(annual.carryForwardLapsed, 6);
    assert.equal(annual.total, 38); // 34 of its own + the 4 carried and taken
    assert.equal(annual.remaining, 34);
    assert.equal(annual.used, 4);
    assert.equal(annual.carryForwarded, 4, "only the taken days stay carried");
  });

  await check("BX4 THE JOB IS IDEMPOTENT — A SECOND RUN TAKES NOTHING", async () => {
    // A missed night or an accidental re-run must not keep eating the balance.
    const { ctx } = await companyWithExpiredCarry({ used: 4 });

    await as(ctx, () => expireCarryForwardNow());
    const once = await entitlementFor(ctx, "Annual Leave");

    for (let i = 0; i < 3; i++) await as(ctx, () => expireCarryForwardNow());
    const thrice = await entitlementFor(ctx, "Annual Leave");

    assert.equal(thrice.total, once.total);
    assert.equal(thrice.remaining, once.remaining);
    assert.equal(thrice.carryForwardLapsed, once.carryForwardLapsed);

    const later = await as(ctx, () => expireCarryForwardNow());
    assert.match(later.message, /nothing has expired/i);
  });

  await check("BX5 the drop is explained in the leave history", async () => {
    // An allowance falling by ten days overnight is not something to leave
    // unexplained on the one screen somebody will check.
    const { ctx } = await companyWithExpiredCarry();
    await as(ctx, () => expireCarryForwardNow());

    const doc = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({
        employeeId: ctx.founder._id,
        leaveYear: ctx.leaveYear,
      }).lean()
    );
    const entry = doc.leaveHistory.filter((r) => r.carryForwardLapsed).pop();
    assert.ok(entry, "the lapse was not recorded");
    assert.equal(entry.carryForwardLapsed, 10);
    assert.equal(entry.oldTotal, 44);
    assert.equal(entry.newTotal, 34);
    assert.match(entry.reason, /expired/i);
    assert.equal(entry.updatedByName, "System");
  });

  await check("BX6 a carry that has not expired yet is left alone", async () => {
    const ctx = await newCompany({ dayPerWeek: 6 });
    const future = new Date();
    future.setMonth(future.getMonth() + 2);

    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.updateOne(
        { employeeId: ctx.founder._id, leaveYear: ctx.leaveYear },
        {
          $set: {
            "leaveData.$[annual].total": 44,
            "leaveData.$[annual].remaining": 44,
            "leaveData.$[annual].carryForwarded": 10,
            "leaveData.$[annual].carryForwardExpiresAt": future,
          },
        },
        { arrayFilters: [{ "annual.leaveType": "Annual Leave" }] }
      )
    );

    const result = await as(ctx, () => expireCarryForwardNow());
    assert.ok(result.success, result.message);
    assert.match(result.message, /nothing has expired/i);

    const annual = await entitlementFor(ctx, "Annual Leave");
    assert.equal(annual.total, 44);
    assert.equal(carriedState(annual).usable, 44);
  });

  await check("BX7 a carry with no expiry on its rule never lapses", async () => {
    const ctx = await newCompany({ dayPerWeek: 6 });
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.updateOne(
        { employeeId: ctx.founder._id, leaveYear: ctx.leaveYear },
        {
          $set: {
            "leaveData.$[annual].total": 44,
            "leaveData.$[annual].remaining": 44,
            "leaveData.$[annual].carryForwarded": 10,
            "leaveData.$[annual].carryForwardExpiresAt": null,
          },
        },
        { arrayFilters: [{ "annual.leaveType": "Annual Leave" }] }
      )
    );

    await as(ctx, () => expireCarryForwardNow());
    const annual = await entitlementFor(ctx, "Annual Leave");
    assert.equal(annual.total, 44);
    assert.equal(annual.carryForwardLapsed, undefined);
  });

  await check("BX8 the preview says what would go, without taking it", async () => {
    const { ctx } = await companyWithExpiredCarry({ used: 4 });

    const preview = await as(ctx, () => previewCarryForwardExpiry());
    assert.ok(preview.success, preview.message);
    const { rows, totals } = JSON.parse(preview.data);

    const row = rows.find((r) => r.leaveType === "Annual Leave");
    assert.ok(row, "the employee was not previewed");
    assert.equal(row.carried, 10);
    assert.equal(row.carriedUsed, 4);
    assert.equal(row.carriedRemaining, 6);
    assert.equal(row.hasExpired, true);
    assert.equal(row.willLapse, 6);
    assert.equal(totals.willLapse, 6);
    assert.equal(row.employeeName, "Founder");

    // Nothing was written by asking.
    const annual = await entitlementFor(ctx, "Annual Leave");
    assert.equal(annual.total, 44);
  });

  await check("BX9 an ordinary employee cannot run the expiry", async () => {
    const { ctx } = await companyWithExpiredCarry();
    actAs({ ...ctx.superAdmin, role: "user" });
    const response = await runWithTenant(ctx.tenantId, () =>
      expireCarryForwardNow()
    );
    assert.equal(response.success, false);

    const annual = await entitlementFor(ctx, "Annual Leave");
    assert.equal(annual.total, 44, "the expiry ran anyway");
  });

  /* ---------------------------------------------------------------------- */
  /* BE. Who carries forward                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * A company with carry-forward on, a rule, and an employee who has last
   * year's balance to carry. `rule` patches the Annual Leave rule.
   */
  async function companyWithRule({ rule = {}, employee = {} } = {}) {
    const ctx = await newCompany({ dayPerWeek: 6 });

    await runWithTenant(ctx.tenantId, () =>
      LeaveSetting.updateOne(
        {},
        {
          $set: {
            carryForwardEnabled: true,
            carryForwardRules: [
              {
                leaveType: "Annual Leave",
                allowed: true,
                maxDays: 10,
                expireAfterMonths: 0,
                ...rule,
              },
            ],
          },
        }
      )
    );

    if (Object.keys(employee).length) {
      await runWithTenant(ctx.tenantId, () =>
        OfficeEmploye.updateOne({ _id: ctx.founder._id }, { $set: employee })
      );
    }

    const thisYear = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({ employeeId: ctx.founder._id }).lean()
    );
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.create({
        employeeId: ctx.founder._id,
        leaveYear: getPreviousLeaveYearString(thisYear.leaveYear),
        leaveData: [
          {
            leaveType: "Annual Leave",
            total: 28,
            used: 0,
            remaining: 28,
            type: "days",
          },
        ],
      })
    );
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.deleteOne({ _id: thisYear._id })
    );
    return ctx;
  }

  /** Regenerate this year's entitlement and report the annual row. */
  const regenerate = async (ctx) => {
    const scan = await as(ctx, () =>
      syncMissingLeaveTypesNew(ctx.founder.joinDate, 6, String(ctx.founder._id))
    );
    assert.ok(scan.success, scan.message);
    return entitlementFor(ctx, "Annual Leave");
  };

  await check("BE1 AN EMPTY RULE STILL CARRIES FOR EVERYONE", async () => {
    // The default that protects the live company: rules written before these
    // fields existed have empty lists, and nothing changes for them.
    const ctx = await companyWithRule();
    const annual = await regenerate(ctx);
    assert.equal(annual.total, 44);
    assert.equal(annual.carryForwarded, 10);
    assert.equal(annual.carryForwardVia, "policy");
  });

  await check("BE2 A FULL-TIME-ONLY RULE EXCLUDES A PART-TIMER", async () => {
    const ctx = await companyWithRule({
      rule: { appliesTo: { employeeTypes: ["Full-Time"] } },
      employee: { employeType: "Part-Time" },
    });
    const annual = await regenerate(ctx);
    assert.equal(annual.total, 34, "the part-timer carried days anyway");
    assert.equal(annual.carryForwarded, undefined);
  });

  await check("BE3 …and still carries for a full-timer", async () => {
    const ctx = await companyWithRule({
      rule: { appliesTo: { employeeTypes: ["Full-Time"] } },
    });
    const annual = await regenerate(ctx);
    assert.equal(annual.total, 44);
    assert.equal(annual.carryForwarded, 10);
  });

  await check("BE4 a department rule excludes another department", async () => {
    const ctx = await companyWithRule();
    // Point the rule at a department the founder is not in.
    const other = await runWithTenant(ctx.tenantId, () =>
      RoleType.create({ roleTitle: `Elsewhere ${uniq()}`, isActive: true, delete: false })
    );
    await runWithTenant(ctx.tenantId, () =>
      LeaveSetting.updateOne(
        {},
        { $set: { "carryForwardRules.0.appliesTo.departments": [other._id] } }
      )
    );

    const annual = await regenerate(ctx);
    assert.equal(annual.total, 34);

    // And carries once the rule names their own department.
    const ctx2 = await companyWithRule();
    await runWithTenant(ctx2.tenantId, () =>
      LeaveSetting.updateOne(
        {},
        {
          $set: {
            "carryForwardRules.0.appliesTo.departments": [ctx2.department._id],
          },
        }
      )
    );
    const annual2 = await regenerate(ctx2);
    assert.equal(annual2.total, 44);
  });

  await check("BE5 a service requirement excludes a recent joiner", async () => {
    const recent = new Date();
    recent.setMonth(recent.getMonth() - 3);

    const ctx = await companyWithRule({
      rule: { minMonthsService: 12 },
      employee: { joinDate: recent },
    });
    const annual = await regenerate(ctx);
    assert.equal(annual.total, 34, "a three-month joiner carried days");

    const ctx2 = await companyWithRule({ rule: { minMonthsService: 12 } });
    const annual2 = await regenerate(ctx2); // joined 2020
    assert.equal(annual2.total, 44);
  });

  await check("BE6 a minimum-days rule excludes a small leftover", async () => {
    const ctx = await companyWithRule({ rule: { minDaysRemaining: 5 } });
    // Only 2 days left over last year.
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.updateOne(
        { employeeId: ctx.founder._id },
        {
          $set: {
            "leaveData.$[annual].remaining": 2,
            "leaveData.$[annual].used": 26,
          },
        },
        { arrayFilters: [{ "annual.leaveType": "Annual Leave" }] }
      )
    );

    const annual = await regenerate(ctx);
    assert.equal(annual.total, 34, "2 days carried despite a 5-day minimum");
  });

  await check("BE7 'NEVER' OVERRIDES A RULE THAT WOULD HAVE INCLUDED THEM", async () => {
    const ctx = await companyWithRule({
      employee: {
        carryForwardOverrides: [{ leaveType: "Annual Leave", mode: "never" }],
      },
    });
    const annual = await regenerate(ctx);
    assert.equal(annual.total, 34);
    assert.equal(annual.carryForwarded, undefined);
  });

  await check("BE8 'ALWAYS' OVERRIDES A RULE THAT WOULD HAVE EXCLUDED THEM", async () => {
    const ctx = await companyWithRule({
      rule: { appliesTo: { employeeTypes: ["Part-Time"] }, minMonthsService: 999 },
      employee: {
        carryForwardOverrides: [{ leaveType: "Annual Leave", mode: "always" }],
      },
    });
    const annual = await regenerate(ctx);
    assert.equal(annual.total, 44);
    assert.equal(annual.carryForwarded, 10);
    assert.equal(annual.carryForwardVia, "override-always");
  });

  await check("BE9 'always' does not carry when the company switch is off", async () => {
    // The override is about who qualifies, not about conjuring a rule.
    const ctx = await companyWithRule({
      employee: {
        carryForwardOverrides: [{ leaveType: "Annual Leave", mode: "always" }],
      },
    });
    await runWithTenant(ctx.tenantId, () =>
      LeaveSetting.updateOne({}, { $set: { carryForwardEnabled: false } })
    );
    const annual = await regenerate(ctx);
    assert.equal(annual.total, 34);
  });

  await check("BE10 the preview agrees with what the generator does", async () => {
    // The whole reason eligibility goes through the shared function.
    const ctx = await companyWithRule({
      rule: { appliesTo: { employeeTypes: ["Full-Time"] } },
      employee: { employeType: "Part-Time" },
    });

    const preview = await as(ctx, () => previewCarryForwardForCompany());
    assert.ok(preview.success, preview.message);
    const row = JSON.parse(preview.data).find(
      (r) =>
        String(r.employeeId) === String(ctx.founder._id) &&
        r.leaveType === "Annual Leave"
    );
    assert.ok(row, "the employee was not previewed");
    assert.equal(row.willCarry, 0);
    assert.equal(row.eligible, false);
    assert.match(row.explanation, /Full-Time/);

    const annual = await regenerate(ctx);
    assert.equal(annual.carryForwarded, undefined, "generator disagreed");
  });

  await check("BE11 PRO-RATING SCALES THE CAP TO A PART-TIMER'S WEEK", async () => {
    // `proRated` was saved and read by nothing, so a part-timer kept the
    // full-time cap. A three-day week should carry 6 of a 10-day allowance.
    const ctx = await companyWithRule({
      rule: { proRated: true },
      employee: { dayPerWeek: 3, employeType: "Part-Time" },
    });
    const scan = await as(ctx, () =>
      syncMissingLeaveTypesNew(ctx.founder.joinDate, 3, String(ctx.founder._id))
    );
    assert.ok(scan.success, scan.message);

    const annual = await entitlementFor(ctx, "Annual Leave");
    // 5.6 x 3 = 16.8 -> 17 for the year, plus 6 carried.
    assert.equal(annual.baseTotal, 17);
    assert.equal(annual.carryForwarded, 6, "the cap was not pro-rated");
    assert.equal(annual.total, 23);
  });

  await check("BE12 …and leaves it alone when the switch is off", async () => {
    const ctx = await companyWithRule({
      rule: { proRated: false },
      employee: { dayPerWeek: 3, employeType: "Part-Time" },
    });
    await as(ctx, () =>
      syncMissingLeaveTypesNew(ctx.founder.joinDate, 3, String(ctx.founder._id))
    );
    const annual = await entitlementFor(ctx, "Annual Leave");
    assert.equal(annual.carryForwarded, 10, "the full cap should still apply");
    assert.equal(annual.total, 27);
  });

  /* ---------------------------------------------------------------------- */
  /* BI. Naming an individual                                               */
  /* ---------------------------------------------------------------------- */

  await check("BI1 THE EXCEPTION LIST STARTS EMPTY AND NAMES ONLY EXCEPTIONS", async () => {
    const ctx = await companyWithRule();
    const empty = JSON.parse(
      (await as(ctx, () => getCarryForwardExceptions())).data
    );
    assert.deepEqual(empty.rows, [], "everyone follows the rule to begin with");
    // The types a rule actually carries, for the picker.
    assert.ok(empty.carryingTypes.includes("Annual Leave"));

    const set = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.ok(set.success, set.message);
    // The message names the leave type, since an exception is per type now.
    assert.match(set.message, /never carry Annual Leave forward/i);
    // This company's current year has not been generated in this fixture, so the
    // message says so rather than claiming a balance changed.
    assert.match(set.message, /no entitlement for/i);

    const listed = JSON.parse(
      (await as(ctx, () => getCarryForwardExceptions())).data
    ).rows;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].employeeId, String(ctx.founder._id));
    assert.equal(listed[0].mode, "never");
    assert.equal(listed[0].leaveType, "Annual Leave");
    assert.equal(listed[0].name, "Founder");
    // The department name, not its id — a row has to read as a person.
    assert.equal(listed[0].department, ctx.department.roleTitle);
  });

  await check("BI2 the named exception is what the generator then honours", async () => {
    const ctx = await companyWithRule();
    await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    const annual = await regenerate(ctx);
    assert.equal(annual.total, 34, "the named exception was ignored");
  });

  await check("BI3 'default' is how an exception is removed", async () => {
    const ctx = await companyWithRule();
    await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    const removed = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "default",
      })
    );
    assert.ok(removed.success, removed.message);
    assert.match(removed.message, /follows the company rule/i);

    const listed = JSON.parse(
      (await as(ctx, () => getCarryForwardExceptions())).data
    ).rows;
    assert.deepEqual(listed, []);

    const annual = await regenerate(ctx);
    assert.equal(annual.total, 44, "they should be back on the policy");
  });

  await check("BI4 setting the mode it already has is a no-op, not an error", async () => {
    const ctx = await companyWithRule();
    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "default",
      })
    );
    assert.ok(response.success, response.message);
    assert.match(response.message, /already their setting/i);
  });

  await check("BI5 an unknown mode is refused", async () => {
    const ctx = await companyWithRule();
    for (const mode of ["", null, undefined, "sometimes", "DEFAULT", true]) {
      const response = await as(ctx, () =>
        setCarryForwardMode({
          employeeIds: [String(ctx.founder._id)],
          leaveType: "Annual Leave",
          mode,
        })
      );
      assert.equal(response.success, false, `accepted ${JSON.stringify(mode)}`);
    }
    const employee = await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.findById(ctx.founder._id)
        .select("carryForwardOverrides")
        .lean()
    );
    assert.deepEqual(employee.carryForwardOverrides, []);
  });

  await check("BI6 an ordinary employee cannot except themselves", async () => {
    const ctx = await companyWithRule();
    actAs({ ...ctx.superAdmin, role: "user" });
    const response = await runWithTenant(ctx.tenantId, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "always",
      })
    );
    assert.equal(response.success, false);

    const listing = await runWithTenant(ctx.tenantId, () =>
      getCarryForwardExceptions()
    );
    assert.equal(listing.success, false, "the list should be guarded too");
  });

  await check("BI7 AN EXCEPTION ON ONE TYPE LEAVES THE OTHER ALONE", async () => {
    // The whole reason this is per type. Two carrying types, one exception.
    const ctx = await companyWithRule();
    await runWithTenant(ctx.tenantId, () =>
      LeaveSetting.updateOne(
        {},
        {
          $set: {
            carryForwardRules: [
              { leaveType: "Annual Leave", allowed: true, maxDays: 10 },
              { leaveType: "Bereavement Leave", allowed: true, maxDays: 3 },
            ],
          },
        }
      )
    );
    // Give them something to carry on both types last year.
    const prevYear = getPreviousLeaveYearString(ctx.leaveYear);
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.updateOne(
        { employeeId: ctx.founder._id, leaveYear: prevYear },
        {
          $set: {
            leaveData: [
              {
                leaveType: "Annual Leave",
                total: 28,
                used: 0,
                remaining: 28,
                type: "days",
              },
              {
                leaveType: "Bereavement Leave",
                total: 5,
                used: 0,
                remaining: 5,
                type: "days",
              },
            ],
          },
        }
      )
    );

    // Excepted from annual leave only.
    const set = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.ok(set.success, set.message);

    const annual = await regenerate(ctx);
    assert.equal(annual.carryForwarded, undefined, "annual leave still carried");

    const bereavement = await entitlementFor(ctx, "Bereavement Leave");
    assert.equal(
      bereavement.carryForwarded,
      3,
      "the exception leaked onto the other type"
    );
  });

  await check("BI8 one employee can hold opposite exceptions on two types", async () => {
    const ctx = await companyWithRule();
    for (const [leaveType, mode] of [
      ["Annual Leave", "never"],
      ["Bereavement Leave", "always"],
    ]) {
      const response = await as(ctx, () =>
        setCarryForwardMode({
          employeeIds: [String(ctx.founder._id)],
          leaveType,
          mode,
        })
      );
      assert.ok(response.success, response.message);
    }

    const rows = JSON.parse(
      (await as(ctx, () => getCarryForwardExceptions())).data
    ).rows;
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => `${r.leaveType}:${r.mode}`).sort(),
      ["Annual Leave:never", "Bereavement Leave:always"]
    );
    // Bereavement has no carry-forward rule here, so the screen can say so.
    const bereavement = rows.find((r) => r.leaveType === "Bereavement Leave");
    assert.equal(bereavement.typeCarries, false);
  });

  await check("BI9 an exception on a type with no rule is allowed, and flagged", async () => {
    // Useful for setting somebody up before the rule is switched on — but it
    // must not look as though it is doing something.
    const ctx = await companyWithRule();
    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Bereavement Leave",
        mode: "always",
      })
    );
    assert.ok(response.success, response.message);
    assert.match(response.message, /no carry-forward rule at the moment/i);
  });

  await check("BI10 an exception cannot be stored against a made-up leave type", async () => {
    const ctx = await companyWithRule();
    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: `Imaginary ${run}`,
        mode: "never",
      })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /not a leave type here/i);
  });

  await check("BI11 a missing leave type is refused rather than guessed", async () => {
    const ctx = await companyWithRule();
    for (const leaveType of [undefined, null, "", 5, {}]) {
      const response = await as(ctx, () =>
        setCarryForwardMode({
          employeeIds: [String(ctx.founder._id)],
          leaveType,
          mode: "never",
        })
      );
      assert.equal(response.success, false, JSON.stringify(leaveType));
    }
  });

  await check("BI12 MANY EMPLOYEES AT ONCE, BECAUSE TWENTY ONE-BY-ONE IS NOT A WORKFLOW", async () => {
    // A company of forty giving the exception to twenty of them is the ordinary
    // case. Twenty round trips through a dropdown is what makes somebody give up
    // half way and leave the setting half applied.
    const ctx = await companyWithRule();

    const extras = [];
    for (let i = 0; i < 5; i++) {
      extras.push(
        await runWithTenant(ctx.tenantId, () =>
          OfficeEmploye.create({
            name: `Bulk ${i} ${uniq()}`,
            email: `bulk${i}.${uniq()}.${run}@ops-test.invalid`,
            phoneNumber: Number(`77${Math.floor(Math.random() * 100000000)}`),
            password: "$2a$10$notarealhashnotarealhashno",
            roleType: "Labourer",
            department: ctx.department._id,
            company: ctx.company._id,
            employeType: "Full-Time",
            immigrationType: "British",
            joinDate: d("2021-01-01"),
            dayPerWeek: 5,
            isActive: true,
            delete: false,
          })
        )
      );
    }

    const ids = extras.map((e) => String(e._id));
    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: ids,
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.ok(response.success, response.message);
    assert.match(response.message, /5 employees will never carry/i);
    assert.equal(JSON.parse(response.data).changed, 5);

    const rows = JSON.parse(
      (await as(ctx, () => getCarryForwardExceptions())).data
    ).rows;
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.mode === "never"));
    assert.ok(rows.every((row) => row.leaveType === "Annual Leave"));
  });

  await check("BI13 a batch where some already have it reports both halves", async () => {
    const ctx = await companyWithRule();
    const second = await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.create({
        name: `Second ${uniq()}`,
        email: `second.${uniq()}.${run}@ops-test.invalid`,
        phoneNumber: Number(`77${Math.floor(Math.random() * 100000000)}`),
        password: "$2a$10$notarealhashnotarealhashno",
        roleType: "Labourer",
        department: ctx.department._id,
        company: ctx.company._id,
        employeType: "Full-Time",
        immigrationType: "British",
        joinDate: d("2021-01-01"),
        dayPerWeek: 5,
        isActive: true,
        delete: false,
      })
    );

    // One of them already excepted.
    await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );

    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id), String(second._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.ok(response.success, response.message);
    const summary = JSON.parse(response.data);
    assert.equal(summary.changed, 1);
    assert.equal(summary.unchanged, 1);
    assert.match(response.message, /1 already had it/i);
  });

  await check("BI14 a batch where nobody needs changing says so", async () => {
    const ctx = await companyWithRule();
    const ids = [String(ctx.founder._id)];
    await as(ctx, () =>
      setCarryForwardMode({ employeeIds: ids, leaveType: "Annual Leave", mode: "never" })
    );
    const again = await as(ctx, () =>
      setCarryForwardMode({ employeeIds: ids, leaveType: "Annual Leave", mode: "never" })
    );
    assert.ok(again.success, again.message);
    assert.match(again.message, /already their setting/i);
    assert.equal(JSON.parse(again.data).changed, 0);
  });

  await check("BI15 THE SAME ID TWICE IS ONE EMPLOYEE, NOT TWO WRITES", async () => {
    const ctx = await companyWithRule();
    const id = String(ctx.founder._id);
    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [id, id, id],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.ok(response.success, response.message);
    assert.equal(JSON.parse(response.data).changed, 1);

    const employee = await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.findById(id).select("carryForwardOverrides").lean()
    );
    assert.equal(employee.carryForwardOverrides.length, 1);
  });

  await check("BI16 A BAD ID STOPS THE WHOLE BATCH, NOT HALF OF IT", async () => {
    // Half-applying a batch is the worst outcome: the admin cannot tell which
    // half, and pressing it again is not obviously safe.
    const ctx = await companyWithRule();
    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id), "not-an-objectid"],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.equal(response.success, false);

    const employee = await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.findById(ctx.founder._id)
        .select("carryForwardOverrides")
        .lean()
    );
    assert.deepEqual(
      employee.carryForwardOverrides,
      [],
      "the valid half was written anyway"
    );
  });

  await check("BI17 an empty list is refused", async () => {
    const ctx = await companyWithRule();
    for (const employeeIds of [undefined, null, [], ""]) {
      const response = await as(ctx, () =>
        setCarryForwardMode({
          employeeIds,
          leaveType: "Annual Leave",
          mode: "never",
        })
      );
      assert.equal(response.success, false, JSON.stringify(employeeIds));
      assert.match(response.message, /at least one employee/i);
    }
  });

  await check("BI18 THE REMOVED FIELD IS NO LONGER READ", async () => {
    // `carryForwardMode` is gone from the schema. A value sitting in the
    // database is ignored rather than quietly overriding every leave type —
    // scripts/migrate-carry-forward-mode.mjs is what moves one across.
    const ctx = await companyWithRule();
    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.collection.updateOne(
        { _id: ctx.founder._id },
        { $set: { carryForwardMode: "never" } }
      )
    );

    const annual = await regenerate(ctx);
    assert.equal(annual.carryForwarded, 10, "the removed field still applied");

    const rows = JSON.parse(
      (await as(ctx, () => getCarryForwardExceptions())).data
    ).rows;
    assert.deepEqual(rows, [], "the removed field was still listed");
  });

  await check("BI19 SETTING AN EXCEPTION APPLIES IT TO THE CURRENT YEAR", async () => {
    // The problem this fixes: the exception was stored and the balance was not
    // touched, so it read as a setting that did nothing — and fixing it meant
    // visiting each employee's entitlement sheet, which is the one-at-a-time
    // problem all over again.
    const ctx = await companyWithRule();
    const before = await regenerate(ctx);
    assert.equal(before.total, 44, "44 = 34 for the year + 10 carried");

    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.ok(response.success, response.message);
    assert.match(response.message, /1 entitlement updated/i);

    const after = await entitlementFor(ctx, "Annual Leave");
    assert.equal(after.total, 34, "the balance was not recalculated");
    assert.equal(after.remaining, 34);
    assert.equal(after.carryForwarded, 0);
  });

  await check("BI20 …for everybody in the batch, not just the first", async () => {
    const ctx = await companyWithRule();
    const others = [];
    for (let i = 0; i < 3; i++) {
      others.push(
        await runWithTenant(ctx.tenantId, () =>
          OfficeEmploye.create({
            name: `Applied ${i} ${uniq()}`,
            email: `applied${i}.${uniq()}.${run}@ops-test.invalid`,
            phoneNumber: Number(`77${Math.floor(Math.random() * 100000000)}`),
            password: "$2a$10$notarealhashnotarealhashno",
            roleType: "Labourer",
            department: ctx.department._id,
            company: ctx.company._id,
            employeType: "Full-Time",
            immigrationType: "British",
            joinDate: d("2020-01-01"),
            dayPerWeek: 6,
            isActive: true,
            delete: false,
          })
        )
      );
    }

    // Everybody gets last year's leftovers and this year's entitlement.
    const prevYear = getPreviousLeaveYearString(ctx.leaveYear);
    for (const person of others) {
      await runWithTenant(ctx.tenantId, () =>
        CommonLeave.create({
          employeeId: person._id,
          leaveYear: prevYear,
          leaveData: [
            {
              leaveType: "Annual Leave",
              total: 28,
              used: 0,
              remaining: 28,
              type: "days",
            },
          ],
        })
      );
      const synced = await as(ctx, () =>
        syncMissingLeaveTypesNew(person.joinDate, 6, String(person._id))
      );
      assert.ok(synced.success, synced.message);
    }

    const ids = others.map((p) => String(p._id));
    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: ids,
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.ok(response.success, response.message);
    assert.match(response.message, /3 entitlements updated/i);

    for (const person of others) {
      const row = await runWithTenant(ctx.tenantId, async () => {
        const doc = await CommonLeave.findOne({
          employeeId: person._id,
          leaveYear: ctx.leaveYear,
        }).lean();
        return doc?.leaveData?.find((r) => r.leaveType === "Annual Leave");
      });
      assert.equal(row.total, 34, `${person.name} was not recalculated`);
      assert.equal(row.carryForwarded, 0);
    }
  });

  await check("BI21 applyNow:false stages the change without touching balances", async () => {
    const ctx = await companyWithRule();
    await regenerate(ctx);

    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
        applyNow: false,
      })
    );
    assert.ok(response.success, response.message);
    assert.match(response.message, /Not applied/i);

    const after = await entitlementFor(ctx, "Annual Leave");
    assert.equal(after.total, 44, "the balance moved despite applyNow:false");
    assert.equal(after.carryForwarded, 10);

    // The exception is stored, so it takes effect next time the year is built.
    const employee = await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.findById(ctx.founder._id)
        .select("carryForwardOverrides")
        .lean()
    );
    assert.equal(employee.carryForwardOverrides[0].mode, "never");
  });

  await check("BI22 removing an exception puts the carried days back", async () => {
    const ctx = await companyWithRule();
    await regenerate(ctx);
    await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.equal((await entitlementFor(ctx, "Annual Leave")).total, 34);

    const back = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "default",
      })
    );
    assert.ok(back.success, back.message);

    const after = await entitlementFor(ctx, "Annual Leave");
    assert.equal(after.total, 44, "the days did not come back");
    assert.equal(after.carryForwarded, 10);
  });

  await check("BI23 DAYS ALREADY TAKEN SURVIVE A BULK EXCEPTION", async () => {
    // The guarantee that makes applying by default safe: a recompute floors at
    // what has been spent, so nobody loses leave they have already booked.
    const ctx = await companyWithRule();
    await regenerate(ctx);
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.updateOne(
        { employeeId: ctx.founder._id, leaveYear: ctx.leaveYear },
        {
          $set: {
            "leaveData.$[annual].used": 4,
            "leaveData.$[annual].remaining": 40,
          },
        },
        { arrayFilters: [{ "annual.leaveType": "Annual Leave" }] }
      )
    );

    await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );

    const after = await entitlementFor(ctx, "Annual Leave");
    assert.equal(after.carryForwarded, 4, "a taken day was clawed back");
    assert.equal(after.total, 38);
    assert.equal(after.remaining, 34);
    assert.equal(after.total - after.used, after.remaining);
  });

  await check("BI24 somebody with no entitlement yet is reported, not failed", async () => {
    const ctx = await companyWithRule();
    // No regenerate(), so there is no entitlement document for this year.
    const response = await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
      })
    );
    assert.ok(response.success, response.message);
    assert.match(response.message, /no entitlement for/i);
    assert.equal(JSON.parse(response.data).applied.noEntitlement, 1);
  });

  await check("BI25 the bulk recompute can also be called on its own", async () => {
    const ctx = await companyWithRule();
    await regenerate(ctx);
    // Exception staged without applying, then applied separately.
    await as(ctx, () =>
      setCarryForwardMode({
        employeeIds: [String(ctx.founder._id)],
        leaveType: "Annual Leave",
        mode: "never",
        applyNow: false,
      })
    );
    assert.equal((await entitlementFor(ctx, "Annual Leave")).total, 44);

    const result = await as(ctx, () =>
      recomputeCarryForwardForMany({
        employeeIds: [String(ctx.founder._id)],
      })
    );
    assert.ok(result.success, result.message);
    assert.equal(JSON.parse(result.data).updated, 1);
    assert.equal((await entitlementFor(ctx, "Annual Leave")).total, 34);
  });

  await check("BI26 an ordinary employee cannot bulk-recompute", async () => {
    const ctx = await companyWithRule();
    await regenerate(ctx);
    actAs({ ...ctx.superAdmin, role: "user" });
    const response = await runWithTenant(ctx.tenantId, () =>
      recomputeCarryForwardForMany({ employeeIds: [String(ctx.founder._id)] })
    );
    assert.equal(response.success, false);
    assert.equal((await entitlementFor(ctx, "Annual Leave")).total, 44);
  });

  /* ---------------------------------------------------------------------- */
  /* BM. Recomputing after the rules change                                  */
  /* ---------------------------------------------------------------------- */

  await check("BM1 NARROWING A RULE CAN BE APPLIED TO AN EXISTING YEAR", async () => {
    // The gap: carry is worked out once when the year is generated, so changing
    // who qualifies in October would otherwise do nothing until next April.
    const ctx = await companyWithRule();
    const before = await regenerate(ctx);
    assert.equal(before.total, 44);

    // Now exclude them.
    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.updateOne(
        { _id: ctx.founder._id },
        {
          $set: {
            carryForwardOverrides: [
              { leaveType: "Annual Leave", mode: "never" },
            ],
          },
        }
      )
    );

    const result = await as(ctx, () =>
      recomputeCarryForward({ employeeId: String(ctx.founder._id) })
    );
    assert.ok(result.success, result.message);
    assert.match(result.message, /10 → 0/);

    const after = await entitlementFor(ctx, "Annual Leave");
    assert.equal(after.total, 34);
    assert.equal(after.remaining, 34);
    assert.equal(after.carryForwarded, 0);
  });

  await check("BM2 widening a rule can be applied too", async () => {
    const ctx = await companyWithRule({
      employee: {
        carryForwardOverrides: [{ leaveType: "Annual Leave", mode: "never" }],
      },
    });
    const before = await regenerate(ctx);
    assert.equal(before.total, 34);

    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.updateOne(
        { _id: ctx.founder._id },
        {
          $set: {
            carryForwardOverrides: [
              { leaveType: "Annual Leave", mode: "always" },
            ],
          },
        }
      )
    );

    const result = await as(ctx, () =>
      recomputeCarryForward({ employeeId: String(ctx.founder._id) })
    );
    assert.ok(result.success, result.message);

    const after = await entitlementFor(ctx, "Annual Leave");
    assert.equal(after.total, 44);
    assert.equal(after.carryForwarded, 10);
  });

  await check("BM3 DAYS ALREADY TAKEN ARE NEVER CLAWED BACK", async () => {
    // Four of the ten carried days were booked and approved before the rule
    // changed. Those cannot be undone — the carried figure floors at what was
    // spent, and the invariant still holds.
    const ctx = await companyWithRule();
    await regenerate(ctx);
    await runWithTenant(ctx.tenantId, () =>
      CommonLeave.updateOne(
        { employeeId: ctx.founder._id, leaveYear: ctx.leaveYear },
        {
          $set: {
            "leaveData.$[annual].used": 4,
            "leaveData.$[annual].remaining": 40,
          },
        },
        { arrayFilters: [{ "annual.leaveType": "Annual Leave" }] }
      )
    );

    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.updateOne(
        { _id: ctx.founder._id },
        {
          $set: {
            carryForwardOverrides: [
              { leaveType: "Annual Leave", mode: "never" },
            ],
          },
        }
      )
    );

    const result = await as(ctx, () =>
      recomputeCarryForward({ employeeId: String(ctx.founder._id) })
    );
    assert.ok(result.success, result.message);

    const after = await entitlementFor(ctx, "Annual Leave");
    assert.equal(after.carryForwarded, 4, "the four taken days were clawed back");
    assert.equal(after.total, 38);
    assert.equal(after.remaining, 34);
    assert.equal(after.total - after.used, after.remaining);
  });

  await check("BM4 recomputing twice changes nothing the second time", async () => {
    const ctx = await companyWithRule();
    await regenerate(ctx);
    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.updateOne(
        { _id: ctx.founder._id },
        {
          $set: {
            carryForwardOverrides: [
              { leaveType: "Annual Leave", mode: "never" },
            ],
          },
        }
      )
    );

    await as(ctx, () => recomputeCarryForward({ employeeId: String(ctx.founder._id) }));
    const once = await entitlementFor(ctx, "Annual Leave");

    const again = await as(ctx, () =>
      recomputeCarryForward({ employeeId: String(ctx.founder._id) })
    );
    assert.match(again.message, /already up to date/i);

    const twice = await entitlementFor(ctx, "Annual Leave");
    assert.equal(twice.total, once.total);
    assert.equal(twice.remaining, once.remaining);
  });

  await check("BM5 the recompute is explained in the history", async () => {
    const ctx = await companyWithRule();
    await regenerate(ctx);
    await runWithTenant(ctx.tenantId, () =>
      OfficeEmploye.updateOne(
        { _id: ctx.founder._id },
        {
          $set: {
            carryForwardOverrides: [
              { leaveType: "Annual Leave", mode: "never" },
            ],
          },
        }
      )
    );
    await as(ctx, () => recomputeCarryForward({ employeeId: String(ctx.founder._id) }));

    const doc = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({
        employeeId: ctx.founder._id,
        leaveYear: ctx.leaveYear,
      }).lean()
    );
    const entry = doc.leaveHistory.filter((r) =>
      /recalculated/i.test(r.reason || "")
    ).pop();
    assert.ok(entry, "the recompute was not recorded");
    assert.equal(entry.oldTotal, 44);
    assert.equal(entry.newTotal, 34);
    assert.match(
      entry.reason,
      /Annual Leave is set not to carry forward for this employee/i
    );
  });

  await check("BM6 an ordinary employee cannot recompute their own carry", async () => {
    const ctx = await companyWithRule();
    await regenerate(ctx);
    actAs({ ...ctx.superAdmin, role: "user" });
    const response = await runWithTenant(ctx.tenantId, () =>
      recomputeCarryForward({ employeeId: String(ctx.founder._id) })
    );
    assert.equal(response.success, false);
  });

  await check("BM7 recomputing a year with no entitlement says so", async () => {
    const ctx = await companyWithRule();
    await regenerate(ctx);
    const response = await as(ctx, () =>
      recomputeCarryForward({
        employeeId: String(ctx.founder._id),
        leaveYear: "2019-20",
      })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /no entitlements for 2019-20/i);
  });

  /* ---------------------------------------------------------------------- */
  /* C. Hiding, adding, removing                                             */
  /* ---------------------------------------------------------------------- */

  const opsCtx = await newCompany();

  await check("C1 A VISIBLE LEAVE TYPE CAN BE HIDDEN", async () => {
    // The guard was `if (... || !isHide) return "isHide is required"`, which
    // rejected the only value a visible row ever sends. Hide worked in exactly
    // one direction: you could reveal, never conceal.
    const before = await entitlementFor(opsCtx, "Bereavement Leave");
    assert.equal(before.isHide, false);

    const response = await as(opsCtx, () =>
      handleCommonLeaveStatus({
        leaveType: "Bereavement Leave",
        isHide: false, // the current state; the action flips it
        employeeId: String(opsCtx.founder._id),
        leaveYear: opsCtx.leaveYear,
      })
    );
    assert.ok(response.success, response.message);

    const after = await entitlementFor(opsCtx, "Bereavement Leave");
    assert.equal(after.isHide, true);
  });

  await check("C2 …and revealed again", async () => {
    const response = await as(opsCtx, () =>
      handleCommonLeaveStatus({
        leaveType: "Bereavement Leave",
        isHide: true,
        employeeId: String(opsCtx.founder._id),
        leaveYear: opsCtx.leaveYear,
      })
    );
    assert.ok(response.success, response.message);
    const after = await entitlementFor(opsCtx, "Bereavement Leave");
    assert.equal(after.isHide, false);
  });

  await check("C3 a non-boolean is still refused", async () => {
    const response = await as(opsCtx, () =>
      handleCommonLeaveStatus({
        leaveType: "Bereavement Leave",
        isHide: "yes",
        employeeId: String(opsCtx.founder._id),
        leaveYear: opsCtx.leaveYear,
      })
    );
    assert.equal(response.success, false);
  });

  await check("C4 AN ADDED LEAVE TYPE IS USABLE, NOT ZEROED", async () => {
    // `remaining` was hard-coded to 0 and `used` was set to the whole allowance,
    // so the button created a type with nothing available to book.
    await runWithTenant(opsCtx.tenantId, () =>
      LeaveCategory.create({
        leaveType: `Duvet Day ${run}`,
        total: 3,
        isPaid: "Paid",
        isHide: "Show",
        isActive: true,
        isDeleted: false,
      })
    );

    const response = await as(opsCtx, () =>
      addOneCommonLeaveToOneEmployee({
        leaveType: `Duvet Day ${run}`,
        leaveYear: opsCtx.leaveYear,
        employeeId: String(opsCtx.founder._id),
      })
    );
    assert.ok(response.success, response.message);

    const added = await entitlementFor(opsCtx, `Duvet Day ${run}`);
    assert.ok(added, "the leave type was not added");
    assert.equal(added.total, 3);
    assert.equal(added.used, 0);
    assert.equal(added.remaining, 3, "remaining must be the whole allowance");
  });

  await check("C5 an explicit number of days is honoured", async () => {
    await runWithTenant(opsCtx.tenantId, () =>
      LeaveCategory.create({
        leaveType: `Study ${run}`,
        total: 5,
        isActive: true,
        isDeleted: false,
      })
    );
    const response = await as(opsCtx, () =>
      addOneCommonLeaveToOneEmployee({
        leaveType: `Study ${run}`,
        leaveYear: opsCtx.leaveYear,
        employeeId: String(opsCtx.founder._id),
        leaveDays: 8,
      })
    );
    assert.ok(response.success, response.message);
    const added = await entitlementFor(opsCtx, `Study ${run}`);
    assert.equal(added.total, 8);
    assert.equal(added.remaining, 8);
  });

  await check("C6 adding the same type twice is refused", async () => {
    const response = await as(opsCtx, () =>
      addOneCommonLeaveToOneEmployee({
        leaveType: `Duvet Day ${run}`,
        leaveYear: opsCtx.leaveYear,
        employeeId: String(opsCtx.founder._id),
      })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /already added/i);
  });

  await check("C7 adding to a year with no entitlement document says so", async () => {
    const response = await as(opsCtx, () =>
      addOneCommonLeaveToOneEmployee({
        leaveType: `Duvet Day ${run}`,
        leaveYear: "2019-20",
        employeeId: String(opsCtx.founder._id),
      })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /no entitlements for 2019-20/i);
  });

  await check("C8 REMOVING A TYPE TAKES IT OUT OF THE BOOKING DROPDOWN", async () => {
    // `isDelete` was written and read by nothing, so a removed leave type stayed
    // in the employee's own dropdown with a balance behind it.
    const before = await as(opsCtx, () => getSelectLeaveRequestForEmployee());
    const beforeTypes = JSON.parse(before.data).map((row) => row.value);
    assert.ok(beforeTypes.includes(`Duvet Day ${run}`), "not offered to begin with");

    const removed = await as(opsCtx, () =>
      deleteOneCommonLeaveToOneEmployee({
        leaveType: `Duvet Day ${run}`,
        leaveYear: opsCtx.leaveYear,
        employeeId: String(opsCtx.founder._id),
      })
    );
    assert.ok(removed.success, removed.message);

    const after = await as(opsCtx, () => getSelectLeaveRequestForEmployee());
    const afterTypes = JSON.parse(after.data).map((row) => row.value);
    assert.ok(
      !afterTypes.includes(`Duvet Day ${run}`),
      "a removed leave type is still bookable"
    );
    // The row itself survives, so it can be restored and so history still refers
    // to something.
    const row = await entitlementFor(opsCtx, `Duvet Day ${run}`);
    assert.equal(row.isDelete, true);
  });

  await check("C9 restoring puts it back", async () => {
    const response = await as(opsCtx, () =>
      restoreOneCommonLeaveToOneEmployee({
        leaveType: `Duvet Day ${run}`,
        leaveYear: opsCtx.leaveYear,
        employeeId: String(opsCtx.founder._id),
      })
    );
    assert.ok(response.success, response.message);
    const row = await entitlementFor(opsCtx, `Duvet Day ${run}`);
    assert.equal(row.isDelete, false);

    const after = await as(opsCtx, () => getSelectLeaveRequestForEmployee());
    const types = JSON.parse(after.data).map((r) => r.value);
    assert.ok(types.includes(`Duvet Day ${run}`));
  });

  await check("C10 removing a type with days booked against it is refused", async () => {
    await runWithTenant(opsCtx.tenantId, () =>
      CommonLeave.updateOne(
        {
          employeeId: opsCtx.founder._id,
          leaveYear: opsCtx.leaveYear,
          "leaveData.leaveType": `Study ${run}`,
        },
        { $set: { "leaveData.$.used": 2, "leaveData.$.remaining": 6 } }
      )
    );
    const response = await as(opsCtx, () =>
      deleteOneCommonLeaveToOneEmployee({
        leaveType: `Study ${run}`,
        leaveYear: opsCtx.leaveYear,
        employeeId: String(opsCtx.founder._id),
      })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /already has 2 day/i);
    const row = await entitlementFor(opsCtx, `Study ${run}`);
    assert.notEqual(row.isDelete, true);
  });

  /* ---------------------------------------------------------------------- */
  /* D. The entitlements table                                               */
  /* ---------------------------------------------------------------------- */

  await check("D1 a search that matches nobody is an empty table, not an error", async () => {
    // `employeeWithLeave[0].totalCount[0].count` threw on an empty $facet, and
    // the catch reported it as "Failed to fetch common leave data".
    const ctx = await newCompany();
    const response = await as(ctx, () =>
      fetchCommonLeave({ query: `nobody-called-this-${uniq()}`, page: 1, pageSize: 10 })
    );
    assert.ok(response.success, response.message);
    assert.equal(response.totalCount, 0);
    assert.deepEqual(JSON.parse(response.data), []);
  });

  await check("D2 the table carries each employee's entitlement", async () => {
    const ctx = await newCompany();
    const response = await as(ctx, () =>
      fetchCommonLeave({ page: 1, pageSize: 10 })
    );
    assert.ok(response.success, response.message);
    const rows = JSON.parse(response.data);
    const founder = rows.find((r) => r._id === String(ctx.founder._id));
    assert.ok(founder, "the founder is not listed");
    assert.equal(founder.hasCommonLeave, true);
    assert.equal(founder.leaveYear, ctx.leaveYear);
    const annual = founder.leaveData.find((l) => l.leaveType === "Annual Leave");
    assert.equal(annual.total, 28);
    assert.equal(founder.password, undefined, "the password hash was projected");
  });

  /* ---------------------------------------------------------------------- */
  /* E. A company whose leave year is not April                              */
  /* ---------------------------------------------------------------------- */

  await check("E1 THE ENTITLEMENTS TABLE FINDS A JANUARY COMPANY'S LEAVE", async () => {
    // fetchCommonLeave passed the company's start month into
    // getLeaveYearString's *second* parameter — which, in the helper it imported,
    // is `short`, a boolean. The month was discarded and April's leave year was
    // looked up, so the $lookup matched nothing and every employee was shown as
    // having no entitlement at all.
    const ctx = await newCompany({ startMonth: 1 });

    const stored = await runWithTenant(ctx.tenantId, () =>
      CommonLeave.findOne({ employeeId: ctx.founder._id }).lean()
    );
    assert.ok(stored, "no entitlement was created");

    const response = await as(ctx, () =>
      fetchCommonLeave({ page: 1, pageSize: 10 })
    );
    assert.ok(response.success, response.message);
    const founder = JSON.parse(response.data).find(
      (r) => r._id === String(ctx.founder._id)
    );
    assert.equal(
      founder.hasCommonLeave,
      true,
      "the table looked up the wrong leave year"
    );
    assert.equal(founder.leaveYear, stored.leaveYear);
  });

  await check("E2 …AND THE EMPLOYEE CAN STILL SEE LEAVE TYPES TO BOOK", async () => {
    // The sharpest consequence: getSelectLeaveRequestForEmployee pinned the leave
    // year to April, found no entitlement document, and returned an EMPTY list —
    // so an employee at a January company could not request leave at all.
    const ctx = await newCompany({ startMonth: 1 });
    const response = await as(ctx, () => getSelectLeaveRequestForEmployee());
    assert.ok(response.success, response.message);
    const types = JSON.parse(response.data).map((r) => r.value);
    assert.ok(types.length > 0, "the booking dropdown came back empty");
    assert.ok(types.includes("Annual Leave"));
  });

  await check("E3 the leave year helper reads the company's own month", async () => {
    const jan = await newCompany({ startMonth: 1 });
    const apr = await newCompany({ startMonth: 4 });

    const janYear = await runWithTenant(jan.tenantId, () => currentLeaveYear());
    const aprYear = await runWithTenant(apr.tenantId, () => currentLeaveYear());

    const janStored = await runWithTenant(jan.tenantId, () =>
      CommonLeave.findOne({ employeeId: jan.founder._id }).lean()
    );
    const aprStored = await runWithTenant(apr.tenantId, () =>
      CommonLeave.findOne({ employeeId: apr.founder._id }).lean()
    );
    assert.equal(janStored.leaveYear, janYear);
    assert.equal(aprStored.leaveYear, aprYear);
  });

  /* ---------------------------------------------------------------------- */

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
