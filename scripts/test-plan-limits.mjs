/**
 * Limits a company can see: allowances, caps, and the choice between paying
 * for extras and stopping at the package.
 *
 * What has to hold:
 *
 *   - THE POINT: a company that chose to stop at its package cannot add the
 *     person after the allowance — by the form, or by switching a leaver
 *     back on; one that pays for extras carries on;
 *   - the platform's hard cap stops everyone, whatever they chose;
 *   - leavers and anyone switched off are not counted;
 *   - students / site workers have their own cap, said in the company's words;
 *   - storage stops at the package too, when they chose to stop;
 *   - the super admin sees usage bars, the price, a warning at 80% — and
 *     nobody else sees or changes any of it;
 *   - the setup checklist has "choose your plan".
 *
 * Needs a LOCAL replica-set database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_limits?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-plan-limits.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();
process.env.EMAIL_HOST = "";
process.env.EMAIL_USERNAME = "";
process.env.EMAIL_PASSWORD = "";
process.env.AWS_ENDPOINT_URL_S3 = "http://127.0.0.1:9";
process.env.AWS_ACCESS_ID = "test";
process.env.AWS_ACCESS_PORTAL_KEY = "test";
process.env.AWS_REGION = "eu-west-2";
process.env.AWS_BUCKET_NAME = "limits-tests-not-a-bucket";

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

  const { headroom, usageRows, DEFAULT_PLANS } = await import("@/lib/pricing");
  const { checkHeadroom } = await import("@/server/billingServer/headroom");
  const { planNotice, forgetPlanNotice } = await import("@/server/billingServer/planNotice");
  const { getMyPlan, setOverageMode } = await import("@/server/billingServer/myPlanServer");
  const { loadPricing } = await import("@/server/billingServer/pricingStore");
  const { assertStorageAllows, invalidateStorageUsage } = await import(
    "@/server/aws/storageGuard"
  );
  const { employeeStatus } = await import("@/server/employeServer/employeServer");
  const { getSetupProgress } = await import("@/server/tenantServer/setupProgressServer");
  const { runWithTenant } = await import("@/lib/tenantContext");

  /* ----------------------------------------------------------------- pure */

  await check("paying for extras: no stop at the allowance", () => {
    const r = headroom({ used: 30, cap: null, included: 25, overageMode: "charge", label: "office staff" });
    assert.equal(r.allowed, true);
  });

  await check("stopping at the package: the next one is refused", () => {
    const r = headroom({ used: 25, cap: null, included: 25, overageMode: "block", label: "office staff", planName: "Workforce" });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "package");
    assert.match(r.message, /Workforce package includes 25 office staff/);
  });

  await check("a hard cap stops everyone, and the tighter limit wins", () => {
    assert.equal(headroom({ used: 10, cap: 10, included: 25, overageMode: "charge", label: "x" }).reason, "cap");
    assert.equal(headroom({ used: 3, cap: 3, included: 25, overageMode: "block", label: "x" }).reason, "cap");
    assert.equal(headroom({ used: 9, cap: 10, included: 25, overageMode: "charge", label: "x" }).allowed, true);
  });

  await check("usage bars: near at 80%, over costs extra, full when it stops", () => {
    const plan = DEFAULT_PLANS[0]; // Essentials: 10 office, 25 workers, 5 GB
    const rows = usageRows({ plan, usage: { officeStaff: 8, workers: 30, storageGb: null } });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    assert.equal(by.officeStaff.state, "near");
    assert.equal(by.workers.state, "over");
    assert.equal(by.workers.overPence, 5 * plan.extraPence.worker);
    assert.equal(by.storageGb.state, "unknown");
    const blocked = usageRows({ plan, usage: { officeStaff: 10, workers: 0, storageGb: 0 }, overageMode: "block" });
    assert.equal(blocked[0].state, "full");
  });

  /* ------------------------------------------------------------ companies */

  const oid = () => new mongoose.Types.ObjectId();
  await loadPricing(); // writes the suggested packages

  const company = async (fields) => {
    const _id = oid();
    await db.collection("companies").insertOne({
      _id,
      isActive: true,
      delete: false,
      status: "active",
      ...fields,
    });
    return _id;
  };
  const office = (tenantId, n, extra = {}) =>
    db.collection("officeemployes").insertMany(
      Array.from({ length: n }, (_, i) => ({
        tenantId,
        email: `${String(tenantId).slice(-6)}-${i}-${Math.random()}@t.test`,
        name: `Person ${i}`,
        isActive: true,
        delete: false,
        ...extra,
      }))
    );
  const workers = (tenantId, n, extra = {}) =>
    db.collection("employes").insertMany(
      Array.from({ length: n }, (_, i) => ({
        tenantId,
        firstName: `W${i}`,
        isActive: true,
        delete: false,
        ...extra,
      }))
    );

  // Essentials (10 office), set to stop there, with 10 office staff.
  const stopper = await company({
    name: "Stop Ltd",
    billing: { plan: "essentials", overageMode: "block", planAppliedAt: new Date() },
  });
  await office(stopper, 10);
  await office(stopper, 3, { isActive: false });

  // Same, paying for extras.
  const payer = await company({ name: "Pay Ltd", billing: { plan: "essentials" } });
  await office(payer, 10);

  // A tuition centre, Essentials (25 students), stopping, with 25 students
  // and one who left.
  const school = await company({
    name: "Tutor Co",
    industry: "tuition",
    billing: { plan: "essentials", overageMode: "block" },
  });
  await workers(school, 25);
  const [leaver] = Object.values(
    (await workers(school, 1, { isActive: false })).insertedIds
  );

  // A hard cap of 2, paying for extras otherwise.
  const capped = await company({ name: "Cap Ltd", limits: { maxEmployees: 2 } });
  await office(capped, 2);

  await check("THE POINT: stopping at the package refuses the eleventh", async () => {
    const r = await checkHeadroom(stopper, "officeStaff");
    assert.equal(r.allowed, false);
    assert.match(r.message, /Essentials package includes 10 office staff/);
  });

  await check("leavers are not counted against the allowance", async () => {
    // 9 current, plus 2 switched off and 2 deleted: counting them would make
    // 13, over the 10 included. Counting current people, the tenth fits.
    const roomy = await company({
      name: "Roomy Ltd",
      billing: { plan: "essentials", overageMode: "block" },
    });
    await office(roomy, 9);
    await office(roomy, 2, { isActive: false });
    await office(roomy, 2, { delete: true });
    assert.equal((await checkHeadroom(roomy, "officeStaff")).allowed, true);
  });

  await check("paying for extras: the eleventh is taken on", async () => {
    assert.equal((await checkHeadroom(payer, "officeStaff")).allowed, true);
  });

  await check("a hard cap stops a company that pays for extras", async () => {
    const r = await checkHeadroom(capped, "officeStaff");
    assert.equal(r.allowed, false);
    assert.match(r.message, /licensed for 2/);
  });

  await check("students have their own allowance, in the company's words", async () => {
    const r = await checkHeadroom(school, "workers");
    assert.equal(r.allowed, false);
    assert.match(r.message, /25 students/);
    assert.equal((await checkHeadroom(school, "officeStaff")).allowed, true);
  });

  const owner = (tenantId) =>
    actAs({ _id: String(oid()), role: "superAdmin", tenantId: String(tenantId), name: "Owner" });

  owner(school);
  withTenant = (fn) => runWithTenant(String(school), fn);
  await check("THE POINT: switching a leaver back on is refused when full", async () => {
    const res = await employeeStatus({ id: String(leaver), status: false });
    assert.equal(res.success, false, "switched back on past the allowance");
    const doc = await db.collection("employes").findOne({ _id: leaver });
    assert.equal(doc.isActive, false);
  });
  withTenant = (fn) => fn();

  await check("storage stops at the package when they chose to stop", async () => {
    invalidateStorageUsage();
    const fiveGb = 5 * 1024 ** 3;
    const measure = async () => ({ bytes: fiveGb });
    const full = await assertStorageAllows(String(stopper), 1, measure);
    assert.equal(full.allowed, false);
    assert.match(full.message, /5 GB/);
    invalidateStorageUsage();
    const paying = await assertStorageAllows(String(payer), 1, measure);
    assert.equal(paying.allowed, true, "a company paying for extras is not stopped");
  });

  /* ------------------------------------------- the owner's page & warning */

  owner(stopper);
  await check("the owner sees bars, the price and the packages", async () => {
    const res = await getMyPlan();
    assert.equal(res.success, true, res.message);
    const page = JSON.parse(res.data);
    assert.equal(page.plan.name, "Essentials");
    const officeRow = page.rows.find((r) => r.key === "officeStaff");
    assert.equal(officeRow.used, 10, "leavers are not counted");
    assert.equal(officeRow.state, "full");
    assert.equal(page.quote.monthlySubtotalPence, 4900);
    assert.deepEqual(page.packages.map((p) => p.name), ["Essentials", "Workforce", "Enterprise"]);
  });

  actAs({ _id: String(oid()), role: "admin", tenantId: String(stopper) });
  await check("nobody but the super admin sees or changes it", async () => {
    assert.equal((await getMyPlan()).success, false);
    assert.equal((await setOverageMode("charge")).success, false);
  });

  await check("the owner is warned when a limit that stops them is reached", async () => {
    forgetPlanNotice();
    const notice = await planNotice(stopper);
    assert.equal(notice.tone, "danger");
    assert.match(notice.text, /10 of 10 office staff/);
    assert.equal(notice.action.href, "/admin/plan");
  });

  await check("…warned at 80%, not before", async () => {
    const near = await company({ name: "Near Ltd", billing: { plan: "essentials", overageMode: "block" } });
    await office(near, 8);
    forgetPlanNotice();
    assert.equal((await planNotice(near)).tone, "warning");
    const far = await company({ name: "Far Ltd", billing: { plan: "essentials", overageMode: "block" } });
    await office(far, 7);
    assert.equal(await planNotice(far), null);
  });

  await check("going over an allowance they pay for is not a warning", async () => {
    forgetPlanNotice();
    assert.equal(await planNotice(payer), null);
  });

  owner(stopper);
  await check("the owner can switch to paying for extras, and is let in", async () => {
    const res = await setOverageMode("charge");
    assert.equal(res.success, true, res.message);
    assert.equal((await checkHeadroom(stopper, "officeStaff")).allowed, true);
  });

  /* -------------------------------------------------------- setup step */

  const trial = await company({ name: "Trial Ltd", status: "trial" });
  await office(trial, 1);
  owner(trial);
  withTenant = (fn) => runWithTenant(String(trial), fn);
  await check("the setup checklist asks a trial company to choose a plan", async () => {
    const p = JSON.parse((await getSetupProgress()).data);
    const step = p.steps.find((s) => s.key === "plan");
    assert.ok(step, "no plan step");
    assert.equal(step.done, false);
    assert.equal(step.href, "/admin/plan");
  });

  owner(stopper);
  withTenant = (fn) => runWithTenant(String(stopper), fn);
  await check("…and a company on a package has done it", async () => {
    const p = JSON.parse((await getSetupProgress()).data);
    assert.equal(p.steps.find((s) => s.key === "plan").done, true);
  });
  withTenant = (fn) => fn();

  await db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s === "FAIL");
  for (const [status, name] of results) {
    console.log(`  ${status === "pass" ? "ok  " : status}  ${name}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` — ${failed.length} FAILED` : "")
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
