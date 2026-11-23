/**
 * Ongoing assignments, and who is expected where on a day.
 *
 * A day's assignment (SiteAssignment) and an ongoing one (StandingAssignment —
 * from a date, until a date or further notice, optionally on chosen weekdays)
 * both put somebody on a site. lib/roster.js is the one answer to "were they
 * meant to be here today", and the site board, the clock-in checks and the
 * employee's own page all ask it. What has to hold:
 *
 *   - an ongoing assignment counts on every day it covers, and only those:
 *     not before it starts, not after it ends, not on its days off;
 *   - a day's assignment and an ongoing one for the same person, site and day
 *     are one row on the board;
 *   - a manager can only create, see and end ongoing assignments on their own
 *     sites (lib/siteAccess.js).
 *
 * Needs a LOCAL replica-set database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_roster?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-roster.mjs
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
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const key = (date) => date.toISOString().slice(0, 10);

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.db.dropDatabase();
  const db = mongoose.connection.db;

  const { runWithTenant } = await import("@/lib/tenantContext");
  const { getWorkingDate } = await import("@/lib/clockTime");
  const { isRostered, rosteredSiteFor } = await import("@/lib/roster");
  const { fetchAssignedWithClocksNew, fetchClockRecordsTest } = await import(
    "@/server/siteAssignmentServer/siteAssignmentServer"
  );
  const { assignOngoing, endOngoing, getOngoingAssignments } = await import(
    "@/server/siteAssignmentServer/standingAssignmentServer"
  );

  const oid = () => new mongoose.Types.ObjectId();
  const tenantId = oid();
  withTenant = (fn) => runWithTenant(String(tenantId), fn);
  const T = (docs) => docs.map((d) => ({ tenantId, ...d }));

  // A week starting Monday 23 November 2026.
  const mon = day(2026, 11, 23);
  assert.equal(mon.getUTCDay(), 1, "fixture week must start on a Monday");
  const tue = new Date(mon.getTime() + DAY);
  const wed = new Date(mon.getTime() + 2 * DAY);
  const sun = new Date(mon.getTime() + 6 * DAY);

  const siteA = oid();
  const siteB = oid();
  const ada = oid(); // ongoing on A, Mondays and Wednesdays
  const ben = oid(); // ongoing on A every day, plus a day's assignment on Tuesday
  const cy = oid(); // ongoing on B
  const dee = oid(); // a day's assignment on A only
  const manager = oid();
  const superAdmin = oid();

  await db.collection("projectsites").insertMany(
    T([
      { _id: siteA, siteName: "Year 9 Maths", isActive: true, siteDelete: false },
      { _id: siteB, siteName: "Year 10 English", isActive: true, siteDelete: false },
    ]),
  );
  await db.collection("employes").insertMany(
    T([
      { _id: ada, firstName: "Ada", lastName: "L", isActive: true },
      { _id: ben, firstName: "Ben", lastName: "M", isActive: true },
      { _id: cy, firstName: "Cy", lastName: "N", isActive: true },
      { _id: dee, firstName: "Dee", lastName: "O", isActive: true },
    ]),
  );
  await db.collection("rolebaseds").insertOne({
    tenantId,
    name: "Teacher",
    employeeId: manager,
    isActive: true,
    isDeleted: false,
    permissions: ["/admin/siteAssignEmployee"],
  });
  await db.collection("assignprojects").insertOne({
    tenantId,
    loginSiteId: "t",
    roleId: manager,
    projectSiteID: siteA,
    startDate: day(2026, 1, 1),
    endDate: null,
    isActive: true,
    isDelete: false,
  });
  await db.collection("standingassignments").insertMany(
    T([
      { siteId: siteA, employeeId: ada, startDate: mon, endDate: null, days: [1, 3], isDeleted: false },
      { siteId: siteA, employeeId: ben, startDate: day(2026, 9, 1), endDate: null, days: [], isDeleted: false },
      { siteId: siteB, employeeId: cy, startDate: mon, endDate: null, days: [], isDeleted: false },
    ]),
  );
  await db.collection("siteassignments").insertMany(
    T([
      {
        siteId: siteA,
        assignDate: tue,
        assignedEmployees: [
          { employeeId: ben, isLocked: false },
          { employeeId: dee, isLocked: false },
        ],
      },
    ]),
  );

  const as = (id, role) =>
    actAs({ _id: String(id), role, tenantId: String(tenantId) });

  /* ------------------------------------------------------------ the roster */

  await check("an ongoing assignment counts on its own weekdays", async () => {
    assert.equal(await isRostered({ siteId: siteA, employeeId: ada, date: mon }), true);
    assert.equal(await isRostered({ siteId: siteA, employeeId: ada, date: wed }), true);
  });

  await check("…and not on its days off", async () => {
    assert.equal(await isRostered({ siteId: siteA, employeeId: ada, date: tue }), false);
  });

  await check("…and not before it starts", async () => {
    const before = new Date(mon.getTime() - 7 * DAY); // the Monday before
    assert.equal(await isRostered({ siteId: siteA, employeeId: ada, date: before }), false);
  });

  await check("…and not on another site", async () => {
    assert.equal(await isRostered({ siteId: siteB, employeeId: ada, date: mon }), false);
  });

  await check("a day's assignment still counts", async () => {
    assert.equal(await isRostered({ siteId: siteA, employeeId: dee, date: tue }), true);
    assert.equal(await isRostered({ siteId: siteA, employeeId: dee, date: wed }), false);
  });

  await check("where to clock in: the day's assignment, else the ongoing one", async () => {
    assert.equal(await rosteredSiteFor({ employeeId: cy, date: tue }), String(siteB));
    assert.equal(await rosteredSiteFor({ employeeId: dee, date: tue }), String(siteA));
    assert.equal(await rosteredSiteFor({ employeeId: dee, date: wed }), null);
  });

  /* --------------------------------------------------------- the site board */

  await check("THE POINT: the board shows an enrolled student every class day", async () => {
    as(superAdmin, "superAdmin");
    const res = await fetchAssignedWithClocksNew({
      siteId: String(siteA),
      fromDate: key(mon),
      toDate: key(sun),
      pageSize: 100,
    });
    const rows = JSON.parse(res.data);
    const adaDays = rows
      .filter((r) => String(r.employeeId) === String(ada))
      .map((r) => key(new Date(r.assignDate)))
      .sort();
    assert.deepEqual(adaDays, [key(mon), key(wed)]);
    assert.ok(rows.filter((r) => String(r.employeeId) === String(ada)).every((r) => r.standing));
  });

  await check("a day's and an ongoing assignment on one day are one row", async () => {
    as(superAdmin, "superAdmin");
    const res = await fetchAssignedWithClocksNew({
      siteId: String(siteA),
      fromDate: key(tue),
      toDate: key(tue),
      pageSize: 100,
    });
    const benRows = JSON.parse(res.data).filter(
      (r) => String(r.employeeId) === String(ben),
    );
    assert.equal(benRows.length, 1);
    assert.equal(benRows[0].standing, false, "the day's assignment should win");
  });

  await check("a manager's 'All' leaves out another site's ongoing people", async () => {
    as(manager, "user");
    const res = await fetchAssignedWithClocksNew({
      siteId: "All",
      fromDate: key(mon),
      toDate: key(sun),
      pageSize: 100,
    });
    const people = JSON.parse(res.data).map((r) => String(r.employeeId));
    assert.ok(people.includes(String(ada)));
    assert.ok(!people.includes(String(cy)), "Cy is on a site they do not manage");
  });

  await check("the employee's own page counts an ongoing assignment", async () => {
    as(cy, "siteEmployee");
    const res = await fetchClockRecordsTest({
      siteId: String(siteB),
      fromDate: key(tue),
      toDate: key(tue),
    });
    const me = JSON.parse(res.data).find((r) => String(r.employeeId) === String(cy));
    assert.ok(me, "Cy should be listed");
    assert.equal(me.isAssigned, true);
  });

  /* ------------------------------------------------ creating and ending them */

  const today = getWorkingDate();
  const dee2 = oid();
  await db.collection("employes").insertOne({
    tenantId,
    _id: dee2,
    firstName: "Eve",
    lastName: "P",
    isActive: true,
  });

  await check("a manager enrols someone on their own site from a date", async () => {
    as(manager, "user");
    const res = await assignOngoing({
      siteId: String(siteA),
      employee: [String(dee2)],
      startDate: key(today),
      days: ["1", "3"],
    });
    assert.equal(res.success, true, res.message);
    const row = await db.collection("standingassignments").findOne({ employeeId: dee2 });
    assert.deepEqual(row.days, [1, 3]);
    assert.equal(row.endDate, null);
  });

  await check("enrolling them again for the same dates is skipped", async () => {
    as(manager, "user");
    const res = await assignOngoing({
      siteId: String(siteA),
      employee: [String(dee2)],
      startDate: key(today),
    });
    assert.equal(res.success, false);
    assert.match(res.message, /already assigned/i);
  });

  await check("REGRESSION: a manager cannot enrol onto a site they do not manage", async () => {
    as(manager, "user");
    const res = await assignOngoing({
      siteId: String(siteB),
      employee: [String(dee2)],
      startDate: key(today),
    });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
  });

  await check("an end before the start, or a bad weekday, is refused", async () => {
    as(superAdmin, "superAdmin");
    const backwards = await assignOngoing({
      siteId: String(siteB),
      employee: [String(dee2)],
      startDate: key(wed),
      endDate: key(mon),
    });
    assert.equal(backwards.success, false);
    const badDay = await assignOngoing({
      siteId: String(siteB),
      employee: [String(dee2)],
      startDate: key(mon),
      days: [9],
    });
    assert.equal(badDay.success, false);
  });

  await check("the ongoing list holds only the manager's sites", async () => {
    as(manager, "user");
    const res = await getOngoingAssignments({ siteId: "All" });
    const sites = new Set(JSON.parse(res.data).map((r) => r.siteName));
    assert.deepEqual([...sites], ["Year 9 Maths"]);
  });

  await check("REGRESSION: a manager cannot end one on another site", async () => {
    const cyRow = await db.collection("standingassignments").findOne({ employeeId: cy });
    as(manager, "user");
    const res = await endOngoing({ id: String(cyRow._id) });
    assert.equal(res.success, false);
    assert.match(res.message, /do not manage/i);
  });

  await check("ending one makes today the last day", async () => {
    const benRow = await db.collection("standingassignments").findOne({ employeeId: ben });
    as(manager, "user");
    const res = await endOngoing({ id: String(benRow._id) });
    assert.equal(res.success, true, res.message);
    const after = await db.collection("standingassignments").findOne({ _id: benRow._id });
    assert.equal(key(after.endDate), key(today));
    // The day after, skipping the fixture Tuesday on which Ben also has a
    // day's assignment — that one still stands, correctly.
    let later = new Date(today.getTime() + DAY);
    if (key(later) === key(tue)) later = new Date(later.getTime() + DAY);
    assert.equal(await isRostered({ siteId: siteA, employeeId: ben, date: later }), false);
  });

  await check("ending one that has not started cancels it", async () => {
    as(superAdmin, "superAdmin");
    const future = new Date(today.getTime() + 30 * DAY);
    await assignOngoing({
      siteId: String(siteB),
      employee: [String(dee2)],
      startDate: key(future),
    });
    const row = await db
      .collection("standingassignments")
      .findOne({ employeeId: dee2, siteId: siteB });
    const res = await endOngoing({ id: String(row._id) });
    assert.equal(res.success, true, res.message);
    const after = await db.collection("standingassignments").findOne({ _id: row._id });
    assert.equal(after.isDeleted, true);
  });

  await db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s === "FAIL");
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
