/**
 * Phase 1 provisioning: give the existing business a proper tenant record, and
 * create the first platform admin.
 *
 * This does NOT scope any data — every collection stays exactly as it is, and
 * the running app is unaffected. All it does is fill in the tenant fields that
 * `models/companyModel.js` gained (slug, status, domains, branding, …) so the
 * platform console has something real to show, and so Phase 2's backfill has a
 * tenant to attribute existing records to.
 *
 * Safe to run more than once: every write is conditional on the value not
 * already being set.
 *
 * Usage:
 *   node scripts/seed-tenant.mjs --dry-run
 *   node scripts/seed-tenant.mjs --name "Creative Design & Construction" --slug cdc
 *   node scripts/seed-tenant.mjs --slug cdc --domain hr.cdc.construction --primary
 *   node scripts/seed-tenant.mjs --platform-admin "ops@example.com" --platform-name "Ops"
 *
 * Flags:
 *   --dry-run            report what would change, write nothing
 *   --name <string>      tenant to target/create by name (default: the only
 *                        existing company, if there is exactly one)
 *   --slug <string>      slug to assign (default: derived from the name)
 *   --domain <host>      register a custom domain for the tenant
 *   --primary            mark that domain primary (implies it, if it is first)
 *   --verified           mark that domain verified immediately — only for a
 *                        domain that already points at this deployment
 *   --platform-admin <email>   create a platform admin with this email
 *   --platform-name <string>   their display name (default: "Platform Admin")
 */
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

dotenv.config();

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function flag(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index === args.length - 1) return fallback;
  const value = args[index + 1];
  return value.startsWith("--") ? fallback : value;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set. Add it to .env and retry.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const companies = mongoose.connection.db.collection("companies");
  const platformUsers = mongoose.connection.db.collection("platformusers");

  console.log(DRY_RUN ? "DRY RUN — nothing will be written\n" : "");

  // ---------------------------------------------------------------- tenant --
  const wantedName = flag("name");
  let tenant;

  if (wantedName) {
    tenant = await companies.findOne({ name: wantedName, delete: { $ne: true } });
  } else {
    const existing = await companies
      .find({ delete: { $ne: true } })
      .limit(2)
      .toArray();
    if (existing.length === 1) {
      tenant = existing[0];
    } else if (existing.length === 0) {
      console.error(
        "No companies found. Re-run with --name \"<Company Name>\" to create one."
      );
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    } else {
      console.error(
        `Found ${existing.length}+ companies. Choose one with --name "<Company Name>".`
      );
      console.error("Companies:");
      for (const c of existing) console.error(`  - ${c.name}`);
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    }
  }

  if (!tenant && wantedName) {
    console.log(`Company "${wantedName}" not found — it will be created.`);
  }

  const slug = flag("slug") || slugify(tenant?.slug || tenant?.name || wantedName);
  if (!slug) {
    console.error("Could not derive a slug. Pass one with --slug.");
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  // A slug must identify exactly one tenant.
  const slugOwner = await companies.findOne({ slug });
  if (slugOwner && (!tenant || String(slugOwner._id) !== String(tenant._id))) {
    console.error(
      `Slug "${slug}" is already used by "${slugOwner.name}". Pass a different --slug.`
    );
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  // Only fill in what is missing — never overwrite values already configured.
  const updates = {};
  if (!tenant?.slug) updates.slug = slug;
  if (!tenant?.status) updates.status = "active";
  if (!tenant?.branding) updates.branding = {};
  if (!tenant?.features) updates.features = {};
  if (!tenant?.limits) updates.limits = {};
  if (!tenant?.locale) {
    updates.locale = {
      timezone: "Europe/London",
      dateFormat: "dd/MM/yyyy",
      currency: "GBP",
      weekStartsOn: 1,
      country: "United Kingdom",
    };
  }
  if (!tenant?.billing) updates.billing = { plan: "standard", seats: null };
  if (!Array.isArray(tenant?.domains)) updates.domains = [];

  const domainArg = normalizeHost(flag("domain"));
  let domainToAdd = null;
  if (domainArg) {
    const existingDomains = tenant?.domains || [];
    const alreadyHere = existingDomains.some((d) => d.host === domainArg);
    const owner = await companies.findOne({ "domains.host": domainArg });

    if (owner && (!tenant || String(owner._id) !== String(tenant._id))) {
      console.error(
        `Domain "${domainArg}" already belongs to "${owner.name}". Remove it there first.`
      );
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    }

    if (alreadyHere) {
      console.log(`Domain ${domainArg} is already registered — leaving as is.`);
    } else {
      domainToAdd = {
        host: domainArg,
        // The first domain a tenant gets is its primary unless told otherwise.
        isPrimary: args.includes("--primary") || existingDomains.length === 0,
        verified: args.includes("--verified"),
        verificationToken: crypto.randomBytes(16).toString("hex"),
        verifiedAt: args.includes("--verified") ? new Date() : undefined,
        sslStatus: "pending",
        addedAt: new Date(),
      };
    }
  }

  console.log("Tenant");
  console.log(`  name        : ${tenant?.name || wantedName}`);
  console.log(`  _id         : ${tenant?._id || "(new)"}`);
  console.log(`  slug        : ${tenant?.slug || slug}${tenant?.slug ? "" : "  (to set)"}`);
  console.log(`  status      : ${tenant?.status || "active"}`);
  console.log(
    `  domains     : ${(tenant?.domains || []).map((d) => d.host).join(", ") || "none"}`
  );
  if (domainToAdd) {
    console.log(
      `  + adding    : ${domainToAdd.host} (primary=${domainToAdd.isPrimary}, verified=${domainToAdd.verified})`
    );
    if (!domainToAdd.verified) {
      console.log(
        `    verify by publishing TXT _verify.${domainToAdd.host} = ${domainToAdd.verificationToken}`
      );
    }
  }

  if (!DRY_RUN) {
    if (tenant) {
      const write = {};
      if (Object.keys(updates).length) write.$set = updates;
      if (domainToAdd) write.$push = { domains: domainToAdd };
      if (Object.keys(write).length) {
        await companies.updateOne({ _id: tenant._id }, write);
        console.log("  → updated");
      } else {
        console.log("  → already up to date");
      }
    } else {
      const doc = {
        name: wantedName,
        description: "",
        slug,
        status: "active",
        domains: domainToAdd ? [domainToAdd] : [],
        branding: {},
        features: {},
        limits: {},
        locale: updates.locale,
        billing: { plan: "standard", seats: null },
        isActive: true,
        delete: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await companies.insertOne(doc);
      console.log(`  → created ${result.insertedId}`);
      tenant = { ...doc, _id: result.insertedId };
    }
  }

  // How many office employees are not yet attributed to any company. Phase 2's
  // backfill will claim these; reporting it now makes the scale visible.
  const officeEmployees = mongoose.connection.db.collection("officeemployes");
  const unassigned = await officeEmployees.countDocuments({
    delete: { $ne: true },
    $or: [{ company: null }, { company: { $exists: false } }],
  });
  const assigned = await officeEmployees.countDocuments({
    delete: { $ne: true },
    company: { $ne: null, $exists: true },
  });
  console.log(
    `\nOffice employees: ${assigned} with a company, ${unassigned} without (Phase 2 backfill).`
  );

  // -------------------------------------------------------- platform admin --
  const adminEmail = flag("platform-admin");
  if (adminEmail) {
    const email = adminEmail.trim().toLowerCase();
    const existing = await platformUsers.findOne({ email });

    console.log("\nPlatform admin");
    console.log(`  email : ${email}`);

    if (existing) {
      console.log("  → already exists, leaving untouched");
    } else if (DRY_RUN) {
      console.log("  → would be created (password prompted on a real run)");
    } else {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      const password = await rl.question("  Password (min 12 chars): ");
      rl.close();

      if (!password || password.length < 12) {
        console.error("\n  Password too short — no platform admin created.");
      } else {
        await platformUsers.insertOne({
          name: flag("platform-name", "Platform Admin"),
          email,
          password: await bcrypt.hash(password, 10),
          isActive: true,
          delete: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log("\n  → created. This account signs in at /auth like any");
        console.log("    other user and is redirected to /platform.");
        console.log("    It will be forced to enrol in 2FA on first login.");
      }
    }
  }

  console.log(DRY_RUN ? "\nDry run — nothing written." : "\nDone.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Seed failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
