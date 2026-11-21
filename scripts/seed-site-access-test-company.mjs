/**
 * A throwaway company for trying the site access rule against a real database.
 *
 * scripts/seed-site-scope-fixtures.mjs does this for a local database. This one
 * is for a deployment's own database, so it is careful in the ways that needs:
 *
 *   - everything lives in ONE new company, "Site Access Test", found by the
 *     marker below — no real company's rows are read or written;
 *   - passwords are random, printed once, never the shared fixture password;
 *   - the super admin enrols their own two-factor on first sign-in, so no TOTP
 *     secret exists anywhere but their phone;
 *   - --remove deletes every row carrying that company's tenantId, in every
 *     collection, then the company itself — including anything the app wrote
 *     while it was being tried (sessions, audit entries, memberships).
 *
 * What it holds: Test Yard and Test Depot, one site worker each, assigned and
 * clocked in today; a manager who manages Test Yard only; a super admin.
 *
 * Usage:
 *   node scripts/seed-site-access-test-company.mjs            # what it would do
 *   node scripts/seed-site-access-test-company.mjs --apply    # create / reset
 *   node scripts/seed-site-access-test-company.mjs --remove   # delete it all
 *
 * Talks to the driver directly, so it is not subject to TENANT_ENFORCEMENT.
 */
import crypto from "node:crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

dotenv.config();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const REMOVE = args.includes("--remove");

const MARKER = "site-access-test";
const COMPANY_NAME = "Site Access Test";
const DOMAIN = "siteaccess.test";

/** Today's date in the UK, at UTC midnight — how clock records store it. */
function ukToday() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
}

/** Long, random, and with every character class a strength check asks for. */
function randomPassword() {
  return `Sat-${crypto.randomBytes(9).toString("base64url")}-7a!`;
}

async function main() {
  if (!process.env.MONGO_DB_URL) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }
  await mongoose.connect(process.env.MONGO_DB_URL);
  const db = mongoose.connection.db;
  console.log(`Database: ${db.databaseName}`);

  const existing = await db.collection("companies").findOne({ seedMarker: MARKER });

  if (REMOVE) {
    if (!existing) {
      console.log("No Site Access Test company here. Nothing to remove.");
      await mongoose.disconnect();
      return;
    }
    const tenantId = existing._id;
    for (const { name } of await db.listCollections().toArray()) {
      if (name.startsWith("system.")) continue;
      const res = await db.collection(name).deleteMany({ tenantId });
      if (res.deletedCount) console.log(`  ${name}: ${res.deletedCount} removed`);
    }
    await db.collection("companies").deleteOne({ _id: tenantId });
    console.log("Removed the Site Access Test company.");
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log(
      existing
        ? "Site Access Test exists. --apply resets its data and passwords."
        : "Site Access Test does not exist. --apply creates it.",
    );
    console.log("Dry run. Nothing written.");
    await mongoose.disconnect();
    return;
  }

  // Refuse to collide with somebody's real account.
  const emails = [`manager@${DOMAIN}`, `super@${DOMAIN}`];
  const clash = await db.collection("officeemployes").findOne({
    email: { $in: emails },
    ...(existing ? { tenantId: { $ne: existing._id } } : {}),
  });
  if (clash) {
    console.error(`${clash.email} already belongs to another company. Stopping.`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const today = ukToday();
  const DAY = 24 * 60 * 60 * 1000;
  const lastMonth = new Date(today.getTime() - 30 * DAY);
  const nextYear = new Date(today.getTime() + 365 * DAY);

  let tenantId = existing?._id;
  if (!tenantId) {
    tenantId = new mongoose.Types.ObjectId();
    await db.collection("companies").insertOne({
      _id: tenantId,
      name: COMPANY_NAME,
      description: "Throwaway company for testing site access. Safe to delete.",
      seedMarker: MARKER,
      status: "trial",
      isActive: true,
      delete: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  const upsert = async (collection, filter, doc) => {
    await db.collection(collection).updateOne(
      { tenantId, ...filter },
      {
        $set: { ...doc, tenantId, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    return db.collection(collection).findOne({ tenantId, ...filter });
  };

  const dept = await upsert("roletypes", { roleTitle: "Operations" }, {
    roleTitle: "Operations",
    isActive: true,
    delete: false,
  });

  const passwords = {
    manager: randomPassword(),
    super: randomPassword(),
  };

  const staff = async (key, name, flags) =>
    upsert("officeemployes", { email: `${key}@${DOMAIN}` }, {
      name,
      email: `${key}@${DOMAIN}`,
      phoneNumber: 7700900999,
      password: await bcrypt.hash(passwords[key], 10),
      roleType: "Staff",
      department: dept._id,
      company: tenantId,
      immigrationType: "British",
      employeType: "Full Time",
      joinDate: lastMonth,
      isActive: true,
      isAdmin: false,
      isSuperAdmin: false,
      delete: false,
      ...flags,
    });
  const manager = await staff("manager", "Tess Manager", {});
  await staff("super", "Sid Super", { isSuperAdmin: true });

  await upsert("rolebaseds", { employeeId: manager._id }, {
    name: "Site manager",
    employeeId: manager._id,
    permissions: [
      "/admin/dashboard",
      "/admin/siteAssignEmployee",
      "/admin/filterAttendance",
    ],
    isActive: true,
    isDeleted: false,
  });

  const site = (siteName) =>
    upsert("projectsites", { siteName }, {
      siteName,
      siteAddress: "1 Test Street",
      siteType: "Residential",
      status: "Active",
      siteDelete: false,
      isActive: true,
      startDate: lastMonth,
      endDate: nextYear,
    });
  const yard = await site("Test Yard");
  const depot = await site("Test Depot");

  await upsert("assignprojects", { roleId: manager._id, projectSiteID: yard._id }, {
    loginSiteId: `${MARKER}-${manager._id}`,
    roleId: manager._id,
    projectSiteID: yard._id,
    startDate: lastMonth,
    endDate: null,
    isActive: true,
    isDelete: false,
  });

  const worker = (firstName, lastName) =>
    upsert("employes", { email: `${firstName.toLowerCase()}@${DOMAIN}` }, {
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}@${DOMAIN}`,
      phone: 7700900888,
      paymentType: "Daily",
      payRate: 150,
      employeType: "Full Time",
      startDate: lastMonth,
      isActive: true,
      delete: false,
    });
  const sam = await worker("Sam", "Yard");
  const dee = await worker("Dee", "Depot");

  for (const [siteDoc, person] of [
    [yard, sam],
    [depot, dee],
  ]) {
    await upsert("siteassignments", { siteId: siteDoc._id, assignDate: today }, {
      siteId: siteDoc._id,
      assignDate: today,
      assignedEmployees: [
        { employeeId: person._id, assignedAt: now, isLocked: true },
      ],
    });
    await upsert(
      "clockrecords",
      { employeeId: person._id, date: today, siteId: siteDoc._id },
      {
        employeeId: person._id,
        employeeType: "Employee",
        locationType: "site",
        siteId: siteDoc._id,
        date: today,
        clockIn: "08:00",
        breaks: [],
        status: "checked-in",
        isDeleted: false,
      },
    );
  }

  console.log(`\nSite Access Test is ready (company id ${tenantId}).\n`);
  console.log(`  manager@${DOMAIN}  ${passwords.manager}`);
  console.log("      manages Test Yard only; no two-factor");
  console.log(`  super@${DOMAIN}    ${passwords.super}`);
  console.log("      super admin; sets up two-factor on first sign-in");
  console.log("\n  Test Yard    Sam Yard, clocked in 08:00 today");
  console.log("  Test Depot   Dee Depot, clocked in 08:00 today");
  console.log("\nPasswords are not stored anywhere else. Re-run --apply for new ones.");
  console.log("Remove it all with --remove.");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
