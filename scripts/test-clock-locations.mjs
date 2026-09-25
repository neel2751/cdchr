/**
 * Clock locations: resolution, the new unique key, and the backfill.
 *
 * The case that matters is "two offices, same employee, same day". It was
 * impossible before — every office was `siteId: null`, and the unique index
 * keyed on siteId, so the second office's record collided with the first's and
 * was silently refused. That is the whole reason this phase exists.
 *
 * Needs a LOCAL database — it writes and drops. The script refuses anything
 * else.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_clockloc" \
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-clock-locations.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

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
  const {
    ensureDefaultLocation,
    resolveLocationForSite,
    resolveOrCreateLocationForSite,
    syncLocationForSite,
  } = await import("@/server/clockServer/clockLocationStore");

  const db = mongoose.connection.db;
  await db.collection("clocklocations").deleteMany({});
  await db.collection("clockrecords").deleteMany({});
  await ClockLocation.syncIndexes();
  await ClockRecord.syncIndexes();

  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();
  withTenant = (fn) => runWithTenant(String(tenantA), fn);

  const siteId = new mongoose.Types.ObjectId();
  const employeeId = new mongoose.Types.ObjectId();
  const date = new Date(Date.UTC(2026, 8, 21));

  /* ------------------------------------------------------- resolution */

  await check("a company with no locations gets a default office", async () => {
    const loc = await ensureDefaultLocation();
    assert.ok(loc?._id, "no default created");
    assert.equal(loc.isDefault, true);
    assert.equal(loc.kind, "office");
  });

  await check("the default is created once, not once per scan", async () => {
    const [a, b] = await Promise.all([
      ensureDefaultLocation(),
      ensureDefaultLocation(),
    ]);
    assert.equal(String(a._id), String(b._id));
    assert.equal(await ClockLocation.countDocuments({ isDefault: true }), 1);
  });

  await check("a scan with no site resolves to the default office", async () => {
    const loc = await resolveLocationForSite(null);
    assert.equal(loc.isDefault, true);
  });

  await check("an unknown site resolves to nothing until created", async () => {
    assert.equal(await resolveLocationForSite(siteId), null);
  });

  await check("a new site gets its own location on first scan", async () => {
    const loc = await resolveOrCreateLocationForSite(siteId, "Elm Street");
    assert.equal(loc.name, "Elm Street");
    assert.equal(loc.kind, "site");
    assert.equal(String(loc.projectSiteId), String(siteId));
    assert.notEqual(loc.isDefault, true);
  });

  await check("resolving that site again returns the same location", async () => {
    const a = await resolveOrCreateLocationForSite(siteId, "Elm Street");
    const b = await resolveOrCreateLocationForSite(siteId, "Elm Street");
    assert.equal(String(a._id), String(b._id));
  });

  await check("a garbage site id does not create a location", async () => {
    const before = await ClockLocation.countDocuments({});
    const loc = await resolveOrCreateLocationForSite("not-an-id");
    assert.equal(loc.isDefault, true, "should fall back to the default");
    assert.equal(await ClockLocation.countDocuments({}), before);
  });

  /* ------------------------------------------------- tenant isolation */

  await check("another company gets its own default, not this one's", async () => {
    const mine = await withTenant(() => ensureDefaultLocation());
    const theirs = await runWithTenant(String(tenantB), () =>
      ensureDefaultLocation(),
    );
    assert.notEqual(String(mine._id), String(theirs._id));
  });

  /* ------------------------------------------- the constraint that changed */

  await check("THE POINT: two offices, same employee, same day", async () => {
    // Impossible before. Both offices were siteId:null, and the unique index
    // keyed on siteId — so the second write collided with the first.
    const office1 = await ensureDefaultLocation();
    const office2 = await ClockLocation.create({
      name: "Northgate Office",
      kind: "office",
    });

    await ClockRecord.create({
      employeeId,
      employeeType: "OfficeEmployee",
      date,
      locationId: office1._id,
      clockIn: "09:00",
      clockOut: "12:00",
      breaks: [],
      isDeleted: false,
    });
    await ClockRecord.create({
      employeeId,
      employeeType: "OfficeEmployee",
      date,
      locationId: office2._id,
      clockIn: "13:00",
      clockOut: "17:00",
      breaks: [],
      isDeleted: false,
    });

    const both = await ClockRecord.find({ employeeId, date }).lean();
    assert.equal(both.length, 2, "the second office was refused");
    assert.equal(
      new Set(both.map((r) => String(r.locationId))).size,
      2,
      "both records landed on the same location",
    );
  });

  await check("but still one record per employee, per day, per place", async () => {
    const office1 = await ensureDefaultLocation();
    await assert.rejects(
      () =>
        ClockRecord.create({
          employeeId,
          employeeType: "OfficeEmployee",
          date,
          locationId: office1._id,
          clockIn: "09:30",
          breaks: [],
          isDeleted: false,
        }),
      /E11000/,
      "a duplicate at the same location should still be refused",
    );
  });

  await check("per-location attendance is now answerable", async () => {
    // The reporting question that could not be asked at all before.
    const byLocation = await ClockRecord.aggregate([
      { $match: { date } },
      { $group: { _id: "$locationId", records: { $sum: 1 } } },
    ]);
    assert.equal(byLocation.length, 2);
  });

  /* ---------------------------------------------- sites drive their location */

  await check("a new site gets a location without anyone adding one", async () => {
    const fresh = new mongoose.Types.ObjectId();
    await syncLocationForSite(fresh, { name: "Dock Road", isActive: true });
    const loc = await resolveLocationForSite(fresh);
    assert.equal(loc?.name, "Dock Road");
    assert.equal(loc.kind, "site");
  });

  await check("renaming the site renames its location", async () => {
    // Nobody should have to keep the same name up to date in two places.
    const fresh = new mongoose.Types.ObjectId();
    await syncLocationForSite(fresh, { name: "Old Wharf", isActive: true });
    await syncLocationForSite(fresh, { name: "New Wharf", isActive: true });
    const loc = await resolveLocationForSite(fresh);
    assert.equal(loc.name, "New Wharf");
    assert.equal(
      await ClockLocation.countDocuments({ projectSiteId: fresh }),
      1,
      "renaming created a second location instead of renaming the first",
    );
  });

  await check("closing the site archives its location", async () => {
    const fresh = new mongoose.Types.ObjectId();
    await syncLocationForSite(fresh, { name: "Finished Job", isActive: true });
    await syncLocationForSite(fresh, { name: "Finished Job", isActive: false });
    const row = await ClockLocation.findOne({ projectSiteId: fresh }).lean();
    assert.equal(row.isActive, false);
  });

  await check("two sites may share a name", async () => {
    // Real site lists contain repeats — a company running two jobs both called
    // "Park Road New" is not a data error, and it is exactly what stopped the
    // first production backfill halfway through. A site location's name is
    // owned by the site and follows it, repeats included.
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    await syncLocationForSite(a, { name: "Park Road New", isActive: true });
    await syncLocationForSite(b, { name: "Other Site", isActive: true });

    await syncLocationForSite(b, { name: "Park Road New", isActive: true });
    const row = await ClockLocation.findOne({ projectSiteId: b }).lean();
    assert.equal(
      row.name,
      "Park Road New",
      "a site renamed to match another site should keep its own name in step",
    );
    assert.equal(
      await ClockLocation.countDocuments({ name: "Park Road New" }),
      2,
      "both sites should have their own location",
    );
  });

  await check("a sync that cannot happen never throws", async () => {
    // Office names ARE unique — one is typed by a person, and two alike are
    // indistinguishable in a picker. A site renamed onto an office name must
    // therefore still be refused, and must not break saving the site: the
    // location keeps its old name, which is visible and fixable.
    const other = new mongoose.Types.ObjectId();
    await syncLocationForSite(other, { name: "Not An Office", isActive: true });
    await ClockLocation.create({ name: "Northgate Two", kind: "office" });

    await syncLocationForSite(other, { name: "Northgate Two", isActive: true });
    const row = await ClockLocation.findOne({ projectSiteId: other }).lean();
    assert.equal(
      row.name,
      "Not An Office",
      "the clash with an office name should be refused",
    );
  });

  await check("a NEW site on an office's name still gets a location", async () => {
    // Refusing outright would leave the site with nowhere to clock in at all,
    // which is worse than an awkward name.
    await ClockLocation.create({ name: "Northgate Three", kind: "office" });
    const fresh = new mongoose.Types.ObjectId();
    await syncLocationForSite(fresh, { name: "Northgate Three", isActive: true });

    const row = await ClockLocation.findOne({ projectSiteId: fresh }).lean();
    assert.ok(row, "the site was left with no location at all");
    assert.notEqual(row.name, "Northgate Three", "it shadowed the office name");
    assert.match(row.name, /^Northgate Three \(Site /);
  });

  await check("archiving still works through a refused rename", async () => {
    // The name is dropped, not the whole sync — otherwise a site that happened
    // to clash could never be archived.
    await ClockLocation.create({ name: "Northgate Four", kind: "office" });
    const fresh = new mongoose.Types.ObjectId();
    await syncLocationForSite(fresh, { name: "Keeps Name", isActive: true });
    await syncLocationForSite(fresh, { name: "Northgate Four", isActive: false });

    const row = await ClockLocation.findOne({ projectSiteId: fresh }).lean();
    assert.equal(row.name, "Keeps Name", "the clashing rename should be dropped");
    assert.equal(row.isActive, false, "but the archive should still apply");
  });

  await check("a bad site id is ignored rather than throwing", async () => {
    await syncLocationForSite(null, { name: "Nowhere" });
    await syncLocationForSite("nonsense", { name: "Nowhere" });
    assert.equal(await ClockLocation.countDocuments({ name: "Nowhere" }), 0);
  });

  /* -------------------------------------------------- a shift that moved */

  await check("THE OFFICE WORKER WHO FINISHES ON A SITE", async () => {
    // Clock in on the office QR code, drive to a site, tap its tag on the way
    // home. The record is at the OFFICE, so a lookup keyed on the site found
    // nothing and the tap was refused with "You must clock in first" —
    // leaving an open shift the employee had no way to close.
    const { performClockAction } = await import(
      "@/server/clockServer/clockActions"
    );

    const office = await ensureDefaultLocation();
    const site = await ClockLocation.create({
      name: "Elm Street",
      kind: "site",
      projectSiteId: new mongoose.Types.ObjectId(),
    });

    const traveller = new mongoose.Types.ObjectId();
    const day = new Date(Date.UTC(2026, 8, 28));

    const inAtOffice = await performClockAction({
      employeeId: traveller,
      employeeType: "OfficeEmployee",
      location: office,
      action: "clockIn",
      date: day,
      currentTime: "09:00",
    });
    assert.equal(inAtOffice.success, true, inAtOffice.message);

    const outAtSite = await performClockAction({
      employeeId: traveller,
      employeeType: "OfficeEmployee",
      location: site,
      siteId: site.projectSiteId,
      action: "clockOut",
      date: day,
      currentTime: "17:30",
    });
    assert.equal(outAtSite.success, true, outAtSite.message);

    // One record, not two: the shift it belongs to is the one it started on.
    const records = await ClockRecord.find({ employeeId: traveller, date: day }).lean();
    assert.equal(records.length, 1, "a second record was created at the site");
    assert.equal(String(records[0].locationId), String(office._id));
    assert.equal(records[0].clockIn, "09:00");
    assert.equal(records[0].clockOut, "17:30");
    // But where they actually finished is recorded, so the report reads as a
    // fact rather than a bug.
    assert.equal(
      String(records[0].clockOutLocationId),
      String(site._id),
      "it did not record where the shift ended",
    );
  });

  await check("a break can be taken somewhere else too", async () => {
    const { performClockAction } = await import(
      "@/server/clockServer/clockActions"
    );
    const office = await ensureDefaultLocation();
    const site = await ClockLocation.findOne({ name: "Elm Street" });

    const walker = new mongoose.Types.ObjectId();
    const day = new Date(Date.UTC(2026, 8, 29));

    await performClockAction({
      employeeId: walker,
      employeeType: "OfficeEmployee",
      location: office,
      action: "clockIn",
      date: day,
      currentTime: "08:00",
    });
    const br = await performClockAction({
      employeeId: walker,
      employeeType: "OfficeEmployee",
      location: site,
      action: "breakIn",
      date: day,
      currentTime: "12:00",
    });
    assert.equal(br.success, true, br.message);

    const record = await ClockRecord.findOne({ employeeId: walker, date: day }).lean();
    assert.equal(record.breaks.length, 1);
    assert.equal(record.breaks[0].breakIn, "12:00");
  });

  await check("mid-shift, a tap elsewhere says you are already clocked in", async () => {
    // Not an error state — it is true, and it is what somebody mid-shift
    // should be told rather than being given a second open shift.
    const { performClockAction } = await import(
      "@/server/clockServer/clockActions"
    );
    const office = await ensureDefaultLocation();
    const site = await ClockLocation.findOne({ name: "Elm Street" });

    const busy = new mongoose.Types.ObjectId();
    const day = new Date(Date.UTC(2026, 8, 30));

    await performClockAction({
      employeeId: busy,
      employeeType: "OfficeEmployee",
      location: office,
      action: "clockIn",
      date: day,
      currentTime: "09:00",
    });
    const again = await performClockAction({
      employeeId: busy,
      employeeType: "OfficeEmployee",
      location: site,
      action: "clockIn",
      date: day,
      currentTime: "13:00",
    });
    assert.equal(again.success, false);
    assert.match(again.message, /already clocked in/i);

    assert.equal(
      await ClockRecord.countDocuments({ employeeId: busy, date: day }),
      1,
      "a second open shift was created",
    );
  });

  await check("A FINISHED SHIFT DOES NOT BLOCK A SECOND ONE", async () => {
    // Clocked out at the office at lunchtime, then genuinely starts again at
    // a site in the afternoon. Only an OPEN shift elsewhere is adopted, so
    // this is still two records — which is what per-location reporting needs.
    const { performClockAction } = await import(
      "@/server/clockServer/clockActions"
    );
    const office = await ensureDefaultLocation();
    const site = await ClockLocation.findOne({ name: "Elm Street" });

    const doubled = new mongoose.Types.ObjectId();
    const day = new Date(Date.UTC(2026, 9, 1));

    await performClockAction({
      employeeId: doubled,
      employeeType: "OfficeEmployee",
      location: office,
      action: "clockIn",
      date: day,
      currentTime: "08:00",
    });
    await performClockAction({
      employeeId: doubled,
      employeeType: "OfficeEmployee",
      location: office,
      action: "clockOut",
      date: day,
      currentTime: "12:00",
    });

    const second = await performClockAction({
      employeeId: doubled,
      employeeType: "OfficeEmployee",
      location: site,
      siteId: site.projectSiteId,
      action: "clockIn",
      date: day,
      currentTime: "13:00",
    });
    assert.equal(second.success, true, second.message);
    assert.equal(
      await ClockRecord.countDocuments({ employeeId: doubled, date: day }),
      2,
      "the afternoon shift was folded into the morning one",
    );
  });

  /* --------------------------------------------------------- integrity */

  await check("two locations in one company cannot share a name", async () => {
    await assert.rejects(
      () => ClockLocation.create({ name: "Northgate Office", kind: "office" }),
      /E11000/,
    );
  });

  await check("the full list includes archived places", async () => {
    // Site Projects lists every site whatever its state. The settings table
    // reads this list, so if it dropped archived ones a company with ten sites
    // would see seven and nothing would say where the rest went.
    const { getAllClockLocations, getClockLocations } = await import(
      "@/server/clockServer/locations"
    );

    const closed = new mongoose.Types.ObjectId();
    await syncLocationForSite(closed, { name: "Closed Job", isActive: true });
    await syncLocationForSite(closed, { name: "Closed Job", isActive: false });

    const all = JSON.parse((await getAllClockLocations()).data);
    const active = JSON.parse((await getClockLocations()).data);

    assert.ok(
      all.some((l) => l.name === "Closed Job"),
      "the archived location is missing from the full list",
    );
    assert.ok(
      !active.some((l) => l.name === "Closed Job"),
      "an archived place was offered to a picker",
    );
    assert.ok(all.length > active.length);
  });

  await check("every site has a location, archived or not", async () => {
    // The invariant behind the two screens agreeing. A site without one cannot
    // be clocked in at, and would be invisible here while visible there.
    const ProjectSite = (await import("@/models/siteProjectModel")).default;
    const { getAllClockLocations } = await import(
      "@/server/clockServer/locations"
    );

    const sitesInDb = await ProjectSite.countDocuments({
      siteDelete: { $ne: true },
    });
    const all = JSON.parse((await getAllClockLocations()).data);
    const fromSites = all.filter((l) => l.projectSiteId).length;

    assert.ok(
      fromSites >= sitesInDb,
      `${sitesInDb} site(s) but only ${fromSites} site location(s)`,
    );
  });

  await check("a company cannot have two defaults", async () => {
    await assert.rejects(
      () =>
        ClockLocation.create({
          name: "Another default",
          kind: "office",
          isDefault: true,
        }),
      /E11000/,
      "a second default would make untagged records ambiguous again",
    );
  });

  await check("archiving frees the name for reuse", async () => {
    // The name index is partial on isActive, so a closed site's name can come
    // back on a new one without deleting the history.
    const old = await ClockLocation.findOne({ name: "Northgate Office" });
    await ClockLocation.updateOne(
      { _id: old._id },
      { $set: { isActive: false } },
    );
    const fresh = await ClockLocation.create({
      name: "Northgate Office",
      kind: "office",
    });
    assert.notEqual(String(fresh._id), String(old._id));
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
