/**
 * Rota categories with rules (lib/rotaCategories.js).
 *
 * What has to hold:
 *
 *   - THE POINT: what a category means — off, working, working at a place —
 *     is its rule, not its name, so a company can call it what it likes;
 *   - categories made before rules existed still mean what they meant;
 *   - a new company starts with the usual set in its own words ("Office /
 *     Class" for a tuition centre);
 *   - adding, renaming, re-ruling and removing them; a category's key never
 *     changes, so saved rotas keep pointing at it; "the usual set" only adds
 *     what is missing;
 *   - saving a rota writes each day's rule and name onto it, and a day off
 *     loses its hours and place whatever the form sent;
 *   - only whoever may edit the rota may change them.
 *
 * Needs a LOCAL replica-set database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_rota_cats?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-rota-categories.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();
process.env.EMAIL_HOST = "";
process.env.EMAIL_USERNAME = "";
process.env.EMAIL_PASSWORD = "";

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
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

  const { entryKind, describeEntry, starterRotaCategories } = await import("@/lib/rotaCategories");
  const { createCompanyForCustomer } = await import("@/server/tenantServer/provisionServer");
  const cats = await import("@/server/weeklyRotaServer/rotaCategoryServer");
  const { getSelectAttendanceCategory } = await import("@/server/selectServer/selectServer");
  const { handleWeeklyRotaWithStatus } = await import("@/server/weeklyRotaServer/weeklyRotaServer");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const { loadPricing } = await import("@/server/billingServer/pricingStore");
  await loadPricing();

  /* -------------------------------------------------------------- pure */

  await check("the rule, not the name, says what a day means", () => {
    assert.equal(entryKind({ category: "TEACHING", kind: "place" }), "place");
    // Saved before rules: the old fixed words still mean what they meant.
    assert.equal(entryKind({ category: "OFF" }), "off");
    assert.equal(entryKind({ category: "Holiday" }), "off");
    assert.equal(entryKind({ category: "OFFICE/SITE" }), "place");
    assert.equal(entryKind({ category: "OFFICE" }), "work");
    assert.equal(entryKind({ attendanceCategoryValue: "OFF" }), "off");
    assert.equal(entryKind({}), null);
    assert.equal(
      describeEntry({ category: "T", kind: "place", label: "Teaching", site: "GCSE English", startTime: "16:00", endTime: "18:00" }),
      "Teaching - GCSE English (16:00–18:00)"
    );
    assert.equal(describeEntry({ category: "OFF", startTime: "00:00", endTime: "00:00" }), "Off");
  });

  await check("the usual set speaks each industry's words", () => {
    assert.deepEqual(starterRotaCategories({ site: "Class" }).map((c) => c.name), ["Office", "Office / Class", "Off"]);
    assert.deepEqual(starterRotaCategories({ site: "Branch" }).map((c) => c.kind), ["work", "place", "off"]);
  });

  /* ------------------------------------------------- a new company has them */

  actAs({ _id: "000000000000000000000001", name: "Pat", email: "pat@platform.test", role: "platformAdmin" });
  const res = await createCompanyForCustomer({
    companyName: "Bright Minds",
    slug: "bright-minds",
    industry: "tuition",
    start: "trial",
    ownerMode: "new",
    owner: { name: "Bea", email: "bea@bright.test", phone: "07700900111", password: "Bright-pass-1" },
  });
  const company = await db.collection("companies").findOne({ slug: "bright-minds" });
  const owner = await db.collection("officeemployes").findOne({ tenantId: company?._id });
  const tenantId = String(company?._id);
  const asOwner = () =>
    actAs({ _id: String(owner._id), name: owner.name, email: owner.email, role: "superAdmin", tenantId });

  await check("a new company starts with the usual set, in its words", async () => {
    assert.equal(res.success, true, res.message);
    const rows = await db.collection("attendancecategories").find({ tenantId: company._id }).sort({ sortOrder: 1 }).toArray();
    assert.deepEqual(rows.map((r) => r.attendanceCategoryName), ["Office", "Office / Class", "Off"]);
    assert.deepEqual(rows.map((r) => r.attendanceCategoryValue), ["OFFICE", "OFFICE/SITE", "OFF"]);
    asOwner();
    const select = await runWithTenant(tenantId, () => getSelectAttendanceCategory());
    assert.equal(select.success, true, select.message);
    const list = JSON.parse(select.data);
    assert.deepEqual(list.map((c) => c.kind), ["work", "place", "off"]);
    assert.equal(list[0].startTime, "09:00");
  });

  /* ---------------------------------------------------------- managing */

  await check("add one, with its own rule and hours", async () => {
    asOwner();
    const r = await runWithTenant(tenantId, () =>
      cats.saveRotaCategory({ name: "Teaching a class", kind: "place", startTime: "16:00", endTime: "18:00" })
    );
    assert.equal(r.success, true, r.message);
    const row = await db.collection("attendancecategories").findOne({ tenantId: company._id, attendanceCategoryName: "Teaching a class" });
    assert.equal(row.kind, "place");
    assert.equal(row.attendanceCategoryValue, "TEACHING A CLASS");
    const dup = await runWithTenant(tenantId, () => cats.saveRotaCategory({ name: "teaching a class", kind: "work" }));
    assert.equal(dup.success, false, "same name twice");
    const bad = await runWithTenant(tenantId, () =>
      cats.saveRotaCategory({ name: "Night", kind: "work", startTime: "22:00", endTime: "06:00" })
    );
    assert.match(bad.message, /start must be before/);
    const noKind = await runWithTenant(tenantId, () => cats.saveRotaCategory({ name: "Thing", kind: "maybe" }));
    assert.equal(noKind.success, false);
  });

  await check("rename and re-rule it — its key stays, and an off has no hours", async () => {
    asOwner();
    const row = await db.collection("attendancecategories").findOne({ tenantId: company._id, attendanceCategoryName: "Teaching a class" });
    const r = await runWithTenant(tenantId, () =>
      cats.saveRotaCategory({ id: String(row._id), name: "Cover lesson", kind: "off", startTime: "16:00", endTime: "18:00" })
    );
    assert.equal(r.success, true, r.message);
    const after = await db.collection("attendancecategories").findOne({ _id: row._id });
    assert.equal(after.attendanceCategoryName, "Cover lesson");
    assert.equal(after.attendanceCategoryValue, "TEACHING A CLASS", "the key never changes");
    assert.equal(after.kind, "off");
    assert.equal(after.startTime, undefined);
    // Put it back for the rota test below.
    await runWithTenant(tenantId, () =>
      cats.saveRotaCategory({ id: String(row._id), name: "Teaching a class", kind: "place", startTime: "16:00", endTime: "18:00" })
    );
  });

  await check("the usual set only adds what is missing", async () => {
    asOwner();
    const off = await db.collection("attendancecategories").findOne({ tenantId: company._id, attendanceCategoryValue: "OFF" });
    await runWithTenant(tenantId, () => cats.removeRotaCategory(String(off._id)));
    let r = await runWithTenant(tenantId, () => cats.addStarterRotaCategories());
    assert.match(r.message, /1 shift type added/);
    r = await runWithTenant(tenantId, () => cats.addStarterRotaCategories());
    assert.match(r.message, /all already/);
    assert.equal(
      await db.collection("attendancecategories").countDocuments({ tenantId: company._id, isDeleted: false }),
      4
    );
  });

  await check("only whoever may edit the rota may change them", async () => {
    actAs({ _id: "000000000000000000000009", role: "user", tenantId, email: "x@bright.test" });
    const r = await runWithTenant(tenantId, () => cats.saveRotaCategory({ name: "Sneaky", kind: "work" }));
    assert.equal(r.success, false);
    const list = await runWithTenant(tenantId, () => cats.getRotaCategories());
    assert.equal(list.success, false);
  });

  /* ------------------------------------------------------------ the rota */

  await check("a saved rota carries each day's rule and name; a day off loses its hours", async () => {
    asOwner();
    const monday = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7);
      return d.toISOString().slice(0, 10);
    })();
    const r = await runWithTenant(tenantId, () =>
      handleWeeklyRotaWithStatus(
        [
          {
            employeeId: String(owner._id),
            employeeName: owner.name,
            schedule: [
              { date: monday, day: "Mon", category: "TEACHING A CLASS", site: "GCSE English", startTime: "16:00", endTime: "18:00" },
              { date: monday, day: "Tue", category: "OFF", site: "GCSE English", startTime: "09:00", endTime: "17:00" },
              { date: monday, day: "Wed", category: "OFFICE", site: "Somewhere", startTime: "09:00", endTime: "17:00" },
            ],
          },
        ],
        monday
      )
    );
    assert.equal(r.success, true, r.message);
    const rota = await db.collection("weeklyrotas").findOne({ tenantId: company._id });
    const [mon, tue, wed] = rota.attendanceData[0].schedule;
    assert.equal(mon.kind, "place");
    assert.equal(mon.label, "Teaching a class");
    assert.equal(mon.site, "GCSE English");
    assert.equal(tue.kind, "off");
    assert.equal(tue.label, "Off");
    assert.equal(tue.startTime, "00:00");
    assert.equal(tue.site, undefined);
    assert.equal(wed.kind, "work");
    assert.equal(wed.site, undefined, "an office day has no place");
  });

  await mongoose.disconnect();
  for (const [s, n] of results) console.log(`${s === "pass" ? "✓" : "✗"} ${n}`);
  const failed = results.filter(([s]) => s !== "pass").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
