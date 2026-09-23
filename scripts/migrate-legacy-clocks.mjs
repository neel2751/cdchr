/**
 * Move attendance out of `clocks` and `siteclocks` into `clockrecords`.
 *
 * The app has three clock collections. `clockrecords` is the one everything
 * writes to; the other two are what it wrote to before, and they were never
 * emptied. That would be harmless cruft except that two screens still *read*
 * the old ones — the punctuality chart on /admin/me/attendance, and the
 * attendance tab on a site employee's profile — so both have been showing
 * whatever was in those collections on the day writing stopped, and nothing
 * since. Repointing them at `clockrecords` is the fix, and this has to run
 * first or repointing them loses the history instead of finding it.
 *
 * WHAT MOVES
 *   clocks      -> office records (employeeType OfficeEmployee), or site
 *                  records where the row carried a siteId
 *   siteclocks  -> site records (employeeType Employee)
 *
 * The old shape had one break per day (breakIn/breakOut as plain fields); the
 * new one has a list. A row with both becomes a list of one. A row with a
 * breakOut and no breakIn is malformed — the break is dropped and the row is
 * reported, because inventing a start time would put made-up minutes into
 * somebody's pay.
 *
 * NOTHING IS DELETED. Rows are copied, the originals are left exactly as they
 * are, and a row that would collide with an existing `clockrecords` entry for
 * the same employee, day and site is skipped rather than overwriting it —
 * `clockrecords` is the live collection and its version is the current one.
 * Dropping the old collections afterwards is a separate decision for a human.
 *
 * Usage:
 *   node scripts/migrate-legacy-clocks.mjs                  # dry run, default
 *   node scripts/migrate-legacy-clocks.mjs --apply
 *   node scripts/migrate-legacy-clocks.mjs --apply --tenant <tenantId>
 *
 * ORDER: run scripts/dedupe-clock-records.mjs, then
 * scripts/backfill-clock-locations.mjs, then this. The locations have to exist
 * before legacy rows can be given one, and the unique index on clockrecords
 * keys on locationId — rows arriving without one collide as soon as two share
 * an employee and a day.
 *
 * Talks to the driver directly rather than through the models, so it sees every
 * tenant's rows regardless of TENANT_ENFORCEMENT.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { writeFileSync } from "node:fs";

dotenv.config();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i === args.length - 1) return undefined;
  const v = args[i + 1];
  return v.startsWith("--") ? undefined : v;
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isClockTime = (v) => typeof v === "string" && CLOCK_TIME.test(v);

/** UTC midnight of whatever day this value names. */
function toWorkingDay(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The same three words lib/clockStatus.js defines, derived the same way. */
function deriveStatus(clockIn, clockOut, breaks) {
  if (!clockIn) return null;
  if (clockOut) return "clocked-out";
  return breaks.some((b) => b.breakIn && !b.breakOut) ? "on-break" : "checked-in";
}

/**
 * Turn one legacy row into a clockrecords document.
 * Returns `{ doc, note }` — note is set when something had to be dropped.
 */
function convert(row, { employeeType, source, locationId }) {
  const date = toWorkingDay(row.date);
  if (!date) return { doc: null, note: "unreadable date" };
  if (!isClockTime(row.clockIn)) {
    return { doc: null, note: `unusable clockIn ${JSON.stringify(row.clockIn)}` };
  }

  let note = null;
  const breaks = [];
  if (isClockTime(row.breakIn)) {
    breaks.push({
      breakIn: row.breakIn,
      ...(isClockTime(row.breakOut) ? { breakOut: row.breakOut } : {}),
    });
    if (row.breakOut && !isClockTime(row.breakOut)) {
      note = `break end ${JSON.stringify(row.breakOut)} was unreadable and dropped`;
    }
  } else if (row.breakOut) {
    // A break that ended without starting. Guessing a start would invent paid
    // or unpaid minutes; leaving it out is the only honest option.
    note = `break end ${JSON.stringify(row.breakOut)} had no start and was dropped`;
  }

  const clockOut = isClockTime(row.clockOut) ? row.clockOut : null;
  if (row.clockOut && !clockOut) {
    note = `clockOut ${JSON.stringify(row.clockOut)} was unreadable and dropped`;
  }

  return {
    note,
    doc: {
      tenantId: row.tenantId ?? null,
      employeeId: row.employeeId,
      employeeType,
      siteId: row.siteId ?? null,
      // The place, not just the site. The unique index keys on this, and a
      // batch of rows all carrying a null locationId would collide with each
      // other the moment two of them shared an employee and a day.
      locationId: locationId ?? null,
      locationType: row.siteId ? "site" : "office",
      date,
      clockIn: row.clockIn,
      ...(clockOut ? { clockOut } : {}),
      breaks,
      overtime: 0,
      status: deriveStatus(row.clockIn, clockOut, breaks),
      ...(row.clockInLocation ? { clockInLocation: row.clockInLocation } : {}),
      ...(row.clockBy ? { clockBy: row.clockBy } : {}),
      isLocked: row.isLocked ?? false,
      isDeleted: row.isDeleted ?? false,
      createdAt: row.createdAt ?? new Date(),
      updatedAt: row.updatedAt ?? new Date(),
      // Kept so a row can be traced back to where it came from, and so a
      // second run can recognise its own work.
      migratedFrom: { collection: source, _id: row._id },
    },
  };
}

/** The key the unique index uses, as a string, for collision detection. */
const keyOf = (doc) =>
  [
    doc.tenantId ? String(doc.tenantId) : "-",
    String(doc.employeeId),
    doc.date.toISOString(),
    // Keyed on the location, matching the unique index. Keying on siteId
    // would let two office rows through that the index then rejects.
    doc.locationId ? String(doc.locationId) : "-",
  ].join("|");

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const tenantId = flag("tenant");
  await mongoose.connect(process.env.MONGO_DB_URL);
  const db = mongoose.connection.db;

  const scope = tenantId
    ? { tenantId: new mongoose.Types.ObjectId(String(tenantId)) }
    : {};

  const target = db.collection("clockrecords");
  const locations = db.collection("clocklocations");

  // Where each legacy row belongs. Built once per tenant: the site's own
  // location, or that company's default office for a row with no site.
  //
  // This is why scripts/backfill-clock-locations.mjs must run FIRST. It was
  // the other way round when this script was written, before locations
  // existed — but the unique index now keys on locationId, so rows have to
  // arrive already knowing their place.
  const locationCache = new Map();
  async function locationFor(tenantId, siteId) {
    const key = `${tenantId}|${siteId || "-"}`;
    if (locationCache.has(key)) return locationCache.get(key);

    const found = siteId
      ? await locations.findOne({ tenantId, projectSiteId: siteId })
      : await locations.findOne({ tenantId, isDefault: true });

    locationCache.set(key, found?._id || null);
    return found?._id || null;
  }

  // Every live key already in the target, so a legacy row cannot overwrite the
  // current version of the same day.
  const existing = new Set();
  for await (const doc of target.find(
    { ...scope, isDeleted: { $ne: true } },
    { projection: { tenantId: 1, employeeId: 1, date: 1, locationId: 1 } },
  )) {
    const day = toWorkingDay(doc.date);
    if (!day) continue;
    existing.add(keyOf({ ...doc, date: day }));
  }

  const plan = { insert: [], skipped: [], unusable: [] };
  const seenThisRun = new Set();

  for (const [name, employeeType] of [
    ["clocks", "OfficeEmployee"],
    ["siteclocks", "Employee"],
  ]) {
    const collections = await db.listCollections({ name }).toArray();
    if (collections.length === 0) {
      console.log(`${name}: collection does not exist, nothing to do`);
      continue;
    }

    const rows = await db.collection(name).find(scope).toArray();
    console.log(`${name}: ${rows.length} row(s)`);

    for (const row of rows) {
      const locationId = await locationFor(row.tenantId, row.siteId);
      if (!locationId) {
        plan.unusable.push({
          source: name,
          _id: String(row._id),
          reason: row.siteId
            ? "that site has no clock-in location — run clock:locations first"
            : "that company has no default office — run clock:locations first",
        });
        continue;
      }

      const { doc, note } = convert(row, { employeeType, source: name, locationId });
      if (!doc) {
        plan.unusable.push({ source: name, _id: String(row._id), reason: note });
        continue;
      }

      const key = keyOf(doc);
      if (existing.has(key)) {
        plan.skipped.push({
          source: name,
          _id: String(row._id),
          reason: "a live clockrecords entry already covers this day",
        });
        continue;
      }
      if (seenThisRun.has(key)) {
        // clocks and siteclocks can both hold the same employee-day; the first
        // one wins and the second is reported rather than silently dropped.
        plan.skipped.push({
          source: name,
          _id: String(row._id),
          reason: "another legacy row for the same day was migrated first",
        });
        continue;
      }

      seenThisRun.add(key);
      plan.insert.push({ doc, note, source: name, _id: String(row._id) });
    }
  }

  const backup = `clock-migration-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify(plan, null, 2));

  const withNotes = plan.insert.filter((p) => p.note);
  console.log(
    `\n${plan.insert.length} to migrate, ${plan.skipped.length} skipped, ` +
      `${plan.unusable.length} unusable` +
      (withNotes.length ? `, ${withNotes.length} partially salvaged` : ""),
  );
  console.log(`Full plan written to ${backup}\n`);

  for (const p of withNotes.slice(0, 10)) {
    console.log(`  salvaged  ${p.source}/${p._id}: ${p.note}`);
  }
  for (const p of plan.unusable.slice(0, 10)) {
    console.log(`  UNUSABLE  ${p.source}/${p._id}: ${p.reason}`);
  }
  if (plan.unusable.length > 10) {
    console.log(`  ... and ${plan.unusable.length - 10} more unusable`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these records.");
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  const BATCH = 500;
  for (let i = 0; i < plan.insert.length; i += BATCH) {
    const chunk = plan.insert.slice(i, i + BATCH).map((p) => p.doc);
    if (!chunk.length) break;
    // ordered:false so one bad row does not abandon the rest of the batch; a
    // duplicate-key here means the target gained a matching row mid-run, which
    // is exactly the row that should win.
    const res = await target.insertMany(chunk, { ordered: false }).catch((err) => {
      const inserted = err?.result?.nInserted ?? err?.insertedCount ?? 0;
      console.log(
        `  batch ${i / BATCH + 1}: ${inserted} inserted, ` +
          `${err?.writeErrors?.length ?? 0} rejected (likely already present)`,
      );
      return { insertedCount: inserted };
    });
    written += res.insertedCount ?? chunk.length;
  }

  console.log(`\nMigrated ${written} record(s) into clockrecords.`);
  console.log(
    "The legacy collections are untouched. Verify the attendance screens, " +
      "then drop `clocks` and `siteclocks` when you are satisfied.",
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
