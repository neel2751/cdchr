/**
 * Merge duplicate clock records so the unique index can be built.
 *
 * `clockrecords` had nothing stopping two rows for the same employee, day and
 * site, and every write path was a read followed by a separate write — so two
 * QR scans a second apart each saw "no record yet" and each created one. The
 * admin table takes the most recent match and stops, so the duplicate was
 * never visible; it showed up as hours that did not add up.
 *
 * models/clockInModel.js now declares that index. Mongo will refuse to build it
 * while duplicates exist, and the refusal appears only as a line in the server
 * log — the app carries on with no index at all. So this runs first.
 *
 * WHAT IT DOES to each group of duplicates:
 *   - keeps the richest row (most of clockIn/clockOut/breaks filled, oldest on
 *     a tie) as the survivor
 *   - widens it to the earliest clockIn and latest clockOut across the group,
 *     on the reading that the employee was there from first scan to last
 *   - unions the breaks, keyed on breakIn
 *   - soft-deletes the others (isDeleted: true) rather than removing them
 *
 * It also backfills `isDeleted: false` where the field is missing. The index is
 * partial on `isDeleted: false`, and a missing field would sit outside it —
 * leaving exactly the rows this is meant to constrain unconstrained.
 *
 * Rows whose times genuinely disagree are reported as CONFLICT. They are still
 * merged by the rule above; the listing is there so they can be checked.
 *
 * Usage:
 *   node scripts/dedupe-clock-records.mjs              # dry run, the default
 *   node scripts/dedupe-clock-records.mjs --apply
 *   node scripts/dedupe-clock-records.mjs --apply --tenant <tenantId>
 *
 * Talks to the driver directly rather than through the model, so it sees every
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

/** How much of a shift a row actually describes — the survivor is the richest. */
function completeness(doc) {
  return (
    (doc.clockIn ? 1 : 0) +
    (doc.clockOut ? 1 : 0) +
    (Array.isArray(doc.breaks) ? doc.breaks.length : 0)
  );
}

/** "HH:mm" is zero-padded 24-hour, so lexical order is chronological order. */
const earliest = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const latest = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

function mergeBreaks(docs) {
  const byBreakIn = new Map();
  for (const doc of docs) {
    for (const br of doc.breaks || []) {
      if (!br?.breakIn) continue;
      const existing = byBreakIn.get(br.breakIn);
      // A row that closed the break beats one that only opened it.
      if (!existing || (!existing.breakOut && br.breakOut)) {
        byBreakIn.set(br.breakIn, { breakIn: br.breakIn, breakOut: br.breakOut });
      }
    }
  }
  return [...byBreakIn.values()].sort((a, b) =>
    a.breakIn < b.breakIn ? -1 : 1,
  );
}

/** Do these rows tell different stories, or are they the same scan twice? */
function isConflict(docs) {
  const clockIns = new Set(docs.map((d) => d.clockIn).filter(Boolean));
  const clockOuts = new Set(docs.map((d) => d.clockOut).filter(Boolean));
  return clockIns.size > 1 || clockOuts.size > 1;
}

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const tenantId = flag("tenant");

  await mongoose.connect(process.env.MONGO_DB_URL);
  const col = mongoose.connection.db.collection("clockrecords");

  const scope = tenantId
    ? { tenantId: new mongoose.Types.ObjectId(String(tenantId)) }
    : {};

  // Step 1 — rows with no isDeleted at all would fall outside the partial
  // index, so they are normalised to false first.
  const missingFlag = await col.countDocuments({
    ...scope,
    isDeleted: { $exists: false },
  });
  if (missingFlag > 0) {
    console.log(
      `isDeleted missing on ${missingFlag} row(s) — ` +
        (APPLY ? "backfilling to false" : "would backfill to false"),
    );
    if (APPLY) {
      await col.updateMany(
        { ...scope, isDeleted: { $exists: false } },
        { $set: { isDeleted: false } },
      );
    }
  }

  // Step 2 — group the live rows exactly the way the index will key them.
  // $ifNull matters: in a $group key a missing field and an explicit null are
  // different, but the index treats both as null, so they have to be folded
  // together here or a real duplicate pair would be split into two groups.
  const groups = await col
    .aggregate(
      [
        { $match: { ...scope, isDeleted: { $ne: true } } },
        {
          $group: {
            _id: {
              tenantId: { $ifNull: ["$tenantId", null] },
              employeeId: { $ifNull: ["$employeeId", null] },
              date: { $ifNull: ["$date", null] },
              siteId: { $ifNull: ["$siteId", null] },
            },
            docs: { $push: "$$ROOT" },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  if (groups.length === 0) {
    console.log("No duplicate clock records. The unique index can be built.");
    await mongoose.disconnect();
    return;
  }

  const plan = [];
  let conflicts = 0;

  for (const group of groups) {
    const docs = [...group.docs].sort((a, b) => {
      const diff = completeness(b) - completeness(a);
      if (diff !== 0) return diff;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

    const [survivor, ...losers] = docs;
    const conflict = isConflict(docs);
    if (conflict) conflicts++;

    const merged = {
      clockIn: docs.map((d) => d.clockIn).reduce(earliest, null),
      clockOut: docs.map((d) => d.clockOut).reduce(latest, null),
      breaks: mergeBreaks(docs),
    };

    plan.push({
      conflict,
      key: {
        tenantId: group._id.tenantId?.toString() || null,
        employeeId: group._id.employeeId?.toString() || null,
        date: group._id.date,
        siteId: group._id.siteId?.toString() || null,
      },
      survivorId: survivor._id.toString(),
      deletedIds: losers.map((d) => d._id.toString()),
      merged,
      before: docs.map((d) => ({
        _id: d._id.toString(),
        clockIn: d.clockIn,
        clockOut: d.clockOut,
        breaks: d.breaks || [],
        status: d.status,
        createdAt: d.createdAt,
      })),
    });
  }

  const backup = `clock-dedupe-backup-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify(plan, null, 2));

  console.log(
    `\n${groups.length} duplicate group(s), ` +
      `${plan.reduce((n, p) => n + p.deletedIds.length, 0)} row(s) to soft-delete` +
      (conflicts ? `, ${conflicts} with conflicting times` : ""),
  );
  console.log(`Full before/after written to ${backup}\n`);

  for (const p of plan.slice(0, 20)) {
    const day = p.key.date ? new Date(p.key.date).toISOString().slice(0, 10) : "?";
    console.log(
      `${p.conflict ? "CONFLICT" : "  merge "} ` +
        `employee ${p.key.employeeId} on ${day}` +
        `${p.key.siteId ? ` site ${p.key.siteId}` : " (office)"} ` +
        `-> ${p.merged.clockIn || "--"}..${p.merged.clockOut || "--"} ` +
        `(${p.merged.breaks.length} break(s), dropping ${p.deletedIds.length})`,
    );
  }
  if (plan.length > 20) console.log(`  ... and ${plan.length - 20} more`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these changes.");
    await mongoose.disconnect();
    return;
  }

  let merged = 0;
  let deleted = 0;
  for (const p of plan) {
    await col.updateOne(
      { _id: new mongoose.Types.ObjectId(p.survivorId) },
      {
        $set: {
          ...(p.merged.clockIn ? { clockIn: p.merged.clockIn } : {}),
          ...(p.merged.clockOut ? { clockOut: p.merged.clockOut } : {}),
          breaks: p.merged.breaks,
          isDeleted: false,
        },
      },
    );
    merged++;

    const res = await col.updateMany(
      { _id: { $in: p.deletedIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { isDeleted: true } },
    );
    deleted += res.modifiedCount;
  }

  console.log(`\nMerged ${merged} group(s); soft-deleted ${deleted} row(s).`);
  console.log(
    "Now build the index:\n" +
      '  db.clockrecords.createIndex(\n' +
      '    { tenantId: 1, employeeId: 1, date: 1, siteId: 1 },\n' +
      '    { unique: true, partialFilterExpression: { isDeleted: false } }\n' +
      "  )\n" +
      "or just restart the app — mongoose builds it on model compile.",
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
