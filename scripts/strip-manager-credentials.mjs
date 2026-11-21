/**
 * Remove the email and password hash copied onto site manager links.
 *
 * A site manager link (models/siteAssignManagerModel.js, collection
 * `assignprojects`) names a person and a site for a period. It also used to
 * carry a copy of that person's email and bcrypt password hash, taken when the
 * link was saved. Nothing read the copies — sign-in uses the staff account —
 * but they went stale on every password change and were one more place a
 * password hash could leak from. handleSiteAssignManager no longer writes
 * them; this removes the ones already stored.
 *
 * Only those two fields are touched. No link changes site, person, dates or
 * status.
 *
 * Usage:
 *   node scripts/strip-manager-credentials.mjs                 # dry run
 *   node scripts/strip-manager-credentials.mjs --apply
 *   node scripts/strip-manager-credentials.mjs --apply --tenant <tenantId>
 *
 * Talks to the driver directly rather than through the models, so it sees every
 * tenant's rows regardless of TENANT_ENFORCEMENT.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i === args.length - 1) return undefined;
  const v = args[i + 1];
  return v.startsWith("--") ? undefined : v;
}

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const tenantId = flag("tenant");
  await mongoose.connect(process.env.MONGO_DB_URL);
  const links = mongoose.connection.db.collection("assignprojects");

  const scope = tenantId
    ? { tenantId: new mongoose.Types.ObjectId(String(tenantId)) }
    : {};
  const carrying = {
    ...scope,
    $or: [{ password: { $exists: true } }, { email: { $exists: true } }],
  };

  const total = await links.countDocuments(scope);
  const affected = await links.countDocuments(carrying);
  console.log(
    `${total} manager link(s), ${affected} carrying a copied email or password`,
  );

  if (!affected) {
    console.log("Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const res = await links.updateMany(carrying, {
    $unset: { email: "", password: "" },
  });
  console.log(`\nCleared ${res.modifiedCount} link(s).`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
