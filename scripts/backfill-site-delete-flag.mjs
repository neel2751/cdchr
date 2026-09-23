/**
 * Stamp `siteDelete: false` on sites written before the field existed.
 *
 * `siteDelete` was added to models/siteProjectModel.js with `default: false`.
 * A schema default only applies to documents saved after it exists, so every
 * site created before that carries no such field — and the two queries that
 * list sites both filtered on `{ siteDelete: false }`, which does not match a
 * missing field.
 *
 * On one production tenant that hid six of ten sites from the Site Projects
 * screen, and five of seven active sites from every site dropdown: the rota,
 * site assignment and expenses all read that list.
 *
 * Both queries now use `{ siteDelete: { $ne: true } }`, which is the real fix —
 * it matches missing, false and null, and cannot be reintroduced by the next
 * document written without the field. This script is the tidy-up that follows:
 * it makes the stored data match the schema so the two readings agree.
 *
 * Nothing is deleted and no site changes state. A site with `siteDelete: true`
 * is left exactly as it is.
 *
 * Usage:
 *   node scripts/backfill-site-delete-flag.mjs                 # dry run
 *   node scripts/backfill-site-delete-flag.mjs --apply
 *   node scripts/backfill-site-delete-flag.mjs --apply --tenant <tenantId>
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
  const sites = mongoose.connection.db.collection("projectsites");

  const scope = tenantId
    ? { tenantId: new mongoose.Types.ObjectId(String(tenantId)) }
    : {};
  // Only documents genuinely missing the field, or holding null. A site already
  // marked deleted must not be resurrected by this.
  const unstamped = { ...scope, siteDelete: { $in: [null, undefined] } };

  const total = await sites.countDocuments(scope);
  const missing = await sites.countDocuments(unstamped);

  console.log(`${total} site(s), ${missing} missing the siteDelete flag`);

  if (!missing) {
    console.log("Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const sample = await sites
    .find(unstamped, { projection: { siteName: 1, isActive: 1, tenantId: 1 } })
    .limit(20)
    .toArray();
  for (const s of sample) {
    console.log(
      `  ${String(s.siteName).padEnd(20)} active=${s.isActive} ` +
        `tenant=${s.tenantId || "-"}`,
    );
  }
  if (missing > sample.length) {
    console.log(`  ... and ${missing - sample.length} more`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const res = await sites.updateMany(unstamped, {
    $set: { siteDelete: false },
  });
  console.log(`\nStamped ${res.modifiedCount} site(s).`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
