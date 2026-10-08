/**
 * Clock write tests — the scanner's four actions against a real database.
 *
 * scripts/test-clock-rules.mjs covers the decisions; this covers the writes
 * they gate. It exists because every one of those writes now carries its
 * precondition in the filter instead of trusting a preceding read, and that
 * only actually holds if Mongo agrees — `$setOnInsert` overlapping the upsert
 * filter, `arrayFilters` closing only an open break, a guarded update reporting
 * zero when its guard fails. Those are assertions about the database, not about
 * JavaScript, so they need one.
 *
 * The concurrency tests are the point: two scans a second apart used to create
 * two records, because both read "nothing yet" before either wrote.
 *
 * Needs a LOCAL database — it writes. The script refuses anything else.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_clocktest" \
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-clock-writes.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const MODE = process.env.TENANT_ENFORCEMENT || "shadow";
const ENFORCING = MODE === "enforce";

const results = [];

// Set once main() knows the tenant. Every case runs inside a tenant context,
// because that is how the app runs: under TENANT_ENFORCEMENT=enforce the
// plugin rejects a model call without one.
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
    console.error(
      "Set MONGO_DB_URL to a LOCAL database — this script writes and drops.",
    );
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const ClockRecord = (await import("@/models/clockInModel")).default;
  const { checkClockAction, DEFAULT_CLOCK_RULES, resolveClockRules } =
    await import("@/lib/clockRules");
  const { runWithTenant } = await import("@/lib/tenantContext");

  const col = mongoose.connection.db.collection("clockrecords");
  await col.deleteMany({});
  // The model declares it, but syncIndexes makes the build explicit and
  // surfaces a failure here rather than in a server log.
  await ClockRecord.syncIndexes();

  const tenantId = new mongoose.Types.ObjectId();
  withTenant = (fn) => runWithTenant(String(tenantId), fn);
  const employeeId = new mongoose.Types.ObjectId();
  const date = new Date(Date.UTC(2026, 8, 19));

  // Places, not sites. The unique key moved to locationId in Phase A — an
  // office used to be `siteId: null`, so every office in a company shared one
  // key and a second could not be recorded on the same day.
  const siteId = new mongoose.Types.ObjectId();     // "Elm Street"
  const officeId = new mongoose.Types.ObjectId();   // "Head Office"

  const filterFor = (location) => ({
    tenantId,
    employeeId,
    date,
    locationId: location,
    isDeleted: false,
  });

  /* --------------------------------------------------- the same four writes
   * the scanner performs, kept deliberately close to qrcodeServer.js so a
   * change there that breaks an assumption shows up here.
   */

  const clockIn = (filter, at) =>
    ClockRecord.updateOne(
      filter,
      {
        $setOnInsert: {
          ...filter,
          employeeType: "Employee",
          locationType: filter.locationId === officeId ? "office" : "site",
          clockIn: at,
          status: "checked-in",
          breaks: [],
        },
      },
      { upsert: true },
    );

  const breakIn = (_id, at) =>
    ClockRecord.updateOne(
      {
        _id,
        clockOut: null,
        breaks: {
          $not: { $elemMatch: { breakIn: { $ne: null }, breakOut: null } },
        },
      },
      { $push: { breaks: { breakIn: at } }, $set: { status: "on-break" } },
    );

  const breakOut = (_id, at) =>
    ClockRecord.updateOne(
      {
        _id,
        clockOut: null,
        breaks: { $elemMatch: { breakIn: { $ne: null }, breakOut: null } },
      },
      { $set: { "breaks.$[open].breakOut": at, status: "checked-in" } },
      { arrayFilters: [{ "open.breakIn": { $ne: null }, "open.breakOut": null }] },
    );

  const clockOut = (_id, at) =>
    ClockRecord.updateOne(
      { _id, clockOut: null },
      {
        $set: {
          clockOut: at,
          status: "clocked-out",
          "breaks.$[open].breakOut": at,
        },
      },
      { arrayFilters: [{ "open.breakIn": { $ne: null }, "open.breakOut": null }] },
    );

  const find = (site) => ClockRecord.findOne(filterFor(site)).lean();

  /* ------------------------------------------------------------ happy path */

  await check("clock in creates the record", async () => {
    const r = await clockIn(filterFor(siteId), "09:00");
    assert.equal(r.upsertedCount, 1);
    const doc = await find(siteId);
    assert.equal(doc.clockIn, "09:00");
    assert.equal(doc.status, "checked-in");
    assert.equal(doc.employeeType, "Employee");
  });

  await check("break in opens a break", async () => {
    const doc = await find(siteId);
    const r = await breakIn(doc._id, "12:00");
    assert.equal(r.modifiedCount, 1);
    const after = await find(siteId);
    assert.equal(after.breaks.length, 1);
    assert.equal(after.breaks[0].breakIn, "12:00");
    assert.equal(after.breaks[0].breakOut, undefined);
  });

  await check("break out closes it", async () => {
    const doc = await find(siteId);
    const r = await breakOut(doc._id, "12:30");
    assert.equal(r.modifiedCount, 1);
    const after = await find(siteId);
    assert.equal(after.breaks[0].breakOut, "12:30");
  });

  await check("a second break is a separate entry", async () => {
    const doc = await find(siteId);
    await breakIn(doc._id, "15:00");
    await breakOut(doc._id, "15:15");
    const after = await find(siteId);
    assert.equal(after.breaks.length, 2);
    assert.deepEqual(
      after.breaks.map((b) => `${b.breakIn}-${b.breakOut}`),
      ["12:00-12:30", "15:00-15:15"],
    );
  });

  await check("clock out closes the shift", async () => {
    const doc = await find(siteId);
    const r = await clockOut(doc._id, "17:00");
    assert.equal(r.modifiedCount, 1);
    const after = await find(siteId);
    assert.equal(after.clockOut, "17:00");
    assert.equal(after.status, "clocked-out");
  });

  /* ------------------------------------------------- guards on a used record */

  await check("clocking out twice changes nothing", async () => {
    const doc = await find(siteId);
    const r = await clockOut(doc._id, "18:00");
    assert.equal(r.modifiedCount, 0);
    assert.equal((await find(siteId)).clockOut, "17:00");
  });

  await check("breaking in after clock out changes nothing", async () => {
    const doc = await find(siteId);
    const r = await breakIn(doc._id, "18:00");
    assert.equal(r.modifiedCount, 0);
    assert.equal((await find(siteId)).breaks.length, 2);
  });

  /* ------------------------------------------------------------ concurrency */

  await check("two simultaneous clock ins create one record", async () => {
    const other = new mongoose.Types.ObjectId();
    const filter = { ...filterFor(siteId), employeeId: other };

    // allSettled, not all: the loser of the race may report upsertedCount 0
    // OR lose on the unique index and throw E11000, depending on how the two
    // upserts interleave. Both are correct — one record exists either way —
    // so the assertion is on the record, not on which way the loser failed.
    const runs = await Promise.allSettled([
      clockIn(filter, "09:00"),
      clockIn(filter, "09:00"),
    ]);

    const inserted = runs
      .filter((r) => r.status === "fulfilled")
      .reduce((n, r) => n + r.value.upsertedCount, 0);
    assert.equal(inserted, 1, `expected exactly one insert, got ${inserted}`);
    assert.equal(await ClockRecord.countDocuments(filter), 1);
  });

  await check("a burst of ten clock ins still creates one record", async () => {
    const other = new mongoose.Types.ObjectId();
    const filter = { ...filterFor(siteId), employeeId: other };

    const runs = await Promise.allSettled(
      Array.from({ length: 10 }, () => clockIn(filter, "09:00")),
    );
    // A loser may either report upsertedCount 0 or lose the unique-index race
    // outright with E11000; both are correct, and both leave one record.
    const inserted = runs
      .filter((r) => r.status === "fulfilled")
      .reduce((n, r) => n + r.value.upsertedCount, 0);
    assert.equal(inserted, 1, `expected one insert, got ${inserted}`);
    assert.equal(await ClockRecord.countDocuments(filter), 1);
  });

  await check("two simultaneous break ins open one break", async () => {
    const doc = await find(siteId);
    const fresh = await ClockRecord.findByIdAndUpdate(
      doc._id,
      { $set: { clockOut: null, breaks: [] } },
      { new: true },
    );
    const [a, b] = await Promise.all([
      breakIn(fresh._id, "12:00"),
      breakIn(fresh._id, "12:00"),
    ]);
    assert.equal(a.modifiedCount + b.modifiedCount, 1);
    assert.equal((await find(siteId)).breaks.length, 1);
  });

  await check("two simultaneous clock outs write one time", async () => {
    const doc = await find(siteId);
    const [a, b] = await Promise.all([
      clockOut(doc._id, "17:00"),
      clockOut(doc._id, "17:01"),
    ]);
    assert.equal(a.modifiedCount + b.modifiedCount, 1);
    const after = await find(siteId);
    assert.ok(["17:00", "17:01"].includes(after.clockOut));
  });

  /* ------------------------------------------- clock out closes an open break */

  await check("clocking out closes a break left open", async () => {
    const doc = await find(siteId);
    await ClockRecord.updateOne(
      { _id: doc._id },
      { $set: { clockOut: null, breaks: [{ breakIn: "15:00" }] } },
    );
    await clockOut(doc._id, "17:00");
    const after = await find(siteId);
    assert.equal(after.breaks[0].breakOut, "17:00");
    assert.equal(after.clockOut, "17:00");
  });

  /* ------------------------------------------------------ record separation */

  await check("the same day at another site is a separate record", async () => {
    const otherSite = new mongoose.Types.ObjectId();
    const r = await clockIn(filterFor(otherSite), "18:00");
    assert.equal(r.upsertedCount, 1, "second site should get its own record");
    assert.equal((await find(otherSite)).clockIn, "18:00");
  });

  await check("an office record and a site record coexist", async () => {
    const r = await clockIn(filterFor(officeId), "08:00");
    assert.equal(r.upsertedCount, 1);
    const office = await find(officeId);
    assert.equal(office.locationType, "office");
  });

  await check("TWO OFFICES on the same day, which used to be impossible", async () => {
    // Both offices were `siteId: null`, so the unique index saw one key and
    // refused the second. This is the constraint Phase A changed.
    const secondOffice = new mongoose.Types.ObjectId();
    const r = await clockIn(filterFor(secondOffice), "13:00");
    assert.equal(r.upsertedCount, 1, "the second office was refused");

    const both = await ClockRecord.countDocuments({
      tenantId,
      employeeId,
      date,
      locationId: { $in: [officeId, secondOffice] },
    });
    assert.equal(both, 2);
  });

  await check("a soft-deleted record does not block a new one", async () => {
    // The bug this replaces: the scanner matched deleted records, so once a
    // record was deleted the employee could never clock in again that day.
    const fresh = new mongoose.Types.ObjectId();
    const filter = { ...filterFor(siteId), employeeId: fresh };
    await clockIn(filter, "09:00");
    await ClockRecord.updateOne(filter, { $set: { isDeleted: true } });

    const r = await clockIn(filter, "10:00");
    assert.equal(r.upsertedCount, 1, "should create a fresh record");
    assert.equal((await ClockRecord.findOne(filter).lean()).clockIn, "10:00");
  });

  /* ----------------------------------------- the rules, against real records */

  await check("the rules and the writes agree on a fresh record", async () => {
    const fresh = new mongoose.Types.ObjectId();
    const filter = { ...filterFor(siteId), employeeId: fresh };
    assert.equal(checkClockAction(null, "clockIn", "09:00").ok, true);
    await clockIn(filter, "09:00");

    const doc = await ClockRecord.findOne(filter).lean();
    assert.equal(checkClockAction(doc, "clockIn", "09:05").ok, false);
    assert.equal(checkClockAction(doc, "breakOut", "09:05").ok, false);
    assert.equal(checkClockAction(doc, "breakIn", "09:05").ok, true);
  });

  await check("policy rules refuse an early clock out on a real record", async () => {
    const strict = resolveClockRules({ minMinutesBeforeClockOut: 120 });
    const fresh = new mongoose.Types.ObjectId();
    const filter = { ...filterFor(siteId), employeeId: fresh };
    await clockIn(filter, "09:00");
    const doc = await ClockRecord.findOne(filter).lean();

    assert.equal(checkClockAction(doc, "clockOut", "09:30", strict).ok, false);
    assert.equal(checkClockAction(doc, "clockOut", "11:00", strict).ok, true);
    // And with the defaults, which is what every company has today.
    assert.equal(
      checkClockAction(doc, "clockOut", "09:30", DEFAULT_CLOCK_RULES).ok,
      true,
    );
  });

  /* ------------------------------------------------------------ tenant stamp */

  await check("an upserted record is stamped with the tenant", async () => {
    // This is the shape the real code uses: qrcodeServer builds its filter
    // from employee/date/site only and never mentions tenantId — the plugin
    // adds it with `this.where()`. The plugin has no $setOnInsert of its own,
    // so the new document can only get its tenantId from that equality
    // condition being carried into the insert. If Mongo ever stopped doing
    // that, every scanned clock-in would land with a null tenantId: invisible
    // to every scoped read, and colliding with every other tenant's null in
    // the unique index.
    const fresh = new mongoose.Types.ObjectId();
    const filterWithoutTenant = {
      employeeId: fresh,
      date,
      locationId: siteId,
      isDeleted: false,
    };

    const r = await ClockRecord.updateOne(
      filterWithoutTenant,
      {
        $setOnInsert: {
          ...filterWithoutTenant,
          employeeType: "Employee",
          clockIn: "09:00",
          breaks: [],
        },
      },
      { upsert: true },
    );
    assert.equal(r.upsertedCount, 1);

    // Read it through the driver, below the plugin, so the assertion is about
    // what was stored rather than what the scope would have filtered to.
    const raw = await col.findOne({ employeeId: fresh });
    assert.ok(raw, "record was not created");

    if (ENFORCING) {
      assert.equal(
        String(raw.tenantId),
        String(tenantId),
        "upserted record is missing the tenant stamp",
      );
    } else {
      // Shadow mode adds no where-clause, so there is no equality condition
      // for the insert to inherit and the record lands unstamped. That is
      // shadow mode working as designed — it filters nothing — and it is why
      // scripts/backfill-tenant.mjs exists. Asserted rather than skipped so
      // the difference is on the record: under shadow, an upsert on ANY model
      // produces a row the backfill has to pick up later.
      assert.equal(
        raw.tenantId,
        undefined,
        "shadow mode unexpectedly stamped a tenant",
      );
    }
  });

  /* ------------------------------------------------------------- the index */

  await check("the unique index rejects a duplicate outright", async () => {
    const doc = await find(siteId);
    await assert.rejects(
      () =>
        ClockRecord.collection.insertOne({
          tenantId,
          employeeId: doc.employeeId,
          date,
          // locationId, not siteId — the key the index is actually on. Written
          // as siteId this inserted cleanly with a null locationId, which is
          // the index NOT doing its job while the test claimed it was.
          locationId: siteId,
          isDeleted: false,
          clockIn: "09:00",
        }),
      /E11000/,
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
