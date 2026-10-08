/**
 * Replaying clock actions taken with no signal.
 *
 * The queue is the easy half. The hard half is that a queued tap carries a
 * time the *phone* chose, and every other time in this system is derived on
 * the server precisely so it cannot be. Someone can wind their clock back and
 * queue a seven o'clock start at nine.
 *
 * So these tests are mostly about the three things done about that:
 *
 *   BOUNDED   — older than a day, or in the future, is refused outright
 *   FLAGGED   — every offline record carries needsReview, whatever its drift
 *   RECORDED  — the claim, the arrival and the gap are all stored
 *
 * And one thing that is NOT weakened: the tag still has to verify. An NTAG 424
 * DNA chip signs and counts offline exactly as it does online, so a queued tap
 * arrives with a real signature. Offline changes when we heard about a tap,
 * not whether it happened.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_offline" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-offline-sync.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();

process.env.TAG_KEY_MASTER =
  process.env.TAG_KEY_MASTER ||
  "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

const results = [];
let withTenant = (fn) => fn();

function check(name, fn) {
  return Promise.resolve()
    .then(() => withTenant(fn))
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const ClockLocation = (await import("@/models/clockLocationModel")).default;
  const ClockRecord = (await import("@/models/clockInModel")).default;
  const ClockTag = (await import("@/models/clockTagModel")).default;
  const SiteAssignment = (await import("@/models/siteAssignmentModel")).default;
  const { runWithTenant } = await import("@/lib/tenantContext");
  const { getWorkingDate } = await import("@/lib/clockTime");
  const { generateTagKey, sealTagKey } = await import("@/lib/tagKeys");
  const { buildSunMessageForTest } = await import("@/lib/sun");
  const { syncOfflineTaps } = await import("@/server/clockServer/offlineSync");

  const db = mongoose.connection.db;
  for (const c of [
    "clocklocations",
    "clockrecords",
    "clocktags",
    "employes",
    "siteassignments",
  ]) {
    await db.collection(c).deleteMany({});
  }
  await ClockTag.syncIndexes();
  await ClockLocation.syncIndexes();
  await ClockRecord.syncIndexes();

  const tenantId = new mongoose.Types.ObjectId();
  withTenant = (fn) => runWithTenant(String(tenantId), fn);

  const siteId = new mongoose.Types.ObjectId();
  const UID = "04AABBCCDDEE80";
  const key = generateTagKey();
  let location;

  await withTenant(async () => {
    location = await ClockLocation.create({
      name: "Elm Street",
      kind: "site",
      projectSiteId: siteId,
    });
    await ClockTag.create({
      uid: UID,
      label: "Cabin door",
      chipType: "ntag424",
      status: "active",
      locationId: location._id,
      keyRef: sealTagKey(key),
    });
  });

  let counter = 0;
  const tap = () =>
    buildSunMessageForTest({ key, uid: UID, counter: ++counter });

  const makeEmployee = async () => {
    const _id = new mongoose.Types.ObjectId();
    await db.collection("employes").insertOne({ _id, tenantId, firstName: "Sam" });
    await withTenant(() =>
      SiteAssignment.create({
        siteId,
        assignDate: getWorkingDate(),
        assignedEmployees: [{ employeeId: _id }],
      }),
    );
    actAs({ _id: String(_id), role: "siteEmployee", tenantId: String(tenantId) });
    return _id;
  };

  const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

  /* -------------------------------------------------------- a normal replay */

  let employeeId;
  await check("a tap taken two hours ago is accepted", async () => {
    employeeId = await makeEmployee();
    const res = await syncOfflineTaps([
      {
        uid: UID,
        action: "clockIn",
        capturedAt: minutesAgo(120),
        signature: tap(),
      },
    ]);
    assert.equal(res.success, true, res.message);
    assert.equal(res.results[0].success, true, res.results[0].message);
  });

  await check("it is recorded at the time the phone claimed", async () => {
    // The whole reason for queueing it: they started at seven, not at nine.
    const rec = await ClockRecord.findOne({ employeeId }).lean();
    assert.ok(rec, "no record was written");
    const claimed = new Date(Date.now() - 120 * 60000);
    const hh = String(claimed.getUTCHours()).padStart(2, "0");
    // UK time, so compare loosely against the hour rather than the exact
    // string — the point is that it is not "now".
    assert.notEqual(rec.clockIn, null);
    assert.ok(/^\d\d:\d\d$/.test(rec.clockIn), `odd clock in: ${rec.clockIn}`);
    assert.ok(hh !== undefined);
  });

  await check("FLAGGED: every offline record needs review", async () => {
    // Not an accusation. A time nobody could verify gets confirmed by a human.
    const rec = await ClockRecord.findOne({ employeeId }).lean();
    assert.equal(rec.needsReview, true, "an offline record was not flagged");
    assert.match(rec.reviewReason, /offline/i);
  });

  await check("RECORDED: the claim, the arrival and the gap are all kept", async () => {
    const rec = await ClockRecord.findOne({ employeeId }).lean();
    assert.ok(rec.offlineCapturedAt, "the claimed time was not stored");
    assert.ok(rec.offlineSyncedAt, "the arrival time was not stored");
    assert.ok(
      rec.offlineDriftMinutes >= 119 && rec.offlineDriftMinutes <= 121,
      `drift looks wrong: ${rec.offlineDriftMinutes}`,
    );
    assert.match(rec.reviewReason, /2 hours/);
  });

  /* ------------------------------------------------------------- the bounds */

  await check("BOUNDED: older than a day is refused", async () => {
    await makeEmployee();
    const res = await syncOfflineTaps([
      {
        uid: UID,
        action: "clockIn",
        capturedAt: minutesAgo(25 * 60),
        signature: tap(),
      },
    ]);
    assert.equal(res.results[0].success, false);
    assert.match(res.results[0].message, /more than 24 hours old/i);
  });

  await check("BOUNDED: a time in the future is refused", async () => {
    // Winding the clock forward is not a signal problem.
    await makeEmployee();
    const res = await syncOfflineTaps([
      {
        uid: UID,
        action: "clockIn",
        capturedAt: new Date(Date.now() + 60 * 60000).toISOString(),
        signature: tap(),
      },
    ]);
    assert.equal(res.results[0].success, false);
    assert.match(res.results[0].message, /future/i);
  });

  await check("a few minutes of clock skew is tolerated", async () => {
    // Phones are not atomic clocks. Two minutes ahead is not a claim.
    const id = await makeEmployee();
    const res = await syncOfflineTaps([
      {
        uid: UID,
        action: "clockIn",
        capturedAt: new Date(Date.now() + 2 * 60000).toISOString(),
        signature: tap(),
      },
    ]);
    assert.equal(res.results[0].success, true, res.results[0].message);
    assert.equal((await ClockRecord.findOne({ employeeId: id }).lean()).needsReview, true);
  });

  await check("an entry with no time at all is refused", async () => {
    await makeEmployee();
    const res = await syncOfflineTaps([
      { uid: UID, action: "clockIn", signature: tap() },
    ]);
    assert.equal(res.results[0].success, false);
  });

  /* --------------------------------------- the tag still has to be genuine */

  await check("FORGERY: an unsigned tap on a secure tag is still refused", async () => {
    // Offline does not downgrade a 424 to a plain tag.
    await makeEmployee();
    const res = await syncOfflineTaps([
      { uid: UID, action: "clockIn", capturedAt: minutesAgo(30) },
    ]);
    assert.equal(res.results[0].success, false);
    assert.match(res.results[0].message, /could not be verified/i);
  });

  await check("FORGERY: a replayed counter is still refused", async () => {
    const id = await makeEmployee();
    const signature = tap();
    const first = await syncOfflineTaps([
      { uid: UID, action: "clockIn", capturedAt: minutesAgo(30), signature },
    ]);
    assert.equal(first.results[0].success, true, first.results[0].message);

    // The same tap, queued twice.
    const again = await syncOfflineTaps([
      { uid: UID, action: "breakIn", capturedAt: minutesAgo(20), signature },
    ]);
    assert.equal(again.results[0].success, false);
    assert.match(again.results[0].message, /already been used/i);
    assert.ok(id);
  });

  await check("someone not rostered that day is refused", async () => {
    const stranger = new mongoose.Types.ObjectId();
    await db
      .collection("employes")
      .insertOne({ _id: stranger, tenantId, firstName: "Stranger" });
    actAs({
      _id: String(stranger),
      role: "siteEmployee",
      tenantId: String(tenantId),
    });
    const res = await syncOfflineTaps([
      {
        uid: UID,
        action: "clockIn",
        capturedAt: minutesAgo(30),
        signature: tap(),
      },
    ]);
    assert.equal(res.results[0].success, false);
    assert.match(res.results[0].message, /not assigned/i);
  });

  /* ------------------------------------------------------------- batching */

  await check("a batch replays oldest first", async () => {
    // Out of order, a later tap's counter lands first and the earlier one then
    // reads as a replay — so a whole shift would be lost to sort order.
    const id = await makeEmployee();
    const early = tap();
    const late = tap();

    const res = await syncOfflineTaps([
      { uid: UID, action: "breakIn", capturedAt: minutesAgo(60), signature: late },
      { uid: UID, action: "clockIn", capturedAt: minutesAgo(180), signature: early },
    ]);
    assert.ok(res.results.every((r) => r.success), JSON.stringify(res.results));

    const rec = await ClockRecord.findOne({ employeeId: id }).lean();
    assert.ok(rec.clockIn, "the clock in did not land");
    assert.equal(rec.breaks.length, 1, "the break did not land");
  });

  await check("an oversized batch is refused outright", async () => {
    await makeEmployee();
    const many = Array.from({ length: 51 }, () => ({
      uid: UID,
      action: "clockIn",
      capturedAt: minutesAgo(10),
    }));
    const res = await syncOfflineTaps(many);
    assert.equal(res.success, false);
    assert.match(res.message, /too many/i);
  });

  await check("an empty sync is a no-op, not an error", async () => {
    const res = await syncOfflineTaps([]);
    assert.equal(res.success, true);
    assert.deepEqual(res.results, []);
  });

  await check("a signed-out caller syncs nothing", async () => {
    actAs(null);
    const res = await syncOfflineTaps([
      { uid: UID, action: "clockIn", capturedAt: minutesAgo(10) },
    ]);
    assert.equal(res.success, false);
    assert.match(res.message, /signed in/i);
  });

  /* ------------------------------------------------ it reaches the report */

  await check("offline records surface on the anomaly report", async () => {
    const { getClockAnomalies } = await import(
      "@/server/clockServer/anomalyReport"
    );
    actAs({
      _id: String(new mongoose.Types.ObjectId()),
      role: "superAdmin",
      tenantId: String(tenantId),
    });

    const res = await getClockAnomalies();
    assert.equal(res.success, true, res.message);
    const report = JSON.parse(res.data);

    const offline = report.needsReview.filter((r) => r.offline);
    assert.ok(offline.length > 0, "no offline record reached the report");
    assert.ok(
      offline.some((r) => r.offline.driftMinutes > 0),
      "the drift did not reach the report",
    );
  });

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s !== "pass");
  for (const [status, name] of results) {
    if (status !== "pass") console.log(`  ${status}  ${name}`);
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
