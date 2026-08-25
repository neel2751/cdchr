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

dotenv.config();

const PASSWORD = "Password123!dev";
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
  ]) {
    await db.collection(name).deleteMany({});
  }

  const password = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();
  const endDate = new Date(now.getFullYear() + 5, 0, 1);

  // Departments are shared today (no tenant field) — one per tenant here so
  // Phase 2's backfill has something realistic to attribute.
  const deptA = oid();
  const deptB = oid();
  await db.collection("roletypes").insertMany([
    { _id: deptA, roleTitle: "Operations", isActive: true, delete: false, createdAt: now, updatedAt: now },
    { _id: deptB, roleTitle: "Engineering", isActive: true, delete: false, createdAt: now, updatedAt: now },
  ]);

  const tenantA = oid();
  const tenantB = oid();
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

  await db.collection("platformusers").insertOne({
    name: "Platform Ops",
    email: "ops@platform.test",
    password,
    isActive: true,
    delete: false,
    createdAt: now,
    updatedAt: now,
  });

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
      createdAt: now,
      updatedAt: now,
    },
  ]);

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
