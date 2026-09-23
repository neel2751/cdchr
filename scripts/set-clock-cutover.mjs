/**
 * Set the day each company's clock data starts being answerable.
 *
 * The auto-closer flags a shift nobody clocked out of so that an admin can go
 * and settle it. Pointed at migrated history it flags months of holes nobody
 * can answer — the first production migration left 24 open shifts, the oldest
 * sixteen months old and the newest five months old. A review queue full of
 * unanswerable items is one people stop opening, which costs more than the
 * rows it found.
 *
 * So each company gets a floor. Nothing dated before it is flagged, and
 * nothing before it is priced for overtime either: writing a pay figure onto a
 * record from before this system was authoritative is the same retroactive
 * change, and a quieter one, because it lands in a report rather than a queue.
 *
 * Run this AFTER the three migrations (see CLOCK_LOCATION_PLAN.md §3.4).
 * Running it before would set a floor and then import history beneath it,
 * which is the same outcome but harder to read six months later.
 *
 * Usage:
 *   node scripts/set-clock-cutover.mjs                      # dry run, today
 *   node scripts/set-clock-cutover.mjs --apply
 *   node scripts/set-clock-cutover.mjs --apply --date 2026-09-23
 *   node scripts/set-clock-cutover.mjs --apply --tenant <tenantId>
 *   node scripts/set-clock-cutover.mjs --apply --clear      # back to no floor
 *
 * Talks to the driver directly rather than through the models, so it sees every
 * company's settings regardless of TENANT_ENFORCEMENT.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const CLEAR = args.includes("--clear");

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i === args.length - 1) return undefined;
  const v = args[i + 1];
  return v.startsWith("--") ? undefined : v;
}

/** UTC midnight, matching how clock records store their date. */
function toCutover(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const raw = flag("date");
  const cutover = CLEAR ? null : toCutover(raw);
  if (!CLEAR && !cutover) {
    console.error(`Could not read --date ${JSON.stringify(raw)}.`);
    process.exitCode = 1;
    return;
  }
  // A floor in the future would switch the auto-closer off for shifts that
  // have not been worked yet, and would do it silently.
  if (cutover && cutover.getTime() > Date.now()) {
    console.error("The cutover cannot be in the future.");
    process.exitCode = 1;
    return;
  }

  const tenantId = flag("tenant");
  await mongoose.connect(process.env.MONGO_DB_URL);
  const db = mongoose.connection.db;

  const scope = tenantId
    ? { _id: new mongoose.Types.ObjectId(String(tenantId)) }
    : {};
  const companies = await db
    .collection("companies")
    .find({ ...scope, delete: { $ne: true }, isActive: { $ne: false } })
    .project({ _id: 1, companyName: 1, name: 1 })
    .toArray();

  if (!companies.length) {
    console.log("No companies matched.");
    await mongoose.disconnect();
    return;
  }

  const settings = db.collection("worksettings");
  const records = db.collection("clockrecords");

  console.log(
    CLEAR
      ? "Clearing the cutover — every shift will be reviewed again.\n"
      : `Cutover: ${cutover.toISOString().slice(0, 10)}\n`,
  );

  for (const company of companies) {
    const tenant = company._id;
    const label = company.companyName || company.name || String(tenant);

    // What the floor actually hides, counted before it is set — the number is
    // the point of the exercise, and it is worth printing even on a dry run.
    const open = {
      isDeleted: { $ne: true },
      clockIn: { $type: "string", $ne: "" },
      needsReview: { $ne: true },
      $or: [
        { clockOut: null },
        { clockOut: { $exists: false } },
        { breaks: { $elemMatch: { breakIn: { $ne: null }, breakOut: null } } },
      ],
    };
    const total = await records.countDocuments({ tenantId: tenant, ...open });
    const hidden = cutover
      ? await records.countDocuments({
          tenantId: tenant,
          date: { $lt: cutover },
          ...open,
        })
      : 0;

    const current = await settings.findOne({ tenantId: tenant });
    const was = current?.clockCutoverDate
      ? new Date(current.clockCutoverDate).toISOString().slice(0, 10)
      : "none";

    console.log(
      `  ${label}: ${total} open shift(s), ${hidden} before the cutover ` +
        `— ${total - hidden} would stay in the queue (was: ${was})`,
    );

    if (!APPLY) continue;

    // upsert: a company that has never opened the settings screen has no
    // document yet, and it still needs a floor. $setOnInsert carries the same
    // defaults the schema would have applied.
    await settings.updateOne(
      { tenantId: tenant },
      {
        $set: { clockCutoverDate: cutover, updatedAt: new Date() },
        $setOnInsert: {
          tenantId: tenant,
          fixedWeeklyHours: 40,
          defaultDaysPerWeek: 5,
          observesBankHolidays: false,
          bankHolidayRegion: "england-and-wales",
          maxShiftHours: 16,
          minMinutesBeforeBreak: 0,
          minBreakMinutes: 0,
          minMinutesBeforeClockOut: 0,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
  } else {
    console.log(
      `\nDone. ${companies.length} company(ies) updated.` +
        (cutover
          ? "\nThe review queue now starts clean. Existing flags are left as" +
            " they are — this changes what future runs pick up, and clearing" +
            " a flag stays a human decision."
          : ""),
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
