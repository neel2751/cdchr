/**
 * A place manager's own page, and what a company lets its managers do.
 *
 * getMySites() shows a class teacher the classes they run: who belongs, who is
 * in today, a count by year, and medical notes. What has to hold:
 *
 *   - only the places the caller manages;
 *   - medical notes shown, contact details hidden unless the company allows
 *     them — a teacher needs the nut allergy, not every parent's mobile;
 *   - a company can stop managers assigning people (tuition does by default),
 *     and every assignment action honours it, while a builder's managers keep
 *     assigning as they always have.
 *
 * Needs a LOCAL replica-set database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_mysites?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-my-sites.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();

const results = [];
let withTenant = (fn) => fn();

function check(name, fn) {
  return Promise.resolve()
    .then(() => withTenant(fn))
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.db.dropDatabase();
  const db = mongoose.connection.db;

  const { runWithTenant } = await import("@/lib/tenantContext");
  const { getWorkingDate } = await import("@/lib/clockTime");
  const { getMySites, getMySiteRights } = await import(
    "@/server/siteAssignmentServer/mySitesServer"
  );
  const { assignOngoing } = await import(
    "@/server/siteAssignmentServer/standingAssignmentServer"
  );
  const { assignEmployeesToSite } = await import(
    "@/server/siteAssignmentServer/siteAssignmentServer"
  );
  const { applyManagerRules } = await import("@/server/tenantServer/tenantOps");

  const oid = () => new mongoose.Types.ObjectId();
  const today = getWorkingDate();
  const notToday = (today.getUTCDay() + 1) % 7;

  /** A company with one manager running site A, and a site B they do not. */
  async function company(industry) {
    const tenantId = oid();
    const ids = {
      tenantId,
      siteA: oid(),
      siteB: oid(),
      manager: oid(),
      ada: oid(),
      ben: oid(),
      cy: oid(),
      newcomer: oid(),
    };
    const T = (docs) => docs.map((d) => ({ tenantId, ...d }));
    await db.collection("companies").insertOne({
      _id: tenantId,
      name: `${industry} co`,
      industry,
      isActive: true,
      delete: false,
      status: "active",
    });
    await db.collection("projectsites").insertMany(
      T([
        { _id: ids.siteA, siteName: "Year 9 Maths", isActive: true, siteDelete: false },
        { _id: ids.siteB, siteName: "Year 10 English", isActive: true, siteDelete: false },
      ]),
    );
    await db.collection("employes").insertMany(
      T([
        {
          _id: ids.ada,
          firstName: "Ada",
          lastName: "L",
          yearGroup: "Year 9",
          medicalNotes: "Nut allergy",
          guardianName: "Anne",
          guardianPhone: "07700900111",
          phone: 7700900222,
        },
        { _id: ids.ben, firstName: "Ben", lastName: "M", yearGroup: "Year 9" },
        { _id: ids.cy, firstName: "Cy", lastName: "N", yearGroup: "Year 10" },
        { _id: ids.newcomer, firstName: "Nia", lastName: "O" },
      ]),
    );
    await db.collection("rolebaseds").insertOne({
      tenantId,
      name: "Teacher",
      employeeId: ids.manager,
      isActive: true,
      isDeleted: false,
      permissions: ["/admin/siteAssignEmployee"],
    });
    await db.collection("assignprojects").insertOne({
      tenantId,
      loginSiteId: "t",
      roleId: ids.manager,
      projectSiteID: ids.siteA,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: null,
      isActive: true,
      isDelete: false,
    });
    await db.collection("standingassignments").insertMany(
      T([
        { siteId: ids.siteA, employeeId: ids.ada, startDate: today, endDate: null, days: [], isDeleted: false },
        { siteId: ids.siteA, employeeId: ids.ben, startDate: today, endDate: null, days: [notToday], isDeleted: false },
        { siteId: ids.siteB, employeeId: ids.cy, startDate: today, endDate: null, days: [], isDeleted: false },
      ]),
    );
    await db.collection("clockrecords").insertOne({
      tenantId,
      employeeId: ids.ada,
      siteId: ids.siteA,
      locationId: oid(),
      date: today,
      clockIn: "08:45",
      isDeleted: false,
    });
    return ids;
  }

  const school = await company("tuition");
  const builder = await company("construction");

  const as = (c, id, role) => {
    withTenant = (fn) => runWithTenant(String(c.tenantId), fn);
    actAs({ _id: String(id), role, tenantId: String(c.tenantId) });
  };
  const load = async () => JSON.parse((await getMySites()).data);

  /* ------------------------------------------------------------- the page */

  as(school, school.manager, "user");
  await check("THE POINT: a teacher sees only their own class", async () => {
    const page = await load();
    assert.deepEqual(page.sites.map((s) => s.siteName), ["Year 9 Maths"]);
  });

  as(school, school.manager, "user");
  await check("who is on the books, due today and in", async () => {
    const [site] = (await load()).sites;
    assert.equal(site.headcount, 2);
    assert.equal(site.expectedToday, 1, "Ben is not due today");
    assert.equal(site.inNow, 1);
    const ada = site.people.find((p) => p.name === "Ada L");
    const ben = site.people.find((p) => p.name === "Ben M");
    assert.equal(ada.status, "In");
    assert.equal(ada.clockIn, "08:45");
    assert.equal(ben.status, "Not due today");
  });

  as(school, school.manager, "user");
  await check("counted by year, in a tuition centre", async () => {
    const page = await load();
    assert.equal(page.breakdownLabel, "Year / Grade");
    assert.deepEqual(page.sites[0].breakdown, [{ label: "Year 9", count: 2 }]);
  });

  as(school, school.manager, "user");
  await check("medical notes shown, contact details hidden by default", async () => {
    const page = await load();
    const ada = page.sites[0].people.find((p) => p.name === "Ada L");
    assert.equal(ada.medicalNotes, "Nut allergy");
    assert.equal(ada.contacts, undefined);
    assert.equal(page.showContacts, false);
    assert.ok(!JSON.stringify(page).includes("07700900111"), "a guardian's phone leaked");
  });

  await check("contact details appear once the company allows them", async () => {
    await applyManagerRules(String(school.tenantId), {
      managerRules: { seeContacts: true },
    });
    as(school, school.manager, "user");
    const page = await load();
    const ada = page.sites[0].people.find((p) => p.name === "Ada L");
    assert.equal(ada.contacts.guardianPhone, "07700900111");
    await applyManagerRules(String(school.tenantId), {
      managerRules: { seeContacts: false },
    });
  });

  as(school, school.manager, "siteEmployee");
  await check("a student cannot open the page", async () => {
    const res = await getMySites();
    assert.equal(res.success, false);
  });

  /* -------------------------------------------------- who may assign people */

  as(school, school.manager, "user");
  await check("a tuition centre's teachers do not assign by default", async () => {
    const rights = JSON.parse((await getMySiteRights()).data);
    assert.equal(rights.canAssign, false);
    const res = await assignOngoing({
      siteId: String(school.siteA),
      employee: [String(school.newcomer)],
      startDate: today.toISOString().slice(0, 10),
    });
    assert.equal(res.success, false);
    assert.match(res.message, /does not let/i);
    assert.match(res.message, /class teachers/i, "refused in the company's words");
  });

  as(school, school.manager, "user");
  await check("…nor by the day", async () => {
    const res = await assignEmployeesToSite({
      siteId: String(school.siteA),
      employee: [String(school.newcomer)],
      assignDate: today,
    });
    assert.equal(res.success, false);
    assert.match(res.message, /does not let/i);
  });

  await check("…until the company switches it on", async () => {
    await applyManagerRules(String(school.tenantId), {
      managerRules: { canAssign: true },
    });
    as(school, school.manager, "user");
    const res = await assignOngoing({
      siteId: String(school.siteA),
      employee: [String(school.newcomer)],
      startDate: today.toISOString().slice(0, 10),
    });
    assert.equal(res.success, true, res.message);
  });

  as(school, oid(), "superAdmin");
  await check("an administrator always can", async () => {
    const rights = JSON.parse((await getMySiteRights()).data);
    assert.equal(rights.canAssign, true);
  });

  as(builder, builder.manager, "user");
  await check("REGRESSION: a builder's site manager still assigns as before", async () => {
    const rights = JSON.parse((await getMySiteRights()).data);
    assert.equal(rights.canAssign, true);
    const res = await assignEmployeesToSite({
      siteId: String(builder.siteA),
      employee: [String(builder.newcomer)],
      assignDate: today,
    });
    assert.equal(res.success, true, res.message);
  });

  as(builder, builder.manager, "user");
  await check("a builder's page counts by role, without a year column", async () => {
    const page = await load();
    assert.equal(page.breakdownLabel, "Employee Role");
    assert.equal(page.showMedical, false, "construction does not record medical notes");
  });

  await db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s === "FAIL");
  for (const [status, name] of results) {
    console.log(`  ${status === "pass" ? "ok  " : status}  ${name}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` — ${failed.length} FAILED` : ""),
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
