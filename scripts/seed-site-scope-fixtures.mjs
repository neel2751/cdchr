/**
 * Site manager fixtures, added on top of seed-dev-fixtures.mjs.
 *
 * The dev fixtures have one site per company and no site manager, which is not
 * enough to see the site access rule (lib/siteAccess.js) do anything. This adds
 * to Acme Ltd:
 *
 *   Acme Yard and Acme Depot, with one site worker each, assigned and clocked
 *   in today;
 *   manager@acme.test, an ordinary "user" with the site board and the
 *   attendance report, managing Acme Yard only.
 *
 * Signed in as the manager, the board, the site picker, the report and the
 * export should show Acme Yard and never Acme Depot. Signed in as
 * super@acme.test, both.
 *
 * Adds and updates by name and email, so it can be run again. Deletes nothing.
 * REFUSES anything but a local database, like the seeder it builds on.
 *
 * Usage:
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0&directConnection=true" \
 *     node scripts/seed-site-scope-fixtures.mjs
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { FIXTURE_PASSWORD } from "./lib/fixture-secrets.mjs";

dotenv.config();

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "mongo"];

function assertLocal(uri) {
  const afterScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const authority = afterScheme.split("/")[0].split("?")[0];
  const hostPart = authority.includes("@")
    ? authority.slice(authority.lastIndexOf("@") + 1)
    : authority;
  const host = hostPart.split(",")[0].replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.includes(host)) {
    console.error(`Refusing to seed "${host}". Local databases only.`);
    process.exit(1);
  }
}

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

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set.");
    process.exit(1);
  }
  assertLocal(uri);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  const company = await db.collection("companies").findOne({ slug: "acme" });
  if (!company) {
    console.error("No Acme Ltd here. Run scripts/seed-dev-fixtures.mjs first.");
    process.exit(1);
  }
  const tenantId = company._id;
  const now = new Date();
  const today = ukToday();
  const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const password = await bcrypt.hash(FIXTURE_PASSWORD, 10);

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

  const site = (siteName) =>
    upsert("projectsites", { siteName }, {
      siteName,
      siteType: "Residential",
      status: "Active",
      siteDelete: false,
      isActive: true,
      startDate: lastMonth,
      endDate: new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000),
    });
  const yard = await site("Acme Yard");
  const depot = await site("Acme Depot");

  const anyStaff = await db
    .collection("officeemployes")
    .findOne({ tenantId, email: "user@acme.test" });

  const manager = await upsert(
    "officeemployes",
    { email: "manager@acme.test" },
    {
      name: "Mona Manager",
      email: "manager@acme.test",
      phoneNumber: 7700900123,
      password,
      roleType: "Staff",
      department: anyStaff?.department,
      company: tenantId,
      immigrationType: "British",
      employType: "Full Time",
      employeType: "Full Time",
      joinDate: new Date(2024, 0, 1),
      isActive: true,
      isAdmin: false,
      isSuperAdmin: false,
      delete: false,
    },
  );

  await upsert(
    "rolebaseds",
    { employeeId: manager._id },
    {
      name: "Site manager",
      employeeId: manager._id,
      permissions: [
        "/admin/dashboard",
        "/admin/siteAssignEmployee",
        "/admin/filterAttendance",
      ],
      isActive: true,
      isDeleted: false,
    },
  );

  await upsert(
    "assignprojects",
    { roleId: manager._id, projectSiteID: yard._id },
    {
      loginSiteId: `fixture-${manager._id}`,
      roleId: manager._id,
      projectSiteID: yard._id,
      startDate: lastMonth,
      endDate: null,
      isActive: true,
      isDelete: false,
    },
  );

  const worker = (firstName, lastName, email) =>
    upsert("employes", { email }, {
      firstName,
      lastName,
      email,
      password,
      phone: 7700900456,
      paymentType: "Daily",
      payRate: 150,
      employeType: "Full Time",
      startDate: lastMonth,
      isActive: true,
      delete: false,
    });
  const sam = await worker("Sam", "Yard", "sam.yard@acme.test");
  const dee = await worker("Dee", "Depot", "dee.depot@acme.test");

  for (const [siteDoc, person] of [
    [yard, sam],
    [depot, dee],
  ]) {
    await upsert(
      "siteassignments",
      { siteId: siteDoc._id, assignDate: today },
      {
        siteId: siteDoc._id,
        assignDate: today,
        assignedEmployees: [
          { employeeId: person._id, assignedAt: now, isLocked: true },
        ],
      },
    );
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

  console.log("Acme Ltd site-scope fixtures (password: " + FIXTURE_PASSWORD + ")");
  console.log("  manager@acme.test   manages Acme Yard only (no 2FA)");
  console.log("  Acme Yard           Sam Yard, clocked in 08:00 today");
  console.log("  Acme Depot          Dee Depot, clocked in 08:00 today");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
