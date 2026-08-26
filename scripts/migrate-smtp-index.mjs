/**
 * Replace the platform-wide primary-sender constraint with a per-company one.
 *
 * `emailaccounts` carries `{ feature: 1, isPrimary: 1 }` unique, which allows
 * exactly ONE primary sender per feature across the whole platform. The second
 * company to mark an "HR" sender primary is rejected with a duplicate-key
 * error. Mongoose creates the replacement index but never drops the old one, so
 * this has to run explicitly.
 *
 * Also clears the `companyId_*` indexes left behind when the tenant field was
 * renamed to `tenantId`; they index a field nothing writes any more.
 *
 * Idempotent: skips anything already in the desired state.
 *
 * Usage:
 *   node scripts/migrate-smtp-index.mjs --dry-run
 *   node scripts/migrate-smtp-index.mjs
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");

const OLD_INDEX = "feature_1_isPrimary_1";
const NEW_INDEX = "tenantId_1_feature_1_isPrimary_1";

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const col = db.collection("emailaccounts");

  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}Database: ${db.databaseName}\n`
  );

  const before = await col.indexes();
  console.log("Current indexes:");
  before.forEach((i) =>
    console.log(
      `  ${i.name.padEnd(34)} ${JSON.stringify(i.key)}${i.unique ? "  UNIQUE" : ""}`
    )
  );

  // A tenant can only have one primary per feature, so check the data would not
  // violate the new constraint before creating it.
  const clashes = await col
    .aggregate([
      { $match: { isPrimary: true, isDeleted: { $ne: true } } },
      { $group: { _id: { t: "$tenantId", f: "$feature" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();

  if (clashes.length) {
    console.error(
      `\nCannot proceed: ${clashes.length} tenant/feature pair(s) already have more than one primary sender.`
    );
    clashes.forEach((c) =>
      console.error(`  tenantId=${c._id.t} feature=${c._id.f} count=${c.n}`)
    );
    console.error("Resolve these first, then re-run.");
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  const names = new Set(before.map((i) => i.name));
  const plan = [];
  if (names.has(OLD_INDEX)) plan.push(`drop  ${OLD_INDEX} (platform-wide)`);
  if (!names.has(NEW_INDEX)) plan.push(`create ${NEW_INDEX} (per company)`);
  for (const n of names) {
    if (n.startsWith("companyId_")) plan.push(`drop  ${n} (renamed to tenantId)`);
  }

  console.log(`\nPlan:\n${plan.length ? plan.map((p) => `  ${p}`).join("\n") : "  nothing to do"}`);

  if (!DRY_RUN && plan.length) {
    if (!names.has(NEW_INDEX)) {
      // Created before the old one is dropped, so there is no window in which
      // neither constraint applies.
      await col.createIndex(
        { tenantId: 1, feature: 1, isPrimary: 1 },
        {
          unique: true,
          partialFilterExpression: {
            isPrimary: true,
            tenantId: { $exists: true },
          },
          name: NEW_INDEX,
        }
      );
      console.log(`\n  created ${NEW_INDEX}`);
    }
    if (names.has(OLD_INDEX)) {
      await col.dropIndex(OLD_INDEX);
      console.log(`  dropped ${OLD_INDEX}`);
    }
    for (const n of names) {
      if (n.startsWith("companyId_")) {
        await col.dropIndex(n);
        console.log(`  dropped ${n}`);
      }
    }

    console.log("\nIndexes now:");
    (await col.indexes()).forEach((i) =>
      console.log(
        `  ${i.name.padEnd(34)} ${JSON.stringify(i.key)}${i.unique ? "  UNIQUE" : ""}`
      )
    );
  }

  console.log(DRY_RUN ? "\nDry run — nothing written." : "\nDone.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Migration failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
