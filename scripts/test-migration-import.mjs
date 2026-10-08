/**
 * The staff import, driven through its own server actions.
 *
 * scripts/test-migration.mjs covers the reading of a file. This covers the half
 * that needs a database: whether a row is a new person, somebody already here,
 * or an email that is already a login somewhere else on the platform. That
 * question is the reason the feature is careful, so it is tested against real
 * documents rather than a mock — an email in this app is a credential, and
 * `findAccountsByEmail` in server/authServer/authServer.js looks one up across
 * four collections and every tenant with no filter at all.
 *
 * Needs a LOCAL database — it writes, and refuses to run against anything else.
 *
 *   docker run -d --name cdchr-test-mongo -p 27017:27017 mongo:7 \
 *     --replSet rs0 --bind_ip_all
 *   docker exec cdchr-test-mongo mongosh --quiet --eval \
 *     'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
 *
 * Then:
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-migration-import.mjs
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

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error(
      "Set MONGO_DB_URL to a LOCAL database. This script writes employee records."
    );
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const { actAs } = await import("@/scripts/lib/session-stub");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const Company = (await import("@/models/companyModel")).default;
  const RoleType = (await import("@/models/roleTypeModel")).default;
  const OfficeEmploye = (await import("@/models/officeEmployeeModel")).default;
  const Employe = (await import("@/models/employeModel")).default;
  const { analyseMigration, commitMigration } = await import(
    "@/server/migrationServer/migrationServer"
  );

  const run = uniq();
  const email = (name) => `${name}.${run}@migration-test.invalid`;

  // Two companies, because the sharpest rule in the feature is about the one
  // that is not yours.
  const ours = await Company.create({ name: `Import Test ${run}` });
  const theirs = await Company.create({ name: `Other Co ${run}` });

  const department = await runWithTenant(String(ours._id), () =>
    RoleType.create({ roleTitle: `Operations ${run}`, isActive: true, delete: false })
  );

  const superAdmin = {
    _id: new mongoose.Types.ObjectId().toString(),
    name: "Import Tester",
    email: email("tester"),
    role: "superAdmin",
    tenantId: String(ours._id),
  };

  const OFFICE_HEADERS =
    "Full Name,Email Address,Phone Number,Department,Job Title,Employment Type,Start Date,Immigration Type";
  const officeRow = (name, address, phone) =>
    `${name},${address},${phone},${department.roleTitle},Manager,Full-Time,01/04/2023,British`;

  const officeCsv = (...rows) => [OFFICE_HEADERS, ...rows].join("\n");

  /** Analyse as the super admin of "ours", and hand back the parsed report. */
  const analyse = async (csvText, options = {}) => {
    actAs(superAdmin);
    const response = await runWithTenant(String(ours._id), () =>
      analyseMigration({ kind: "office", csvText, options })
    );
    assert.ok(response.success, response.message);
    return JSON.parse(response.data);
  };

  const commit = async (csvText, options = {}) => {
    actAs(superAdmin);
    return runWithTenant(String(ours._id), () =>
      commitMigration({ kind: "office", csvText, options })
    );
  };

  /* ---------------------------------------------------------------------- */
  /* A. Authorisation                                                        */
  /* ---------------------------------------------------------------------- */

  await check("A1 signed out: refused", async () => {
    actAs(null);
    const response = await analyseMigration({
      kind: "office",
      csvText: officeCsv(officeRow("Ann", email("ann"), "07700900001")),
      options: {},
    });
    assert.equal(response.success, false);
  });

  await check("A2 an ordinary admin cannot import", async () => {
    actAs({ ...superAdmin, role: "admin" });
    const response = await analyseMigration({
      kind: "office",
      csvText: officeCsv(officeRow("Ann", email("ann"), "07700900001")),
      options: {},
    });
    assert.equal(response.success, false);
    assert.match(response.message, /super admin/i);
  });

  await check("A3 an ordinary employee cannot import", async () => {
    actAs({ ...superAdmin, role: "user" });
    const response = await commitMigration({
      kind: "office",
      csvText: officeCsv(officeRow("Ann", email("ann"), "07700900001")),
      options: {},
    });
    assert.equal(response.success, false);
  });

  /* ---------------------------------------------------------------------- */
  /* B. The happy path                                                       */
  /* ---------------------------------------------------------------------- */

  await check("B1 a clean file reports what it will do, and writes nothing", async () => {
    const report = await analyse(
      officeCsv(
        officeRow("Ann Green", email("ann"), "07700900001"),
        officeRow("Bo Reid", email("bo"), "07700900002")
      )
    );
    assert.equal(report.totals.rows, 2);
    assert.equal(report.totals.create, 2);
    assert.equal(report.totals.error, 0);

    const written = await runWithTenant(String(ours._id), () =>
      OfficeEmploye.countDocuments({ email: email("ann") })
    );
    assert.equal(written, 0, "analyse must not write");
  });

  await check("B2 committing creates the people", async () => {
    const response = await commit(
      officeCsv(
        officeRow("Ann Green", email("ann"), "07700900001"),
        officeRow("Bo Reid", email("bo"), "07700900002")
      )
    );
    assert.ok(response.success, response.message);
    const result = JSON.parse(response.data);
    assert.equal(result.created, 2);
    assert.equal(result.failed, 0);

    const ann = await runWithTenant(String(ours._id), () =>
      OfficeEmploye.findOne({ email: email("ann") }).lean()
    );
    assert.ok(ann, "Ann was not created");
    assert.equal(String(ann.tenantId), String(ours._id));
    assert.equal(ann.phoneNumber, 7700900001);
    assert.equal(String(ann.department), String(department._id));
  });

  await check("B3 IMPORTED ACCOUNTS CANNOT BE SIGNED INTO UNTIL A PASSWORD IS SET", async () => {
    // Nobody holds the password — not the importer, not us. The alternative is
    // one shared starting password across an entire company's staff.
    const ann = await runWithTenant(String(ours._id), () =>
      OfficeEmploye.findOne({ email: email("ann") }).lean()
    );
    assert.equal(ann.mustChangePassword, true);
    assert.ok(ann.password && ann.password.startsWith("$2"), "not a bcrypt hash");
  });

  /* ---------------------------------------------------------------------- */
  /* C. Duplicates — the point of the feature                                */
  /* ---------------------------------------------------------------------- */

  await check("C1 the same email twice in one file is caught on the second", async () => {
    const report = await analyse(
      officeCsv(
        officeRow("Cal One", email("cal"), "07700900003"),
        officeRow("Cal Two", email("cal"), "07700900004")
      )
    );
    assert.equal(report.totals.create, 1);
    assert.equal(report.totals.error, 1);
    assert.match(report.rows[1].errors.join(" "), /line 2/);
  });

  await check("C2 CASE DOES NOT MAKE A SECOND PERSON", async () => {
    // Office emails are lower-cased on write; site emails are not. A
    // case-sensitive check would create a second login for the same address.
    const report = await analyse(
      officeCsv(officeRow("Ann Green", email("ann").toUpperCase(), "07700900009"))
    );
    assert.equal(report.rows[0].status, "skip");
  });

  await check("C3 somebody already on this list is skipped by default", async () => {
    const report = await analyse(
      officeCsv(officeRow("Ann Green", email("ann"), "07700900001"))
    );
    assert.equal(report.totals.skip, 1);
    assert.equal(report.totals.create, 0);
  });

  await check("C4 'update' fills their record in without touching their email", async () => {
    const before = await runWithTenant(String(ours._id), () =>
      OfficeEmploye.findOne({ email: email("ann") }).lean()
    );
    const response = await commit(
      officeCsv(
        `Ann Greenwood,${email("ann")},07700900001,${department.roleTitle},Head of Operations,Full-Time,01/04/2023,British`
      ),
      { duplicateStrategy: "update" }
    );
    assert.ok(response.success, response.message);
    const result = JSON.parse(response.data);
    assert.equal(result.updated, 1);
    assert.equal(result.created, 0);

    const after = await runWithTenant(String(ours._id), () =>
      OfficeEmploye.findOne({ _id: before._id }).lean()
    );
    assert.equal(after.name, "Ann Greenwood");
    assert.equal(after.roleType, "Head of Operations");
    assert.equal(after.email, email("ann"), "the email must not change");
    assert.equal(after.password, before.password, "the password must not change");
  });

  await check("C5 AN EMAIL THAT SIGNS IN TO ANOTHER COMPANY IS REFUSED", async () => {
    // The whole reason this feature is careful. Two records sharing an email
    // are two candidates for one login, and login has no tenant to filter by.
    await runWithTenant(String(theirs._id), () =>
      OfficeEmploye.create({
        name: "Their Person",
        email: email("shared"),
        phoneNumber: 7700900500,
        password: "$2a$10$notarealhashnotarealhashno",
        roleType: "Manager",
        department: new mongoose.Types.ObjectId(),
        employeType: "Full-Time",
        immigrationType: "British",
        joinDate: new Date(),
      })
    );

    const report = await analyse(
      officeCsv(officeRow("Our Person", email("shared"), "07700900006"))
    );
    assert.equal(report.totals.error, 1);
    assert.match(report.rows[0].errors.join(" "), /different company/i);
  });

  await check("C6 an email already on the OTHER staff list here is refused", async () => {
    await runWithTenant(String(ours._id), () =>
      Employe.create({
        firstName: "Site",
        lastName: "Person",
        email: email("crosslist"),
        phone: 7700900600,
        password: "$2a$10$notarealhashnotarealhashno",
        eAddress: { address: "1 Road", postCode: "M1 1AA" },
        employeType: "CIS",
        paymentType: "Weekly",
        cisDeduction: 20,
        payType: "Hourly",
        payRate: 15,
        startDate: new Date(),
        employeRole: "Labourer",
        immigrationType: "British",
        emergencyName: "Someone",
      })
    );

    const report = await analyse(
      officeCsv(officeRow("Same Person", email("crosslist"), "07700900007"))
    );
    assert.equal(report.totals.error, 1);
    assert.match(report.rows[0].errors.join(" "), /site employee/i);
  });

  await check("C7 a phone already used here blocks the row by default", async () => {
    const report = await analyse(
      officeCsv(officeRow("Phone Twin", email("twin"), "07700900001"))
    );
    assert.equal(report.totals.error, 1);
    assert.match(report.rows[0].errors.join(" "), /phone number/i);
  });

  await check("C8 …and is only a warning when sharing is allowed", async () => {
    const report = await analyse(
      officeCsv(officeRow("Phone Twin", email("twin"), "07700900001")),
      { allowSharedPhones: true }
    );
    assert.equal(report.totals.error, 0);
    assert.equal(report.totals.create, 1);
    assert.match(report.rows[0].warnings.join(" "), /phone number/i);
  });

  await check("C9 the same number written +44 is the same number", async () => {
    const report = await analyse(
      officeCsv(officeRow("Plus Four Four", email("plus"), "+44 7700 900001"))
    );
    assert.equal(report.totals.error, 1);
    assert.match(report.rows[0].errors.join(" "), /phone number/i);
  });

  /* ---------------------------------------------------------------------- */
  /* D. Departments, privileges and failure reporting                        */
  /* ---------------------------------------------------------------------- */

  await check("D1 an unknown department stops the row, and says how to fix it", async () => {
    const csv = officeCsv(
      `Dee New,${email("dee")},07700900008,Marketing ${run},Manager,Full-Time,01/04/2023,British`
    );
    const report = await analyse(csv);
    assert.equal(report.totals.error, 1);
    assert.match(report.rows[0].errors.join(" "), /does not exist/i);
    assert.deepEqual(report.departments.missing, [`Marketing ${run}`]);
  });

  await check("D2 …unless asked to create the missing ones", async () => {
    const csv = officeCsv(
      `Dee New,${email("dee")},07700900008,Marketing ${run},Manager,Full-Time,01/04/2023,British`
    );
    const report = await analyse(csv, { createMissingDepartments: true });
    assert.equal(report.totals.error, 0);
    assert.equal(report.departments.willCreate, true);

    const response = await commit(csv, { createMissingDepartments: true });
    assert.ok(response.success, response.message);
    assert.equal(JSON.parse(response.data).created, 1);

    const created = await runWithTenant(String(ours._id), () =>
      RoleType.findOne({ roleTitle: `Marketing ${run}` }).lean()
    );
    assert.ok(created, "the department was not created");
    assert.equal(String(created.tenantId), String(ours._id));
  });

  await check("D3 A CSV CANNOT MAKE SOMEBODY A SUPER ADMIN", async () => {
    // Every exported server action is an addressable endpoint, and isAdmin /
    // isSuperAdmin are real fields on this schema. The column whitelist is the
    // thing standing between a spreadsheet and an admin account.
    const csv = [
      `${OFFICE_HEADERS},isSuperAdmin,isAdmin,delete,password,tenantId`,
      `${officeRow("Sneaky Sam", email("sam"), "07700900010")},true,true,false,hunter2,${theirs._id}`,
    ].join("\n");

    const report = await analyse(csv);
    assert.equal(report.totals.create, 1);
    assert.equal(report.columns.ignored.length, 5);

    const response = await commit(csv);
    assert.ok(response.success, response.message);

    const sam = await runWithTenant(String(ours._id), () =>
      OfficeEmploye.findOne({ email: email("sam") }).lean()
    );
    assert.equal(sam.isSuperAdmin, false, "isSuperAdmin was set from a CSV");
    assert.equal(sam.isAdmin, false, "isAdmin was set from a CSV");
    assert.equal(String(sam.tenantId), String(ours._id), "tenantId was set from a CSV");
    assert.notEqual(sam.password, "hunter2");
  });

  await check("D4 a file missing a required column is refused whole", async () => {
    actAs(superAdmin);
    const response = await runWithTenant(String(ours._id), () =>
      analyseMigration({
        kind: "office",
        csvText: "Full Name,Phone Number\nAnn,07700900001",
        options: {},
      })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /Email Address/);
  });

  await check("D5 a file where everything is already here is refused, not 'imported'", async () => {
    const response = await commit(
      officeCsv(officeRow("Ann Greenwood", email("ann"), "07700900001"))
    );
    assert.equal(response.success, false);
    assert.match(response.message, /nothing new/i);
  });

  await check("D6 rejected rows come back as a file with the reason attached", async () => {
    const good = officeRow("Good Person", email("good"), "07700900011");
    const bad = officeRow("Bad Person", "not-an-email", "07700900012");
    const report = await analyse(officeCsv(good, bad));
    assert.equal(report.totals.create, 1);
    assert.equal(report.totals.error, 1);

    // A row that fails validation never reaches the write loop, so the returned
    // file covers rows that failed *at* the write. Commit the pair and check
    // the good one still landed — a bad row must not take a good one with it.
    const response = await commit(officeCsv(good, bad));
    assert.ok(response.success, response.message);
    const result = JSON.parse(response.data);
    assert.equal(result.created, 1);

    const landed = await runWithTenant(String(ours._id), () =>
      OfficeEmploye.findOne({ email: email("good") }).lean()
    );
    assert.ok(landed, "the valid row did not land");
  });

  await check("D7 an empty file is refused with a readable reason", async () => {
    actAs(superAdmin);
    const response = await runWithTenant(String(ours._id), () =>
      analyseMigration({ kind: "office", csvText: OFFICE_HEADERS, options: {} })
    );
    assert.equal(response.success, false);
    assert.match(response.message, /no rows/i);
  });

  /* ---------------------------------------------------------------------- */
  /* E. The other list                                                       */
  /* ---------------------------------------------------------------------- */

  const SITE_HEADERS =
    "First Name,Last Name,Email Address,Phone Number,Job Role,Payment Type," +
    "Pay Type,Pay Rate,Start Date,Immigration Type,Address Line 1,Postcode," +
    "Emergency Contact Name";

  const siteCommit = async (rows, options = {}) => {
    actAs(superAdmin);
    return runWithTenant(String(ours._id), () =>
      commitMigration({
        kind: "site",
        csvText: [SITE_HEADERS, ...rows].join("\n"),
        options,
      })
    );
  };

  await check("E1 site employees import into their own collection", async () => {
    const response = await siteCommit([
      `Tomasz,Nowak,${email("tomasz")},07700 900701,Carpenter,Weekly,Hourly,£18.50,03/06/2024,British,12 Mill Lane,M15 5FQ,Sara Nowak`,
    ]);
    assert.ok(response.success, response.message);
    assert.equal(JSON.parse(response.data).created, 1);

    const tomasz = await runWithTenant(String(ours._id), () =>
      Employe.findOne({ email: email("tomasz") }).lean()
    );
    assert.ok(tomasz, "the site employee was not created");
    assert.equal(tomasz.payRate, 18.5);
    assert.equal(tomasz.phone, 7700900701);
    assert.equal(tomasz.eAddress.postCode, "M15 5FQ");
    assert.equal(tomasz.eAddress.country, "United Kingdom");
    // Weekly is CIS — the same derivation the single-employee form makes.
    assert.equal(tomasz.employeType, "CIS");
    assert.equal(tomasz.mustChangePassword, true);
  });

  await check("E2 a monthly-paid site employee is filed as payroll", async () => {
    const response = await siteCommit([
      `Maria,Silva,${email("maria")},07700 900702,Supervisor,Monthly,Monthly,2800,03/06/2024,British,3 High Street,M1 2AB,Joao Silva`,
    ]);
    assert.ok(response.success, response.message);
    const maria = await runWithTenant(String(ours._id), () =>
      Employe.findOne({ email: email("maria") }).lean()
    );
    assert.equal(maria.employeType, "Payroll");
    assert.equal(maria.cisDeduction, 0);
  });

  await check("E3 A SITE IMPORT SEES AN EMAIL ALREADY ON THE OFFICE LIST", async () => {
    // The mirror of C6. Both directions matter: whichever list you import into,
    // the email is checked against all four collections.
    actAs(superAdmin);
    const response = await runWithTenant(String(ours._id), () =>
      analyseMigration({
        kind: "site",
        csvText: [
          SITE_HEADERS,
          `Ann,Greenwood,${email("ann")},07700 900703,Labourer,Weekly,Hourly,15,03/06/2024,British,1 Road,M1 1AA,Someone`,
        ].join("\n"),
        options: {},
      })
    );
    assert.ok(response.success, response.message);
    const report = JSON.parse(response.data);
    assert.equal(report.totals.error, 1);
    assert.match(report.rows[0].errors.join(" "), /office staff/i);
  });

  await check("E4 a site row with no address is imported and flagged", async () => {
    const response = await siteCommit([
      `Ivan,Kovac,${email("ivan")},07700 900704,Labourer,Weekly,Hourly,16,03/06/2024,British,,,`,
    ]);
    assert.ok(response.success, response.message);
    assert.equal(JSON.parse(response.data).created, 1);

    const ivan = await runWithTenant(String(ours._id), () =>
      Employe.findOne({ email: email("ivan") }).lean()
    );
    assert.equal(ivan.eAddress.address, "Not provided");
    assert.equal(ivan.emergencyName, "Not provided");
    const row = JSON.parse(response.data).rows[0];
    assert.ok(row.warnings.length >= 2, "the gaps were not reported");
  });

  /* ---------------------------------------------------------------------- */

  // Clean up everything this run created. Keyed on the run suffix so a failed
  // run leaves nothing behind for the next one to trip over.
  const suffix = new RegExp(`${run}@migration-test\\.invalid$`);
  await OfficeEmploye.collection.deleteMany({ email: suffix });
  await Employe.collection.deleteMany({ email: suffix });
  await RoleType.collection.deleteMany({ roleTitle: new RegExp(run) });
  await Company.collection.deleteMany({ _id: { $in: [ours._id, theirs._id] } });

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
