/**
 * NFC tag registry: resolution, the replay defence, and reassignment.
 *
 * Two assertions carry most of the weight.
 *
 *   The **counter** tests. On an NTAG 424 DNA chip the counter is the entire
 *   security property: the chip increments it on every tap, so a URL captured
 *   once and replayed carries a counter that has already been spent. If that
 *   check is ever loosened, a photographed URL becomes a working clock-in from
 *   anywhere, silently.
 *
 *   The **reassignment is not retroactive** test. Moving a tag must not
 *   rewrite attendance already recorded — that would re-attribute hours, and
 *   therefore pay and CIS, to a site the work never happened on.
 *
 * Needs a LOCAL database — it writes and drops.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_clocktags" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-clock-tags.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();

// Sealing needs a master key; the suite brings its own rather than depending
// on the environment it happens to run in.
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

  const ClockTag = (await import("@/models/clockTagModel")).default;
  const ClockLocation = (await import("@/models/clockLocationModel")).default;
  const ClockRecord = (await import("@/models/clockInModel")).default;
  const SiteAssignment = (await import("@/models/siteAssignmentModel")).default;
  const { getWorkingDate } = await import("@/lib/clockTime");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const { buildSunMessageForTest } = await import("@/lib/sun");
  const { generateTagKey, sealTagKey } = await import("@/lib/tagKeys");
  const { normaliseUid, recordSighting, recordUnknownTag, resolveTag } =
    await import("@/server/clockServer/clockTagStore");
  const { assignClockTag, setClockTagStatus, storeClockTimeByTag } =
    await import("@/server/clockServer/tags");

  const db = mongoose.connection.db;
  const elmSite = new mongoose.Types.ObjectId();
  for (const c of ["clocktags", "clocklocations", "clockrecords", "employes", "siteassignments"]) {
    await db.collection(c).deleteMany({});
  }
  await ClockTag.syncIndexes();
  await ClockLocation.syncIndexes();

  const tenantId = new mongoose.Types.ObjectId();
  withTenant = (fn) => runWithTenant(String(tenantId), fn);

  // Inserted below mongoose: EmployeModel requires a dozen fields (pay rate,
  // immigration type, emergency contact) that say nothing about whether a tag
  // tap is accepted. Fabricating them would make the test about the wrong
  // thing.
  const makeEmployee = async (firstName) => {
    const _id = new mongoose.Types.ObjectId();
    await db.collection("employes").insertOne({ _id, tenantId, firstName });
    return _id;
  };
  const adminId = new mongoose.Types.ObjectId();
  const asAdmin = () =>
    actAs({ _id: String(adminId), role: "superAdmin", name: "Sam", tenantId: String(tenantId) });

  let elm, dock;
  await withTenant(async () => {
    elm = await ClockLocation.create({ name: "Elm Street", kind: "site" });
    dock = await ClockLocation.create({ name: "Dock Road", kind: "site" });
  });

  /* ------------------------------------------------------------ uid reading */

  check("a UID is normalised, however it arrives", () => {
    assert.equal(normaliseUid("04:a2:b3:c4:d5:e6:80"), "04A2B3C4D5E680");
    assert.equal(normaliseUid("04a2b3c4d5e680"), "04A2B3C4D5E680");
  });

  check("nonsense is not a UID", () => {
    for (const bad of [null, "", "zz", "04A2", 1234, "x".repeat(40)]) {
      assert.equal(normaliseUid(bad), null, `accepted ${JSON.stringify(bad)}`);
    }
  });

  /* ------------------------------------------------------------- enrolment */

  await check("an unknown tag is 'unknown', not an error", async () => {
    // That distinction is what makes tap-to-enrol possible: a brand-new tag
    // taps exactly like this.
    const r = await resolveTag("04A2B3C4D5E680");
    assert.equal(r.ok, false);
    assert.equal(r.status, "unknown");
    assert.equal(r.uid, "04A2B3C4D5E680");
  });

  await check("tapping a new tag enrols it as unassigned", async () => {
    const tag = await recordUnknownTag("04A2B3C4D5E680", { byName: "Sam" });
    assert.equal(tag.status, "unassigned");
    assert.equal(tag.uid, "04A2B3C4D5E680");
    assert.equal(await ClockTag.countDocuments({}), 1);
  });

  await check("tapping it again does not create a second row", async () => {
    await recordUnknownTag("04:A2:B3:C4:D5:E6:80");
    assert.equal(await ClockTag.countDocuments({}), 1);
  });

  await check("an unassigned tag cannot be used to clock in", async () => {
    const r = await resolveTag("04A2B3C4D5E680");
    assert.equal(r.ok, false);
    assert.equal(r.status, "unassigned");
  });

  /* -------------------------------------------------------------- assigning */

  await check("a super admin binds it to a location", async () => {
    asAdmin();
    const res = await assignClockTag({
      uid: "04A2B3C4D5E680",
      locationId: String(elm._id),
      label: "Elm Street — cabin door",
    });
    assert.equal(res.success, true, res.message);

    const tag = await ClockTag.findOne({ uid: "04A2B3C4D5E680" }).lean();
    assert.equal(tag.status, "active");
    assert.equal(String(tag.locationId), String(elm._id));
    assert.equal(tag.label, "Elm Street — cabin door");
    assert.equal(tag.history.length, 2, "the assignment was not recorded");
  });

  await check("now it resolves", async () => {
    const r = await resolveTag("04A2B3C4D5E680");
    assert.equal(r.ok, true);
    assert.equal(r.status, "active");
  });

  await check("an ordinary employee cannot assign a tag", async () => {
    actAs({ _id: String(new mongoose.Types.ObjectId()), role: "user", tenantId: String(tenantId) });
    const res = await assignClockTag({
      uid: "04A2B3C4D5E680",
      locationId: String(dock._id),
    });
    assert.equal(res.success, false);
    assert.match(res.message, /not authorized/i);
    asAdmin();
  });

  /* ------------------------------------------------ the replay defence */

  // A 424 DNA tag: a real key, and taps built the way a chip builds them.
  const SECURE_UID = "04AABBCCDDEE80";
  const secureKey = generateTagKey();
  const tapAs = (counter) =>
    buildSunMessageForTest({ key: secureKey, uid: SECURE_UID, counter });

  await check("a secure tag is set up with a sealed key", async () => {
    asAdmin();
    await ClockTag.create({
      uid: SECURE_UID,
      label: "Secure gate tag",
      chipType: "ntag424",
      status: "unassigned",
      keyRef: sealTagKey(secureKey),
    });
    const res = await assignClockTag({
      uid: SECURE_UID,
      locationId: String(dock._id),
    });
    assert.equal(res.success, true, res.message);
  });

  await check("a signed tap verifies and carries its own counter", async () => {
    const { picc, cmac } = tapAs(5);
    const r = await resolveTag(SECURE_UID, { picc, cmac });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.counter, 5, "the counter did not come from the signature");

    const tag = await ClockTag.findOne({ uid: SECURE_UID }).lean();
    await recordSighting(tag._id, { counter: 5 });
    assert.equal((await ClockTag.findById(tag._id).lean()).lastCounter, 5);
  });

  await check("REPLAY: the same tap again is refused", async () => {
    const { picc, cmac } = tapAs(5);
    const r = await resolveTag(SECURE_UID, { picc, cmac });
    assert.equal(r.ok, false);
    assert.equal(r.status, "replay");
  });

  await check("REPLAY: an older tap is refused too", async () => {
    const { picc, cmac } = tapAs(3);
    assert.equal((await resolveTag(SECURE_UID, { picc, cmac })).status, "replay");
  });

  await check("FORGERY: a bumped counter cannot be faked", async () => {
    // The hole this closes. Previously the counter came off the query string,
    // so bumping it was the whole attack. Now it is inside the signature.
    const genuine = tapAs(5);
    const forged = Buffer.from(genuine.picc, "hex");
    forged[0] ^= 0x01;
    const r = await resolveTag(SECURE_UID, {
      picc: forged.toString("hex"),
      cmac: genuine.cmac,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "forged");
  });

  await check("FORGERY: a tap signed with another key is refused", async () => {
    const { picc, cmac } = buildSunMessageForTest({
      key: generateTagKey(),
      uid: SECURE_UID,
      counter: 99,
    });
    const r = await resolveTag(SECURE_UID, { picc, cmac });
    assert.equal(r.status, "forged");
  });

  await check("a secure tag tapped with NO signature is refused", async () => {
    // Stripping the parameters must not downgrade a 424 to a plain tag.
    const r = await resolveTag(SECURE_UID);
    assert.equal(r.ok, false);
    assert.equal(r.status, "unsigned");
  });

  await check("the counter never winds backwards", async () => {
    // Two taps racing must not re-open the replay window.
    const tag = await ClockTag.findOne({ uid: SECURE_UID }).lean();
    await recordSighting(tag._id, { counter: 2 });
    assert.equal((await ClockTag.findById(tag._id).lean()).lastCounter, 5);
  });

  await check("a genuine later tap is accepted", async () => {
    const { picc, cmac } = tapAs(6);
    const r = await resolveTag(SECURE_UID, { picc, cmac });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.counter, 6);
  });

  await check("a plain NTAG213 still works, with no counter at all", async () => {
    // Which is exactly why a 213 needs a geofence beside it — the tag proves
    // you have been near it once, and no more than that.
    const r = await resolveTag("04A2B3C4D5E680");
    assert.equal(r.ok, true);
    assert.equal(r.counter, null);
  });

  /* ------------------------------------------------------- status changes */

  await check("a suspended tag stops working immediately", async () => {
    asAdmin();
    const tag = await ClockTag.findOne({ uid: "04A2B3C4D5E680" }).lean();
    await setClockTagStatus({ id: String(tag._id), status: "suspended" });

    const r = await resolveTag("04A2B3C4D5E680");
    assert.equal(r.ok, false);
    assert.equal(r.status, "suspended");
    assert.match(r.message, /deactivated/i);
  });

  await check("and suspension is reversible", async () => {
    const tag = await ClockTag.findOne({ uid: "04A2B3C4D5E680" }).lean();
    await setClockTagStatus({ id: String(tag._id), status: "active" });
    assert.equal((await resolveTag("04A2B3C4D5E680")).ok, true);
  });

  await check("a retired tag is final", async () => {
    const tag = await ClockTag.findOne({ uid: "04A2B3C4D5E680" }).lean();
    await setClockTagStatus({ id: String(tag._id), status: "retired" });

    assert.equal((await resolveTag("04A2B3C4D5E680")).status, "retired");
    // And cannot be brought back or reassigned.
    const back = await setClockTagStatus({ id: String(tag._id), status: "active" });
    assert.equal(back.success, false);
    const reassign = await assignClockTag({
      id: String(tag._id),
      locationId: String(dock._id),
    });
    assert.equal(reassign.success, false);
  });

  /* --------------------------------------------- reassignment, and history */

  await check("REASSIGNMENT IS NOT RETROACTIVE", async () => {
    // The one that protects payroll. A tag moves from Elm Street to Dock Road;
    // yesterday's hours were worked at Elm Street and must stay there.
    asAdmin();
    const uid = "0411223344556677";
    await recordUnknownTag(uid);
    await assignClockTag({ uid, locationId: String(elm._id), label: "Cabin" });

    const employeeId = new mongoose.Types.ObjectId();
    const yesterday = new Date(Date.UTC(2026, 8, 20));
    await ClockRecord.create({
      employeeId,
      employeeType: "Employee",
      date: yesterday,
      locationId: elm._id,
      clockIn: "08:00",
      clockOut: "16:00",
      breaks: [],
      isDeleted: false,
    });

    const tag = await ClockTag.findOne({ uid }).lean();
    const res = await assignClockTag({
      id: String(tag._id),
      locationId: String(dock._id),
      reason: "Cabin moved to the next job",
    });
    assert.equal(res.success, true, res.message);

    const after = await ClockRecord.findOne({ employeeId, date: yesterday }).lean();
    assert.equal(
      String(after.locationId),
      String(elm._id),
      "yesterday's hours were re-attributed to a site the work never happened on",
    );

    const moved = await ClockTag.findOne({ uid }).lean();
    assert.equal(String(moved.locationId), String(dock._id));
  });

  await check("every move is written into the tag's history", async () => {
    const tag = await ClockTag.findOne({ uid: "0411223344556677" }).lean();
    const move = tag.history.at(-1);
    assert.equal(String(move.fromLocationId), String(elm._id));
    assert.equal(String(move.toLocationId), String(dock._id));
    assert.equal(move.byName, "Sam");
    assert.match(move.reason, /Cabin moved/);
  });

  /* ------------------------------------------------------ clone detection */

  await check("a tap from the wrong place is recorded, not hidden", async () => {
    // A tag bound to Dock Road whose taps arrive from Elm Street is either
    // cloned or was physically moved without anyone reassigning it. The tag
    // alone cannot tell you that; the tag plus a position can.
    const tag = await ClockTag.findOne({ uid: "0411223344556677" }).lean();
    await recordSighting(tag._id, { seenAtLocationId: elm._id });

    const seen = await ClockTag.findById(tag._id).lean();
    assert.equal(String(seen.lastSeenLocationId), String(elm._id));
    assert.notEqual(
      String(seen.lastSeenLocationId),
      String(seen.locationId),
      "the mismatch that flags a clone was not preserved",
    );
  });

  /* ------------------------------------------ Phase D: enforcement, for real */

  await check("ENFORCE: a tap from the wrong place is refused", async () => {
    asAdmin();
    const uid = "0499887766554433";
    await recordUnknownTag(uid);
    await assignClockTag({ uid, locationId: String(elm._id), label: "Gate" });

    // Elm Street now enforces a geofence.
    await ClockLocation.updateOne(
      { _id: elm._id },
      {
        $set: {
          geofence: { lat: 51.5, lng: -0.1, radiusMetres: 100 },
          methods: [{ type: "geofence", mode: "enforce" }],
        },
      },
    );

    const employeeId = await makeEmployee("Remote");
    const today = getWorkingDate();
    await SiteAssignment.create({
      siteId: elmSite,
      assignDate: today,
      assignedEmployees: [{ employeeId }],
    });
    await ClockLocation.updateOne(
      { _id: elm._id },
      { $set: { projectSiteId: elmSite } },
    );

    actAs({ _id: String(employeeId), role: "siteEmployee", tenantId: String(tenantId) });
    const res = await storeClockTimeByTag(uid, "clockIn", {
      coords: { lat: 52.5, lng: -1.9, accuracyMetres: 10 }, // Birmingham
    });

    assert.equal(res.success, false, "an enforced geofence admitted a remote tap");
    assert.match(res.message, /do not appear to be at this location/i);
    assert.equal(await ClockRecord.countDocuments({ employeeId }), 0);
  });

  await check("ENFORCE: the same tap at the gate is allowed", async () => {
    const uid = "0499887766554433";
    const employeeId = await makeEmployee("OnSite");
    await SiteAssignment.updateOne(
      { siteId: elmSite, assignDate: getWorkingDate() },
      { $push: { assignedEmployees: { employeeId } } },
    );

    actAs({ _id: String(employeeId), role: "siteEmployee", tenantId: String(tenantId) });
    const res = await storeClockTimeByTag(uid, "clockIn", {
      coords: { lat: 51.5, lng: -0.1, accuracyMetres: 10 },
    });

    assert.equal(res.success, true, res.message);
    assert.equal(await ClockRecord.countDocuments({ employeeId }), 1);
  });

  await check("ENFORCE: a phone with no position is NOT refused", async () => {
    // The rule that keeps an enforced geofence from punishing a flat battery
    // or a declined permission. If this flips, people cannot start work.
    const uid = "0499887766554433";
    const employeeId = await makeEmployee("NoGps");
    await SiteAssignment.updateOne(
      { siteId: elmSite, assignDate: getWorkingDate() },
      { $push: { assignedEmployees: { employeeId } } },
    );

    actAs({ _id: String(employeeId), role: "siteEmployee", tenantId: String(tenantId) });
    const res = await storeClockTimeByTag(uid, "clockIn", {});

    assert.equal(res.success, true, `refused someone it could not judge: ${res.message}`);
  });

  await check("ENFORCE: clocking OUT is never refused on location", async () => {
    // Someone already admitted must be able to close their day. Refusing
    // would leave an open shift and punish them for where they stood at
    // going-home time.
    const uid = "0499887766554433";
    const employee = await ClockRecord.findOne({ clockOut: null }).lean();
    assert.ok(employee, "no open shift to close");

    actAs({
      _id: String(employee.employeeId),
      role: "siteEmployee",
      tenantId: String(tenantId),
    });
    const res = await storeClockTimeByTag(uid, "clockOut", {
      coords: { lat: 52.5, lng: -1.9, accuracyMetres: 10 }, // Birmingham again
    });
    assert.equal(res.success, true, `clock out was refused: ${res.message}`);
  });

  /* ---------------------------------------------------- tenant isolation */

  await check("another company cannot see or use this tag", async () => {
    const other = new mongoose.Types.ObjectId();
    const r = await runWithTenant(String(other), () =>
      resolveTag("0411223344556677"),
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, "unknown", "tenant B resolved tenant A's tag");
  });

  await check("the same UID can exist for two companies", async () => {
    // Different physical tags, bought separately, can collide on a short UID.
    const other = new mongoose.Types.ObjectId();
    await runWithTenant(String(other), () =>
      recordUnknownTag("0411223344556677"),
    );
    assert.equal(await ClockTag.countDocuments({ uid: "0411223344556677" }), 1);
    const all = await db
      .collection("clocktags")
      .countDocuments({ uid: "0411223344556677" });
    assert.equal(all, 2, "the per-tenant UID index is too strict");
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
