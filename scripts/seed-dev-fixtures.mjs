/**
 * Development fixtures: two tenants with overlapping data.
 *
 * Two tenants is the minimum needed to prove isolation — with one, every query
 * looks correctly scoped whether or not it is. These fixtures back the
 * cross-tenant tests that Phase 3 turns into a gate.
 *
 * REFUSES to run against anything but a local database. Passing --force is not
 * an option on purpose: there is no legitimate reason to write fixtures into a
 * shared or production cluster.
 *
 * Usage:
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *     node scripts/seed-dev-fixtures.mjs
 *
 * Every account's password is "Password123!dev".
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { FIXTURE_PASSWORD, TOTP_SECRET } from "./lib/fixture-secrets.mjs";

dotenv.config();

// Kept in scripts/lib/fixture-secrets.mjs rather than here, because this file
// runs main() on import — anything importing a constant from it would seed a
// database as a side effect.
const PASSWORD = FIXTURE_PASSWORD;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "mongo"];

function assertLocal(uri) {
  let host;
  try {
    // mongodb[+srv]://[user:pass@]host[:port][,host2][/db][?opts] -> first host
    const afterScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
    const authority = afterScheme.split("/")[0].split("?")[0];
    const hostPart = authority.includes("@")
      ? authority.slice(authority.lastIndexOf("@") + 1)
      : authority;
    host = hostPart.split(",")[0].replace(/:\d+$/, "");
  } catch {
    host = "";
  }
  if (!LOCAL_HOSTS.includes(host)) {
    console.error(
      `Refusing to seed fixtures into "${host}". This script only runs against a local database.`
    );
    console.error(
      'Start one with:\n  docker run -d --name cdchr-mongo -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all'
    );
    process.exit(1);
  }
}

const oid = () => new mongoose.Types.ObjectId();

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set.");
    process.exit(1);
  }
  assertLocal(uri);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  console.log(`Seeding fixtures into ${db.databaseName}\n`);

  // Start from a known state so repeated runs are deterministic.
  for (const name of [
    "companies",
    "officeemployes",
    "platformusers",
    "roletypes",
    "weeklyrotas",
    "leaverequests",
    "loginattempts",
    "usersessions",
    "twofas",
    "rolebaseds",
    "projectsites",
  ]) {
    await db.collection(name).deleteMany({});
  }

  const password = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();
  const endDate = new Date(now.getFullYear() + 5, 0, 1);

  // Departments are shared today (no tenant field) — one per tenant here so
  // Phase 2's backfill has something realistic to attribute.
  const tenantA = oid();
  const tenantB = oid();
  const deptA = oid();
  const deptB = oid();
  await db.collection("roletypes").insertMany([
    { _id: deptA, roleTitle: "Operations", tenantId: tenantA, isActive: true, delete: false, createdAt: now, updatedAt: now },
    { _id: deptB, roleTitle: "Engineering", tenantId: tenantB, isActive: true, delete: false, createdAt: now, updatedAt: now },
  ]);

  const tenants = [
    {
      _id: tenantA,
      name: "Acme Ltd",
      description: "Fixture tenant A",
      slug: "acme",
      status: "active",
      domains: [
        {
          host: "acme.localtest.me",
          isPrimary: true,
          verified: true,
          verificationToken: "fixture-a",
          verifiedAt: now,
          sslStatus: "issued",
          addedAt: now,
        },
      ],
      branding: { appName: "Acme People", primaryColor: "oklch(0.55 0.21 258)" },
      features: {},
      limits: {},
      locale: {},
      billing: { plan: "standard" },
      isActive: true,
      delete: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: tenantB,
      name: "Beta Corp",
      description: "Fixture tenant B",
      slug: "beta",
      status: "active",
      domains: [
        {
          host: "beta.localtest.me",
          isPrimary: true,
          verified: true,
          verificationToken: "fixture-b",
          verifiedAt: now,
          sslStatus: "issued",
          addedAt: now,
        },
        // Deliberately unverified: must NOT resolve.
        {
          host: "unverified.localtest.me",
          isPrimary: false,
          verified: false,
          verificationToken: "fixture-b-unverified",
          sslStatus: "pending",
          addedAt: now,
        },
      ],
      branding: { appName: "Beta HR", primaryColor: "oklch(0.6 0.18 145)" },
      features: {},
      limits: {},
      locale: {},
      billing: { plan: "trial" },
      isActive: true,
      delete: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
  await db.collection("companies").insertMany(tenants);

  const employee = (tenant, dept, name, email, flags = {}) => ({
    _id: oid(),
    name,
    email,
    phoneNumber: 7700900000,
    password,
    roleType: "Staff",
    department: dept,
    company: tenant,
    // Both fields on purpose: `company` is the legacy reference the app has
    // always had, `tenantId` is what the tenant plugin filters on. Setting it
    // here keeps fixtures self-contained instead of depending on a backfill run.
    tenantId: tenant,
    immigrationType: "British",
    employeType: "Full Time",
    joinDate: new Date(2024, 0, 1),
    endDate,
    isActive: true,
    isAdmin: !!flags.admin,
    isSuperAdmin: !!flags.superAdmin,
    delete: false,
    createdAt: now,
    updatedAt: now,
  });

  const employees = [
    employee(tenantA, deptA, "Ava Acme", "super@acme.test", { superAdmin: true }),
    employee(tenantA, deptA, "Alan Acme", "admin@acme.test", { admin: true }),
    employee(tenantA, deptA, "Amy Acme", "user@acme.test"),
    employee(tenantB, deptB, "Ben Beta", "super@beta.test", { superAdmin: true }),
    employee(tenantB, deptB, "Bea Beta", "admin@beta.test", { admin: true }),
    // No company set — represents the records Phase 2's backfill must claim.
    { ...employee(null, deptA, "Orphan Olive", "orphan@nowhere.test"), company: null },
  ];
  await db.collection("officeemployes").insertMany(employees);

  const platformUser = {
    _id: oid(),
    name: "Platform Ops",
    email: "ops@platform.test",
    password,
    isActive: true,
    delete: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection("platformusers").insertOne(platformUser);

  // A little tenant-owned data, so Phase 2 scoping has something to prove.
  const weekStart = new Date(2026, 7, 24);
  await db.collection("weeklyrotas").insertMany([
    {
      weekStartDate: weekStart,
      attendanceData: [
        { employeeId: employees[0]._id, employeeName: "Ava Acme", schedule: [] },
      ],
      approvedStatus: "Approved",
      status: "Active",
      version: 1,
      isDeleted: false,
      tenantId: tenantA,
      createdAt: now,
      updatedAt: now,
    },
    {
      weekStartDate: weekStart,
      attendanceData: [
        { employeeId: employees[3]._id, employeeName: "Ben Beta", schedule: [] },
      ],
      approvedStatus: "Approved",
      status: "Active",
      version: 1,
      isDeleted: false,
      tenantId: tenantB,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // --- Permission grants -------------------------------------------------
  // An `admin` reaches a page through their role's permission list, not their
  // role name — proxy.js and every server-side guard check the same list. With
  // no RoleBased row an admin fixture is refused everywhere, which makes them
  // useless for testing anything an admin is supposed to be able to do.
  const ADMIN_PAGES = [
    "/admin/dashboard",
    "/admin/expense",
    "/admin/announcements",
    "/admin/officeEmployee",
    "/admin/siteAssign",
  ];
  await db.collection("rolebaseds").insertMany([
    {
      _id: oid(),
      name: "Fixture admin",
      employeeId: employees[1]._id, // admin@acme.test
      permissions: ADMIN_PAGES,
      isActive: true,
      isDeleted: false,
      tenantId: tenantA,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      name: "Fixture admin",
      employeeId: employees[4]._id, // admin@beta.test
      permissions: ADMIN_PAGES,
      isActive: true,
      isDeleted: false,
      tenantId: tenantB,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // --- Sites -------------------------------------------------------------
  // One per tenant. `siteDelete` and `isActive` are not decoration: the site
  // dropdown queries on both, so a row without them exists but can never be
  // chosen — which is how the expense filters ended up with an empty site list.
  const siteA = oid();
  const siteB = oid();
  await db.collection("projectsites").insertMany([
    {
      _id: siteA,
      siteName: "Acme Yard",
      siteType: "site",
      siteDelete: false,
      isActive: true,
      tenantId: tenantA,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: siteB,
      siteName: "Beta Yard",
      siteType: "site",
      siteDelete: false,
      isActive: true,
      tenantId: tenantB,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // --- Two-factor --------------------------------------------------------
  // auth.js forces every admin, super admin and platform admin through 2FA: if
  // it is not yet enabled they are pinned to /setup-2fa, and no fixture account
  // could reach the app at all. Enabling it with a *known* secret means a test
  // can generate a real TOTP code and pass the real challenge, rather than the
  // gate being weakened to let tests through.
  //
  // TOTP_SECRET is a fixture value and must never be used anywhere else.
  // Platform Ops is in this list too. Their role forces 2FA, so without a
  // seeded secret every platform-console test stalls on the enrolment screen
  // rather than reaching the thing it means to exercise.
  await db.collection("twofas").insertMany(
    [employees[0], employees[1], employees[3], employees[4], platformUser].map((e) => ({
      _id: oid(),
      employeeId: e._id,
      secret: TOTP_SECRET,
      isEnabled: true,
      isVerified: true,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    }))
  );

  console.log("Tenants");
  for (const t of tenants) {
    console.log(`  ${t.name.padEnd(10)} slug=${t.slug.padEnd(6)} ${t.domains.map((d) => `${d.host}${d.verified ? "" : " (unverified)"}`).join(", ")}`);
  }
  console.log("\nAccounts (password: " + PASSWORD + ")");
  for (const e of employees) {
    const role = e.isSuperAdmin ? "superAdmin" : e.isAdmin ? "admin" : "user";
    console.log(`  ${e.email.padEnd(24)} ${role.padEnd(11)} company=${e.company ? String(e.company) : "(none)"}`);
  }
  console.log(`  ${"ops@platform.test".padEnd(24)} platformAdmin`);

  console.log("\nTenant ids");
  console.log(`  Acme Ltd  ${tenantA}`);
  console.log(`  Beta Corp ${tenantB}`);

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch(async (error) => {
  console.error("Fixture seed failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
