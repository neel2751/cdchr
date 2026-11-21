/**
 * Which sites a site manager can see and change.
 *
 * Only the site dropdown used to ask. The board, the attendance report, the
 * all-attendance export, assignment, moves and attendance edits took any site
 * id the browser sent, and "All" meant every site in the company. The dates on
 * a manager link were stored and never read, and any signed-in account could
 * write a manager link for itself. lib/siteAccess.js is the rule; this checks
 * the rule and that each action applies it.
 *
 * Needs a LOCAL replica-set database — it writes, and moves use transactions.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_sitescope?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-site-scope.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();

const results = [];
let withTenant = (fn) => fn();

function check(name, fn) {
  return Promise.resolve()
    .then(() => withTenant(fn))
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.db.dropDatabase();

  const { getSiteScope } = await import("@/lib/siteAccess");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const { getWorkingDate } = await import("@/lib/clockTime");
  const { getSelectProjects } = await import("@/server/selectServer/selectServer");
  const {
    fetchAssignedWithClocksNew,
    assignEmployeesToSite,
    fetchFilterClockRecordData,
    fetchClockRecordsTest,
    getTodayAssignedEmployees,
  } = await import("@/server/siteAssignmentServer/siteAssignmentServer");
  const {
    updateClockManuallyByIdNew,
    moveEmployeeToNewSite,
    reportAllAttendanceData,
  } = await import("@/server/timeOffServer/updateClockServer");
  const { handleSiteAssignManager, handleSiteAssignManagerStatus } =
    await import("@/server/siteAssignServer/siteAssignServer");

  const db = mongoose.connection.db;
  const oid = () => new mongoose.Types.ObjectId();
  const tenantId = oid();
  withTenant = (fn) => runWithTenant(String(tenantId), fn);

  const today = getWorkingDate();
  const yesterday = new Date(today.getTime() - DAY);
  const tomorrow = new Date(today.getTime() + DAY);
  const lastMonth = new Date(today.getTime() - 30 * DAY);

  const id = {
    superAdmin: oid(),
    reception: oid(),
    wide: oid(),
    manager: oid(),
    adminRoleManager: oid(),
    lapsed: oid(),
    future: oid(),
    inactive: oid(),
    endsToday: oid(),
    plain: oid(),
    office1: oid(),
    worker1: oid(),
    worker2: oid(),
    worker3: oid(),
  };
  const siteA = oid();
  const siteB = oid();

  const as = (key, role) =>
    actAs({ _id: String(id[key]), role, tenantId: String(tenantId) });

  /* ----------------------------------------------------------- fixtures */

  const withT = (docs) => docs.map((d) => ({ tenantId, ...d }));

  await db.collection("projectsites").insertMany(
    withT([
      { _id: siteA, siteName: "Alpha", isActive: true, siteDelete: false },
      { _id: siteB, siteName: "Bravo", isActive: true, siteDelete: false },
    ]),
  );

  await db.collection("employes").insertMany(
    withT([
      { _id: id.worker1, firstName: "Wanda", lastName: "A", isActive: true },
      { _id: id.worker2, firstName: "Walter", lastName: "B", isActive: true },
      { _id: id.worker3, firstName: "Wren", lastName: "C", isActive: true },
    ]),
  );
  await db.collection("officeemployes").insertMany(
    withT([
      { _id: id.manager, name: "Mona Manager", isActive: true },
      { _id: id.office1, name: "Olive Office", isActive: true },
    ]),
  );

  const grant = (employeeId, permissions) => ({
    name: "grant",
    employeeId,
    isActive: true,
    isDeleted: false,
    permissions,
  });
  const MANAGER_SCREENS = ["/admin/siteAssignEmployee", "/admin/filterAttendance"];
  await db.collection("rolebaseds").insertMany(
    withT([
      grant(id.wide, ["/admin/siteAssign"]),
      grant(id.manager, MANAGER_SCREENS),
      grant(id.adminRoleManager, MANAGER_SCREENS),
      grant(id.lapsed, MANAGER_SCREENS),
      grant(id.future, MANAGER_SCREENS),
      grant(id.inactive, MANAGER_SCREENS),
      grant(id.endsToday, MANAGER_SCREENS),
      grant(id.plain, ["/admin/expense"]),
    ]),
  );

  const link = (roleId, site, fields = {}) => ({
    loginSiteId: String(oid()),
    roleId,
    projectSiteID: site,
    startDate: lastMonth,
    endDate: null,
    isActive: true,
    isDelete: false,
    ...fields,
  });
  await db.collection("assignprojects").insertMany(
    withT([
      link(id.manager, siteA),
      // The manager ran Bravo too, until yesterday.
      link(id.manager, siteB, { endDate: yesterday }),
      link(id.adminRoleManager, siteA),
      link(id.lapsed, siteA, { endDate: yesterday }),
      link(id.future, siteA, { startDate: tomorrow }),
      link(id.inactive, siteA, { isActive: false }),
      link(id.endsToday, siteA, { endDate: today }),
    ]),
  );

  await db.collection("siteassignments").insertMany(
    withT([
      {
        siteId: siteA,
        assignDate: today,
        assignedEmployees: [{ employeeId: id.worker1, isLocked: false }],
      },
      {
        siteId: siteB,
        assignDate: today,
        assignedEmployees: [{ employeeId: id.worker2, isLocked: false }],
      },
    ]),
  );

  const recordA = oid();
  const recordB = oid();
  await db.collection("clockrecords").insertMany(
    withT([
      {
        _id: recordA,
        employeeId: id.worker1,
        employeeType: "Employee",
        siteId: siteA,
        locationId: oid(),
        date: today,
        clockIn: "08:00",
        isDeleted: false,
      },
      {
        _id: recordB,
        employeeId: id.worker2,
        employeeType: "Employee",
        siteId: siteB,
        locationId: oid(),
        date: today,
        clockIn: "08:00",
        isDeleted: false,
      },
      {
        employeeId: id.office1,
        employeeType: "OfficeEmployee",
        siteId: null,
        locationId: oid(),
        date: today,
        clockIn: "09:00",
        isDeleted: false,
      },
    ]),
  );

  const scopeOf = async (key, role) => {
    as(key, role);
    return getSiteScope();
  };

  /* ------------------------------------------------------------- the rule */

  await check("a super admin sees every site", async () => {
    const s = await scopeOf("superAdmin", "superAdmin");
    assert.equal(s.all, true);
    assert.equal(s.readOnly, false);
  });

  await check("reception sees every site, read only", async () => {
    const s = await scopeOf("reception", "reception");
    assert.equal(s.all, true);
    assert.equal(s.readOnly, true);
  });

  await check("a site employee sees only themselves", async () => {
    const s = await scopeOf("worker2", "siteEmployee");
    assert.equal(s.selfOnly, true);
    assert.equal(s.all, false);
  });

  await check("whoever holds the Site Managers screen sees every site", async () => {
    const s = await scopeOf("wide", "user");
    assert.equal(s.all, true);
  });

  await check("THE POINT: a manager sees only the site they manage now", async () => {
    const s = await scopeOf("manager", "user");
    assert.equal(s.all, false);
    assert.deepEqual(s.siteIds, [String(siteA)]);
  });

  await check("the admin role alone does not widen it", async () => {
    const s = await scopeOf("adminRoleManager", "admin");
    assert.equal(s.all, false);
    assert.deepEqual(s.siteIds, [String(siteA)]);
  });

  await check("a link that ended yesterday no longer counts", async () => {
    const s = await scopeOf("lapsed", "user");
    assert.deepEqual(s.siteIds, []);
  });

  await check("a link that starts tomorrow does not count yet", async () => {
    const s = await scopeOf("future", "user");
    assert.deepEqual(s.siteIds, []);
  });

  await check("a switched-off link does not count", async () => {
    const s = await scopeOf("inactive", "user");
    assert.deepEqual(s.siteIds, []);
  });

  await check("a link ending today still counts today", async () => {
    const s = await scopeOf("endsToday", "user");
    assert.deepEqual(s.siteIds, [String(siteA)]);
  });

  await check("someone with no link manages nothing", async () => {
    const s = await scopeOf("plain", "user");
    assert.deepEqual(s.siteIds, []);
  });

  /* ------------------------------------------------------ the site picker */

  await check("the picker offers a manager only their site", async () => {
    as("manager", "user");
    const res = await getSelectProjects();
    const labels = JSON.parse(res.data).map((o) => o.label);
    assert.deepEqual(labels, ["Alpha"]);
  });

  await check("the picker offers a site-wide person every site", async () => {
    as("wide", "user");
    const res = await getSelectProjects();
    const labels = JSON.parse(res.data).map((o) => o.label).sort();
    assert.deepEqual(labels, ["Alpha", "Bravo"]);
  });

  /* ------------------------------------------------------- the site board */

  await check("REGRESSION: the board refuses a manager another site", async () => {
    as("manager", "user");
    const res = await fetchAssignedWithClocksNew({ siteId: String(siteB) });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
  });

  await check("REGRESSION: 'All' on the board is all of my sites", async () => {
    as("manager", "user");
    const res = await fetchAssignedWithClocksNew({ siteId: "All" });
    const sites = JSON.parse(res.data).map((r) => r.siteName);
    assert.ok(sites.length > 0, "expected rows");
    assert.ok(sites.every((n) => n === "Alpha"), `got ${sites}`);
  });

  await check("a site employee sees only their own board rows", async () => {
    as("worker2", "siteEmployee");
    const res = await fetchAssignedWithClocksNew({
      siteId: "All",
      employeeId: String(id.worker1),
    });
    const rows = JSON.parse(res.data);
    assert.ok(rows.every((r) => String(r.employeeId) === String(id.worker2)));
  });

  /* ------------------------------------------------------- assignment */

  await check("REGRESSION: a manager cannot assign onto another site", async () => {
    as("manager", "user");
    const res = await assignEmployeesToSite({
      siteId: String(siteB),
      employee: [String(id.worker3)],
      assignDate: today,
    });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
  });

  await check("a manager can assign onto their own site", async () => {
    as("manager", "user");
    const res = await assignEmployeesToSite({
      siteId: String(siteA),
      employee: [String(id.worker3)],
      assignDate: today,
    });
    assert.equal(res.success, true, res.message);
  });

  await check("a manager cannot pull someone off another site", async () => {
    as("manager", "user");
    const res = await assignEmployeesToSite({
      siteId: String(siteA),
      employee: [String(id.worker2)],
      assignDate: today,
      moveExisting: true,
    });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
  });

  await check("reception cannot assign, even with every site in view", async () => {
    as("reception", "reception");
    const res = await assignEmployeesToSite({
      siteId: String(siteA),
      employee: [String(id.worker3)],
      assignDate: today,
    });
    assert.equal(res.success, false);
  });

  /* ------------------------------------------------------------- moves */

  await check("REGRESSION: a manager cannot move someone onto another site", async () => {
    as("manager", "user");
    const res = await moveEmployeeToNewSite({
      employeeId: String(id.worker1),
      toSiteId: String(siteB),
      date: today,
    });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
  });

  await check("REGRESSION: a manager cannot move someone off another site", async () => {
    as("manager", "user");
    const res = await moveEmployeeToNewSite({
      employeeId: String(id.worker2),
      toSiteId: String(siteA),
      date: today,
    });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
    const still = await db
      .collection("siteassignments")
      .findOne({ siteId: siteB, assignDate: today });
    assert.ok(
      still.assignedEmployees.some((e) => String(e.employeeId) === String(id.worker2)),
      "the refused move must not have taken effect",
    );
  });

  /* ---------------------------------------------------- attendance edits */

  await check("REGRESSION: a manager cannot edit a record on another site", async () => {
    as("manager", "user");
    const res = await updateClockManuallyByIdNew({
      id: String(recordB),
      clockIn: "07:00",
    });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
    const after = await db.collection("clockrecords").findOne({ _id: recordB });
    assert.equal(after.clockIn, "08:00");
  });

  await check("REGRESSION: a manager cannot create a record on another site", async () => {
    as("manager", "user");
    const res = await updateClockManuallyByIdNew({
      employeeId: String(id.worker3),
      siteId: String(siteB),
      date: yesterday,
      clockIn: "08:00",
    });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
  });

  await check("a manager's edit on their own site is not refused for the site", async () => {
    as("manager", "user");
    const res = await updateClockManuallyByIdNew({
      id: String(recordA),
      clockIn: "07:30",
    });
    assert.doesNotMatch(String(res.message), /do not manage/i);
  });

  /* ------------------------------------------------- report and export */

  await check("REGRESSION: the report refuses a manager another site", async () => {
    as("manager", "user");
    const res = await fetchFilterClockRecordData({
      siteId: String(siteB),
      fromDate: today,
      toDate: today,
    });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
  });

  await check("REGRESSION: the report's 'All' leaves other sites out", async () => {
    as("manager", "user");
    const res = await fetchFilterClockRecordData({
      siteId: "All",
      fromDate: today,
      toDate: today,
    });
    const text = JSON.stringify(res);
    assert.ok(text.includes("Alpha"), "own site missing");
    assert.ok(!text.includes("Bravo"), "another site's time leaked");
    assert.ok(text.includes("Olive Office"), "office time should be unchanged");
  });

  await check("REGRESSION: the all-attendance export refuses a site employee", async () => {
    as("worker2", "siteEmployee");
    const res = await reportAllAttendanceData();
    assert.equal(res.success, false);
  });

  await check("the all-attendance export holds only the manager's sites", async () => {
    as("manager", "user");
    const res = await reportAllAttendanceData();
    assert.equal(res.success, true, res.message);
    assert.ok(res.data.includes("Wanda"), "own site missing");
    assert.ok(!res.data.includes("Walter"), "another site's time leaked");
  });

  await check("today's assignments list only the manager's sites", async () => {
    as("manager", "user");
    const res = await getTodayAssignedEmployees();
    const sites = JSON.parse(res.data).map((a) => a.siteId?.siteName);
    assert.ok(sites.length > 0, "expected rows");
    assert.ok(sites.every((n) => n === "Alpha"), `got ${sites}`);
  });

  await check("a manager must name a site they manage on the record list", async () => {
    as("manager", "user");
    const res = await fetchClockRecordsTest({ siteId: "All" });
    assert.equal(res.success, false);
  });

  /* ------------------------------------------------------- manager links */

  await check("REGRESSION: nobody can make themselves a site manager", async () => {
    as("plain", "user");
    const res = await handleSiteAssignManager({
      roleId: String(id.plain),
      projectSiteID: String(siteB),
      startDate: lastMonth,
    });
    assert.equal(res.success, false);
    const made = await db
      .collection("assignprojects")
      .countDocuments({ roleId: id.plain });
    assert.equal(made, 0);
  });

  await check("REGRESSION: nobody can switch a link on without the screen", async () => {
    as("plain", "user");
    const res = await handleSiteAssignManagerStatus({ id: String(oid()), status: false });
    assert.equal(res.success, false);
  });

  await check("a new link is on, carries no email or password, and may be open-ended", async () => {
    as("superAdmin", "superAdmin");
    const res = await handleSiteAssignManager({
      roleId: String(id.office1),
      projectSiteID: String(siteB),
      startDate: today,
    });
    assert.equal(res.success, true, res.message);
    const made = await db.collection("assignprojects").findOne({
      roleId: id.office1,
      projectSiteID: siteB,
      endDate: null,
    });
    assert.ok(made, "link not written");
    assert.equal(made.isActive, true, "a new link must start switched on");
    assert.equal(made.password, undefined);
    assert.equal(made.email, undefined);
  });

  await check("an end date before the start is refused", async () => {
    as("superAdmin", "superAdmin");
    const res = await handleSiteAssignManager({
      roleId: String(id.office1),
      projectSiteID: String(siteA),
      startDate: today,
      endDate: yesterday,
    });
    assert.equal(res.success, false);
  });

  await db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s !== "pass");
  for (const [status, name] of results) {
    console.log(`  ${status === "pass" ? "ok  " : status}  ${name}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` — ${failed.length} FAILED` : ""),
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
