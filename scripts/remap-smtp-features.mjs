/**
 * Remap SMTP accounts onto the feature keys the app actually sends with.
 *
 * `feature` used to be a free-text box, so accounts were saved under labels
 * ("Invoice", "ITT", "IT") that resolveAccount() never asks for — those senders
 * were configured, active, and silently never used. The supported keys are now
 * fixed in data/emailFeatures.js.
 *
 * Matching is by userName, which is the stable identifier here; ids differ
 * between environments and the host can be edited.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   node scripts/remap-smtp-features.mjs             # show the plan
 *   node scripts/remap-smtp-features.mjs --apply     # write it
 *
 * Safe to re-run: an account already on its target feature is skipped.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const APPLY = process.argv.includes("--apply");

// userName -> feature. Decided with the account owner; see BRANCHES_PLAN.md
// style note in the commit. Edit this table rather than the logic below.
const MAPPING = {
  "hr@interiorstudioltd.com": "HR",
  "hr@cdc.construction": "All",
  "neel@cdc.construction": "Noreply",
  "patelneel1732@gmail.com": "Accounts",
};

const KNOWN_FEATURES = ["All", "HR", "Accounts", "Noreply"];

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const accounts = db.collection("emailaccounts");

  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN — nothing will be written"}\nDatabase: ${db.databaseName}\n`
  );

  const rows = await accounts
    .find(
      { isDeleted: { $ne: true } },
      { projection: { userName: 1, feature: 1, host: 1, otherHost: 1, isPrimary: 1 } }
    )
    .toArray();

  const planned = [];
  const unmapped = [];

  for (const row of rows) {
    const target = MAPPING[row.userName];
    if (!target) {
      unmapped.push(row);
      continue;
    }
    if (row.feature === target) continue; // already correct
    planned.push({ row, target });
  }

  // Two accounts landing on one feature would break the one-per-feature rule
  // the app now enforces, leaving a record that cannot be edited without first
  // changing the other. Refuse rather than write it.
  const finalFeatures = new Map();
  for (const row of rows) {
    const target = MAPPING[row.userName] || row.feature;
    if (!finalFeatures.has(target)) finalFeatures.set(target, []);
    finalFeatures.get(target).push(row.userName);
  }
  const clashes = [...finalFeatures.entries()].filter(
    ([f, list]) => list.length > 1 && KNOWN_FEATURES.includes(f)
  );

  for (const { row, target } of planned) {
    console.log(
      `  ${String(row.userName).padEnd(30)} "${row.feature}" -> "${target}"`
    );
  }
  if (!planned.length) console.log("  nothing to change");

  if (unmapped.length) {
    console.log("\n  NOT IN THE MAPPING (left alone):");
    unmapped.forEach((r) =>
      console.log(`    ${String(r.userName).padEnd(30)} "${r.feature}"`)
    );
  }

  if (clashes.length) {
    console.error("\nREFUSING: this mapping would put two accounts on one feature:");
    clashes.forEach(([f, list]) => console.error(`  "${f}": ${list.join(", ")}`));
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to write these changes.");
    await mongoose.disconnect();
    return;
  }

  for (const { row, target } of planned) {
    await accounts.updateOne(
      { _id: row._id },
      // isPrimary too: resolveAccount prefers the primary account for a
      // feature, and each of these is now the only one for its feature.
      { $set: { feature: target, isPrimary: true, updatedAt: new Date() } }
    );
    console.log(`  updated ${row.userName} -> ${target}`);
  }

  console.log(`\n${planned.length} account(s) updated.`);
  console.log("Run `npm run audit:smtp` to confirm nothing is left unusable.");

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exitCode = 1;
});
