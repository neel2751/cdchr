/**
 * One-off migration: rename `eAddress.zipCode` to `eAddress.postCode` on site
 * employees.
 *
 * The field was renamed in models/employeModel.js. Mongoose ignores the old key
 * on read (readers fall back to it), so nothing is broken without this — but
 * until it runs, records keep a stale `zipCode` that queries cannot see.
 *
 * Only documents that still have `zipCode` are touched, and a document that
 * somehow has both keeps its existing `postCode`. Safe to run more than once.
 *
 * Usage:
 *   node scripts/migrate-zipcode-to-postcode.mjs           # apply
 *   node scripts/migrate-zipcode-to-postcode.mjs --dry-run # report only
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");
const COLLECTION = "employes";

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set. Add it to .env and retry.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const collection = mongoose.connection.db.collection(COLLECTION);

  const needsRename = { "eAddress.zipCode": { $exists: true } };

  const total = await collection.countDocuments(needsRename);
  const alsoHasPostCode = await collection.countDocuments({
    ...needsRename,
    "eAddress.postCode": { $exists: true },
  });

  console.log(`Collection: ${COLLECTION}`);
  console.log(`Documents with eAddress.zipCode : ${total}`);
  console.log(`  ...of which already have postCode (zipCode dropped): ${alsoHasPostCode}`);
  console.log(`  ...to be renamed                                   : ${total - alsoHasPostCode}`);

  if (DRY_RUN) {
    console.log("\nDry run — nothing written.");
    await mongoose.disconnect();
    return;
  }

  if (total === 0) {
    console.log("\nNothing to migrate.");
    await mongoose.disconnect();
    return;
  }

  // Documents holding both keys: postCode is authoritative, so just drop the
  // stale zipCode. $rename would overwrite the good value.
  const dropped = await collection.updateMany(
    { ...needsRename, "eAddress.postCode": { $exists: true } },
    { $unset: { "eAddress.zipCode": "" } },
  );

  // The normal case: move the value across.
  const renamed = await collection.updateMany(
    { ...needsRename, "eAddress.postCode": { $exists: false } },
    { $rename: { "eAddress.zipCode": "eAddress.postCode" } },
  );

  const remaining = await collection.countDocuments(needsRename);

  console.log(`\nRenamed        : ${renamed.modifiedCount}`);
  console.log(`Stale dropped  : ${dropped.modifiedCount}`);
  console.log(`Still with zipCode: ${remaining}`);
  console.log(remaining === 0 ? "\nMigration complete." : "\nWARNING: some documents still hold zipCode.");

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Migration failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
