/**
 * Give every existing office employee a membership for their own company.
 *
 * Memberships are what let one login manage several companies. Until this has
 * run, existing accounts have none — the company switcher would show nothing
 * and a switch could not be authorised, because authorisation is decided from
 * this collection rather than from the employee record.
 *
 * Idempotent: skips anyone who already has a membership for that company.
 *
 * Usage:
 *   node scripts/backfill-memberships.mjs --dry-run
 *   node scripts/backfill-memberships.mjs
 *   node scripts/backfill-memberships.mjs --grant you@example.com --tenant <id>
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i === args.length - 1) return fallback;
  const v = args[i + 1];
  return v.startsWith("--") ? fallback : v;
}

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
  const memberships = db.collection("tenantmemberships");
  const companies = db.collection("companies");

  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}Database: ${db.databaseName}\n`
  );

  const staff = await employees
    .find(
      { delete: { $ne: true }, tenantId: { $ne: null, $exists: true } },
      { projection: { email: 1, tenantId: 1, isSuperAdmin: 1, isAdmin: 1 } }
    )
    .toArray();

  let created = 0;
  let existing = 0;

  for (const e of staff) {
    const already = await memberships.findOne({
      userId: e._id,
      tenantId: e.tenantId,
    });
    if (already) {
      existing++;
      continue;
    }

    // The role they already hold in their own company.
    const role = e.isSuperAdmin ? "superAdmin" : e.isAdmin ? "admin" : "user";
    created++;
    if (!DRY_RUN) {
      await memberships.insertOne({
        userId: e._id,
        userModel: "OfficeEmploye",
        email: String(e.email || "").toLowerCase(),
        tenantId: e.tenantId,
        role,
        // Their own company is where they land unless another is made default.
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  console.log(`Office employees with a tenant : ${staff.length}`);
  console.log(`  already had a membership     : ${existing}`);
  console.log(`  ${DRY_RUN ? "would create" : "created"}                : ${created}`);

  // Optionally give one account access to an extra company straight away.
  const grantEmail = flag("grant");
  const grantTenant = flag("tenant");
  if (grantEmail && grantTenant) {
    if (!mongoose.isValidObjectId(grantTenant)) {
      console.error(`\n--tenant "${grantTenant}" is not a valid id.`);
    } else {
      const tenantOid = new mongoose.Types.ObjectId(grantTenant);
      const tenant = await companies.findOne({ _id: tenantOid });
      const account = await employees.findOne({
        email: String(grantEmail).toLowerCase(),
        delete: { $ne: true },
      });

      console.log(`\nExtra access`);
      if (!tenant) console.error(`  no company ${grantTenant}`);
      else if (!account) console.error(`  no account ${grantEmail}`);
      else {
        console.log(`  ${grantEmail} -> ${tenant.name}`);
        if (!DRY_RUN) {
          await memberships.updateOne(
            { userId: account._id, tenantId: tenantOid },
            {
              $set: {
                userModel: "OfficeEmploye",
                email: String(grantEmail).toLowerCase(),
                role: "superAdmin",
                isActive: true,
                updatedAt: new Date(),
              },
              $setOnInsert: { isDefault: false, createdAt: new Date() },
            },
            { upsert: true }
          );
          console.log("  → granted");
        }
      }
    }
  }

  console.log(DRY_RUN ? "\nDry run — nothing written." : "\nDone.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Backfill failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
