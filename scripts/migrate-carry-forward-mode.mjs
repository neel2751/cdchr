/**
 * Move `carryForwardMode` onto `carryForwardOverrides`, then remove it.
 *
 * `carryForwardMode` was a single value on an office employee — "always",
 * "never" or "default" — covering every leave type at once. Exceptions are now
 * per leave type (`carryForwardOverrides`), because the carry-forward rules are:
 * a company can carry annual leave and company sick days under different limits,
 * and "never carries annual leave" says nothing about sick days.
 *
 * The old field has been read as a fallback meaning "every type" ever since, so
 * nothing broke. This is the tidy-up that lets it be deleted: each remaining
 * value is written out as one override per leave type the company has, which is
 * what it meant, and the field is then unset.
 *
 * "default" carries no information — it is the absence of an exception — so it is
 * simply unset with nothing written in its place.
 *
 * An employee who already has per-type overrides is left alone apart from the
 * unset: the per-type entries were set deliberately and later, so they win.
 *
 * Usage:
 *   node scripts/migrate-carry-forward-mode.mjs                 # dry run
 *   node scripts/migrate-carry-forward-mode.mjs --apply
 *   node scripts/migrate-carry-forward-mode.mjs --apply --tenant <tenantId>
 *
 * Talks to the driver directly rather than through the models, so it sees every
 * tenant's rows regardless of TENANT_ENFORCEMENT — and so it keeps working after
 * the field is gone from the schema.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const tenantFlag = process.argv.indexOf("--tenant");
const ONLY_TENANT =
  tenantFlag !== -1 ? process.argv[tenantFlag + 1] || null : null;

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  const employees = db.collection("officeemployes");
  const categories = db.collection("leavecategories");

  const filter = { carryForwardMode: { $exists: true } };
  if (ONLY_TENANT) {
    filter.tenantId = new mongoose.Types.ObjectId(ONLY_TENANT);
  }

  const rows = await employees
    .find(filter)
    .project({
      name: 1,
      tenantId: 1,
      carryForwardMode: 1,
      carryForwardOverrides: 1,
    })
    .toArray();

  if (!rows.length) {
    console.log("Nothing to migrate — no employee carries `carryForwardMode`.");
    await mongoose.disconnect();
    return;
  }

  // The leave types each company has, so "every type" can be written out as the
  // types that actually exist there.
  const typesByTenant = new Map();
  const typesFor = async (tenantId) => {
    const key = String(tenantId);
    if (typesByTenant.has(key)) return typesByTenant.get(key);
    const found = await categories
      .find({ tenantId, isDeleted: { $ne: true } })
      .project({ leaveType: 1 })
      .toArray();
    const names = found.map((row) => row.leaveType).filter(Boolean);
    typesByTenant.set(key, names);
    return names;
  };

  let expanded = 0;
  let clearedOnly = 0;
  let keptExisting = 0;
  let noTypes = 0;

  for (const row of rows) {
    const mode = row.carryForwardMode;
    const label = `${row.name || row._id}`;

    // Already has per-type exceptions: those were set deliberately and later, so
    // they win. The old field is only unset.
    if (Array.isArray(row.carryForwardOverrides) && row.carryForwardOverrides.length) {
      keptExisting++;
      if (APPLY) {
        await employees.updateOne(
          { _id: row._id },
          { $unset: { carryForwardMode: "" } }
        );
      }
      console.log(`  ${label}: has per-type overrides; clearing the old field`);
      continue;
    }

    if (mode !== "always" && mode !== "never") {
      clearedOnly++;
      if (APPLY) {
        await employees.updateOne(
          { _id: row._id },
          { $unset: { carryForwardMode: "" } }
        );
      }
      continue;
    }

    const types = await typesFor(row.tenantId);
    if (!types.length) {
      // Nothing to expand to. The value had no effect either — an override
      // names a leave type, and this company has none.
      noTypes++;
      if (APPLY) {
        await employees.updateOne(
          { _id: row._id },
          { $unset: { carryForwardMode: "" } }
        );
      }
      console.log(`  ${label}: "${mode}" dropped — company has no leave types`);
      continue;
    }

    const overrides = types.map((leaveType) => ({ leaveType, mode }));
    expanded++;
    console.log(
      `  ${label}: "${mode}" → ${overrides.length} per-type override(s)`
    );
    if (APPLY) {
      await employees.updateOne(
        { _id: row._id },
        {
          $set: { carryForwardOverrides: overrides },
          $unset: { carryForwardMode: "" },
        }
      );
    }
  }

  console.log(
    `\n${rows.length} employee(s) carried the old field.\n` +
      `  expanded to per-type overrides : ${expanded}\n` +
      `  had per-type overrides already : ${keptExisting}\n` +
      `  "default", nothing to keep     : ${clearedOnly}\n` +
      `  no leave types to expand to    : ${noTypes}`
  );
  console.log(
    APPLY
      ? "\nApplied. `carryForwardMode` is now unset on every row above."
      : "\nDry run — nothing was written. Re-run with --apply."
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
