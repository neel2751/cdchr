/**
 * Does "Measure only" actually produce anything a person can read?
 *
 * Shadow mode is worthless if the numbers never reach a screen, and the last
 * two rounds of this work both shipped an engine with no way to see or use it.
 * So this drives the report the way the settings screen does — seeded records
 * in, the figures an admin reads out — rather than testing the aggregation's
 * shape.
 *
 * The radius table is the part that matters. It is the only thing that turns
 * "150m sounds about right" into a decision, and it has to be right about
 * which scans a given radius would have admitted.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_report" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-clock-evidence-report.mjs
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

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const ClockLocation = (await import("@/models/clockLocationModel")).default;
  const ClockRecord = (await import("@/models/clockInModel")).default;
  const { runWithTenant } = await import("@/lib/tenantContext");
  const { evaluateLocation } = await import("@/lib/locationPolicy");
  const { getClockEvidenceReport, setLocationPolicy } = await import(
    "@/server/clockServer/evidenceReport"
  );

  const db = mongoose.connection.db;
  for (const c of ["clocklocations", "clockrecords"]) {
    await db.collection(c).deleteMany({});
  }
  await ClockLocation.syncIndexes();
  await ClockRecord.syncIndexes();

  const tenantId = new mongoose.Types.ObjectId();
  withTenant = (fn) => runWithTenant(String(tenantId), fn);
  actAs({
    _id: String(new mongoose.Types.ObjectId()),
    role: "superAdmin",
    name: "Sam",
    tenantId: String(tenantId),
  });

  // A site with a geofence, measuring only.
  const FENCE = { lat: 51.5, lng: -0.1, radiusMetres: 100 };
  let site;
  await withTenant(async () => {
    site = await ClockLocation.create({ name: "Elm Street", kind: "site" });
    const res = await setLocationPolicy({
      id: String(site._id),
      geofence: FENCE,
      methods: [{ type: "geofence", mode: "shadow" }],
    });
    assert.equal(res.success, true, res.message);
    site = await ClockLocation.findById(site._id).lean();
  });

  await check("saving the policy is what makes a location measurable", () => {
    // The gap that made all of this inert: no methods means nothing is ever
    // evaluated, so nothing is ever recorded.
    assert.equal(site.methods.length, 1);
    assert.equal(site.methods[0].mode, "shadow");
    assert.equal(site.geofence.radiusMetres, 100);
  });

  await check('"off" is not stored as a rule', async () => {
    const res = await setLocationPolicy({
      id: String(site._id),
      methods: [
        { type: "geofence", mode: "shadow" },
        { type: "network", mode: "off" },
      ],
    });
    assert.equal(res.success, true);
    const fresh = await ClockLocation.findById(site._id).lean();
    assert.equal(fresh.methods.length, 1, "an off rule was stored as a rule");
  });

  await check("a nonsense mode is refused, not stored", async () => {
    const res = await setLocationPolicy({
      id: String(site._id),
      methods: [{ type: "geofence", mode: "sometimes" }],
    });
    assert.equal(res.success, false);
    assert.match(res.message, /mode/i);
  });

  /* ---- clock-ins at known distances, evaluated the way a real one is ---- */

  // Metres north of the fence centre, roughly.
  const north = (metres) => ({
    lat: FENCE.lat + metres / 111320,
    lng: FENCE.lng,
    accuracyMetres: 5,
  });

  const day = (n) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n));
  };

  await withTenant(async () => {
    const fresh = await ClockLocation.findById(site._id).lean();
    // 20m, 80m, 120m, 300m out, plus one with no position at all.
    const samples = [20, 80, 120, 300];
    for (let i = 0; i < samples.length; i++) {
      const coords = north(samples[i]);
      const evidence = { method: "nfc", coords, recordedAt: new Date() };
      const policy = evaluateLocation(fresh, evidence);
      await ClockRecord.create({
        employeeId: new mongoose.Types.ObjectId(),
        employeeType: "Employee",
        date: day(i + 1),
        locationId: site._id,
        clockIn: "08:00",
        clockOut: "16:00",
        breaks: [],
        isDeleted: false,
        clockInEvidence: {
          ...evidence,
          checks: policy.checks,
          wouldAllow: policy.wouldAllow,
        },
      });
    }

    // Someone who declined the permission. Never a refusal — it says nothing
    // about where they were.
    const blind = { method: "nfc", recordedAt: new Date() };
    const blindPolicy = evaluateLocation(fresh, blind);
    await ClockRecord.create({
      employeeId: new mongoose.Types.ObjectId(),
      employeeType: "Employee",
      date: day(6),
      locationId: site._id,
      clockIn: "08:00",
      clockOut: "16:00",
      breaks: [],
      isDeleted: false,
      clockInEvidence: {
        ...blind,
        checks: blindPolicy.checks,
        wouldAllow: blindPolicy.wouldAllow,
      },
    });
  });

  let report;
  await check("the report returns something at all", async () => {
    const res = await getClockEvidenceReport();
    assert.equal(res.success, true, res.message);
    report = JSON.parse(res.data);
    assert.equal(report.locations.length, 1, "the location is missing");
  });

  await check("it names the location, not an id", async () => {
    assert.equal(report.locations[0].name, "Elm Street");
    assert.equal(report.locations[0].kind, "site");
  });

  await check("it counts the scans and how many had a position", () => {
    const row = report.locations[0];
    assert.equal(row.scans, 5);
    assert.equal(row.withPosition, 4, "the position count is wrong");
  });

  await check("it counts what enforcing WOULD have refused", () => {
    // 120m and 300m are outside a 100m radius (+5m accuracy). 20m and 80m are
    // inside. The declined-permission one is never a refusal.
    const row = report.locations[0];
    assert.equal(row.wouldRefuse, 2, `expected 2 refusals, got ${row.wouldRefuse}`);
  });

  await check("per-method tallies are broken out", () => {
    const geo = report.locations[0].methods.geofence;
    assert.ok(geo, "no geofence tally");
    assert.equal(geo.pass, 2);
    assert.equal(geo.fail, 2);
    assert.equal(geo.unknown, 1, "the declined permission was not counted as unknown");
  });

  await check("THE RADIUS TABLE: what each radius would have admitted", () => {
    // The whole reason shadow mode is worth running. Distances are ~20, 80,
    // 120, 300.
    const opts = report.locations[0].radiusOptions;
    const at = (r) => opts.find((o) => o.radius === r);

    assert.equal(at(50).admitted, 1, "50m should admit only the 20m scan");
    assert.equal(at(100).admitted, 2, "100m should admit 20m and 80m");
    assert.equal(at(250).admitted, 3, "250m should admit all but the 300m one");
    assert.equal(at(500).admitted, 4, "500m should admit everything measured");
    assert.equal(at(500).percent, 100);
  });

  await check("the distance spread is reported", () => {
    const d = report.locations[0].distance;
    assert.equal(d.count, 4);
    assert.ok(d.min < 30, `min looks wrong: ${d.min}`);
    assert.ok(d.max > 280 && d.max < 320, `max looks wrong: ${d.max}`);
  });

  await check("a declined permission is reported separately", () => {
    // A coverage problem, not a policy one. Reporting them together would hide
    // both behind one number.
    assert.equal(report.locations[0].noEvidence, 0);
    assert.equal(report.locations[0].methods.geofence.unknown, 1);
  });

  await check("a location with no rules records nothing to read", async () => {
    let quiet;
    await withTenant(async () => {
      quiet = await ClockLocation.create({ name: "Dock Road", kind: "site" });
      const policy = evaluateLocation(quiet.toObject(), {
        coords: north(5000),
      });
      // No methods, so nothing is judged — which is exactly why the settings
      // screen has to say so out loud.
      assert.deepEqual(policy.checks, []);
      assert.equal(policy.wouldAllow, true);
    });
  });

  await check("an ordinary employee cannot read the report", async () => {
    actAs({
      _id: String(new mongoose.Types.ObjectId()),
      role: "siteEmployee",
      tenantId: String(tenantId),
    });
    const res = await getClockEvidenceReport();
    assert.equal(res.success, false);
    assert.match(res.message, /not authorized/i);
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
