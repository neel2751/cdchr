/**
 * Choosing an industry at signup, and the setup checklist.
 *
 * What has to hold:
 *
 *   - signup refuses to start without a known industry, and the company it
 *     creates carries that industry and the modules that suit it — a tuition
 *     centre is not handed a device inventory it did not ask for;
 *   - the checklist ticks a step from the company's own data (a site exists,
 *     so "add your sites" is done), lets a review step be ticked and an
 *     optional one skipped, and refuses either for a step the data decides;
 *   - a step for a module the company does not have is not on the list;
 *   - only the company's super admin sees or changes it.
 *
 * Needs a LOCAL replica-set database — it writes, and signup uses a transaction.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_setup?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-setup-progress.mjs
 */
import assert from "node:assert";
import crypto from "node:crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();
// Signup sends a confirmation email. Never from a test.
process.env.EMAIL_HOST = "";
process.env.EMAIL_USERNAME = "";
process.env.EMAIL_PASSWORD = "";

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
  const { startSignup, completeSignup } = await import(
    "@/server/authServer/signupServer"
  );
  const { getSetupProgress, markSetupStep, setSetupChecklistHidden } =
    await import("@/server/tenantServer/setupProgressServer");

  const form = (extra = {}) => ({
    companyName: "Bright Minds Tuition",
    slug: `bright-${Date.now()}`,
    name: "Priya Patel",
    email: `owner-${Date.now()}@bright.test`,
    phoneNumber: "07700900123",
    password: "a-long-enough-password",
    ...extra,
  });

  /* ---------------------------------------------------------------- signup */

  actAs(null);
  await check("signup refuses to start without an industry", async () => {
    const res = await startSignup(form());
    assert.equal(res.success, false);
    assert.match(res.message, /type of business/i);
  });

  await check("…or with one that does not exist", async () => {
    const res = await startSignup(form({ industry: "spaceport" }));
    assert.equal(res.success, false);
  });

  await check("the chosen industry is kept on the pending signup", async () => {
    const f = form({ industry: "tuition" });
    const res = await startSignup(f);
    assert.equal(res.success, true, res.message);
    const pending = await db.collection("pendingsignups").findOne({ email: f.email });
    assert.equal(pending.industry, "tuition");
  });

  let tenantId;
  await check("THE POINT: the company is created as a tuition centre", async () => {
    const token = crypto.randomBytes(16).toString("hex");
    const f = form({ industry: "tuition" });
    await db.collection("pendingsignups").insertOne({
      companyName: f.companyName,
      slug: `bright-confirm-${Date.now()}`,
      name: f.name,
      email: `confirm-${Date.now()}@bright.test`,
      phoneNumber: 7700900123,
      industry: "tuition",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuuJw1mY3u9U7rS1o2b3c4d5e6f7g8h9i0",
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: null,
    });
    const res = await completeSignup(token);
    assert.equal(res.success, true, res.message);
    const company = await db
      .collection("companies")
      .findOne({ name: "Bright Minds Tuition", industry: "tuition" });
    assert.ok(company, "company not created with its industry");
    assert.equal(company.features.devices, false, "tuition does not get devices");
    assert.equal(company.features.siteEmployees, true);
    tenantId = company._id;
  });

  /* ------------------------------------------------------------- checklist */

  const owner = await db.collection("officeemployes").findOne({ tenantId });
  withTenant = (fn) => runWithTenant(String(tenantId), fn);
  const asOwner = () =>
    actAs({ _id: String(owner._id), role: "superAdmin", tenantId: String(tenantId) });
  const load = async () => JSON.parse((await getSetupProgress()).data);
  const step = (progress, key) => progress.steps.find((s) => s.key === key);

  asOwner();
  await check("a new company starts with its industry ticked and little else", async () => {
    const p = await load();
    assert.equal(step(p, "industry").done, true);
    assert.equal(step(p, "branding").done, false);
    assert.equal(step(p, "sites").done, false);
    assert.equal(step(p, "staff").done, false, "the owner alone is not 'staff'");
    assert.equal(p.finished, 1);
  });

  asOwner();
  await check("steps speak the company's words", async () => {
    const p = await load();
    assert.equal(step(p, "sites").title, "Add your classes");
    assert.equal(step(p, "siteEmployees").title, "Add your students");
  });

  asOwner();
  await check("a step ticks itself when the data shows it is done", async () => {
    await db.collection("projectsites").insertOne({
      tenantId,
      siteName: "Year 9 Maths",
      isActive: true,
      siteDelete: false,
    });
    const p = await load();
    assert.equal(step(p, "sites").done, true);
  });

  asOwner();
  await check("a review step can be ticked by hand", async () => {
    const res = await markSetupStep({ key: "form", mark: "done" });
    assert.equal(res.success, true, res.message);
    assert.equal(step(await load(), "form").done, true);
  });

  asOwner();
  await check("an optional step can be skipped, and the skip undone", async () => {
    await markSetupStep({ key: "nfc", mark: "skipped" });
    assert.equal(step(await load(), "nfc").skipped, true);
    await markSetupStep({ key: "nfc", mark: null });
    assert.equal(step(await load(), "nfc").skipped, false);
  });

  asOwner();
  await check("a step the data decides cannot be ticked or skipped", async () => {
    const tick = await markSetupStep({ key: "staff", mark: "done" });
    assert.equal(tick.success, false);
    const skip = await markSetupStep({ key: "leave", mark: "skipped" });
    assert.equal(skip.success, false);
  });

  asOwner();
  await check("a module the company does not have has no step", async () => {
    await db
      .collection("companies")
      .updateOne({ _id: tenantId }, { $set: { "features.siteProjects": false } });
    const keys = (await load()).steps.map((s) => s.key);
    assert.ok(!keys.includes("sites"));
    assert.ok(!keys.includes("managers"));
    await db
      .collection("companies")
      .updateOne({ _id: tenantId }, { $set: { "features.siteProjects": true } });
  });

  asOwner();
  await check("the checklist can be put away and brought back", async () => {
    await setSetupChecklistHidden(true);
    assert.equal((await load()).hidden, true);
    await setSetupChecklistHidden(false);
    assert.equal((await load()).hidden, false);
  });

  actAs({ _id: String(new mongoose.Types.ObjectId()), role: "admin", tenantId: String(tenantId) });
  await check("only the super admin sees or changes it", async () => {
    assert.equal((await getSetupProgress()).success, false);
    assert.equal((await markSetupStep({ key: "form", mark: "done" })).success, false);
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
