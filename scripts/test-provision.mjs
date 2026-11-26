/**
 * The platform admin creating a company — with the person who runs it — and
 * demo companies.
 *
 * What has to hold:
 *
 *   - THE POINT: "New company" makes a company somebody can sign in to: the
 *     company, its first department, a super admin, and the membership;
 *   - with the business type's words and modules, and a trial of the asked
 *     length (or paying from today);
 *   - a new owner with no password set is emailed a link; with one, they must
 *     change it at first sign-in;
 *   - an email that already has an account is refused for "someone new";
 *   - THE POINT: a company for someone who already runs one signs in with
 *     their same email and password, both companies are in their switcher,
 *     and it is not reported as a duplicate email;
 *   - it can go on the same bill, as the extra company;
 *   - only the platform admin can do any of it;
 *   - THE POINT: a demo company is view-only, never billed, and its shared
 *     login skips two-factor only while every company it reaches is a demo.
 *
 * Needs a LOCAL replica-set database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_provision?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-provision.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();
process.env.EMAIL_HOST = "";
process.env.EMAIL_USERNAME = "";
process.env.EMAIL_PASSWORD = "";
process.env.AWS_ENDPOINT_URL_S3 = "http://127.0.0.1:9";
process.env.AWS_ACCESS_ID = "test";
process.env.AWS_ACCESS_PORTAL_KEY = "test";
process.env.AWS_REGION = "eu-west-2";
process.env.AWS_BUCKET_NAME = "provision-tests-not-a-bucket";

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

const DAY = 86400000;
const PLATFORM = { _id: "000000000000000000000001", name: "Pat", email: "pat@platform.test", role: "platformAdmin" };

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.db.dropDatabase();
  const db = mongoose.connection.db;

  const { createCompanyForCustomer, findCompanyOwner } = await import(
    "@/server/tenantServer/provisionServer"
  );
  const { setTenantDemo } = await import("@/server/tenantServer/platformServer");
  const { reachesOnlyDemoCompanies } = await import("@/server/tenantServer/demoLogin");
  const { LoginData } = await import("@/server/authServer/authServer");
  const { companyAccess, describeAccess } = await import("@/lib/tenantAccess");
  const { loadPricing } = await import("@/server/billingServer/pricingStore");
  const { runSubscriptionBilling } = await import("@/server/billingServer/subscriptionBilling");
  const { invalidateCompanyAccess } = await import("@/server/tenantServer/tenantAccessState");
  await loadPricing();

  const company = (slug) => db.collection("companies").findOne({ slug });
  const people = (tenantId) => db.collection("officeemployes").find({ tenantId }).toArray();
  const memberships = (email) => db.collection("tenantmemberships").find({ email }).toArray();
  const login = (email, password) => LoginData(email, password, "test-device", "127.0.0.1");

  const base = {
    companyName: "Acme Builders",
    slug: "acme-builders",
    industry: "construction",
    start: "trial",
    trialDays: 30,
    ownerMode: "new",
    owner: { name: "Ann Owner", email: "ann@acme.test", phone: "07700 900111", password: "Starting-pass-1" },
  };

  /* ------------------------------------------------------------- who may */

  await check("only the platform admin can create a company or look someone up", async () => {
    actAs({ _id: "000000000000000000000002", role: "superAdmin", tenantId: "000000000000000000000003" });
    assert.equal((await createCompanyForCustomer(base)).success, false);
    assert.equal((await findCompanyOwner("ann@acme.test")).success, false);
    actAs(null);
    assert.equal((await createCompanyForCustomer(base)).success, false);
    assert.equal(await db.collection("companies").countDocuments(), 0);
  });

  /* ---------------------------------------------------------- a new owner */

  actAs(PLATFORM);

  await check("a company with a new owner is one somebody can sign in to", async () => {
    const res = await createCompanyForCustomer(base);
    assert.equal(res.success, true, res.message);
    const c = await company("acme-builders");
    assert.equal(c.status, "trial");
    assert.equal(c.industry, "construction");
    assert.ok(c.features && Object.keys(c.features).length, "the business type's modules");
    const days = Math.round((new Date(c.billing.trialEndsAt) - Date.now()) / DAY);
    assert.ok(days >= 29 && days <= 31, `a 30-day trial, got ${days}`);

    const [owner] = await people(c._id);
    assert.equal(owner.isSuperAdmin, true);
    assert.equal(owner.email, "ann@acme.test");
    assert.equal(owner.mustChangePassword, true, "the platform admin knows that password");
    assert.ok(await db.collection("roletypes").findOne({ tenantId: c._id, roleTitle: "Management" }));
    const [m] = await memberships("ann@acme.test");
    assert.equal(String(m.tenantId), String(c._id));
    assert.equal(m.isDefault, true);

    const signedIn = await login("ann@acme.test", "Starting-pass-1");
    assert.equal(signedIn.status, true, signedIn.message);
    assert.equal(String(signedIn.data.tenantId), String(c._id));
  });

  await check("no password set: an unknown one, and a link to choose their own", async () => {
    const res = await createCompanyForCustomer({
      ...base,
      companyName: "Olive Table",
      slug: "olive-table",
      industry: "restaurant",
      start: "active",
      owner: { name: "Ola", email: "ola@olive.test", phone: "07700900222", password: "" },
    });
    assert.equal(res.success, true, res.message);
    const data = JSON.parse(res.data);
    assert.match(data.inviteNote, /Forgot password|emailed/);
    const c = await company("olive-table");
    assert.equal(c.status, "active");
    assert.equal(c.billing?.trialEndsAt, undefined, "paying from today: no trial");
    const [owner] = await people(c._id);
    assert.equal(owner.mustChangePassword, false);
    assert.ok(owner.password && owner.password.startsWith("$2"), "hashed, never blank");
  });

  await check("refused: an email that already has an account, a taken address, a bad trial", async () => {
    let res = await createCompanyForCustomer({ ...base, slug: "acme-two" });
    assert.equal(res.success, false);
    assert.match(res.message, /already has an account/);
    res = await createCompanyForCustomer({ ...base, owner: { ...base.owner, email: "new@acme.test" } });
    assert.match(res.message, /taken/);
    res = await createCompanyForCustomer({ ...base, slug: "acme-x", trialDays: 0, owner: { ...base.owner, email: "x@acme.test" } });
    assert.match(res.message, /Trial length/);
    res = await createCompanyForCustomer({ ...base, slug: "acme-y", industry: "bakery", owner: { ...base.owner, email: "y@acme.test" } });
    assert.match(res.message, /type of business/);
    assert.equal(await db.collection("companies").countDocuments(), 2);
  });

  /* ---------------------------------------------------- an existing owner */

  await check("the platform admin sees which companies someone runs", async () => {
    const res = await findCompanyOwner("ANN@acme.test");
    assert.equal(res.success, true, res.message);
    const found = JSON.parse(res.data);
    assert.equal(found.name, "Ann Owner");
    assert.deepEqual(found.companies.map((c) => c.name), ["Acme Builders"]);
    assert.equal((await findCompanyOwner("nobody@acme.test")).success, false);
  });

  await check("another company for the same owner: same sign-in, both in the switcher", async () => {
    const acme = await company("acme-builders");
    const res = await createCompanyForCustomer({
      companyName: "Acme Builders North",
      slug: "acme-north",
      industry: "construction",
      start: "active",
      ownerMode: "existing",
      existingEmail: "ann@acme.test",
      billWithCompanyId: String(acme._id),
    });
    assert.equal(res.success, true, res.message);
    const north = await company("acme-north");
    const [owner] = await people(north._id);
    assert.equal(owner.isSuperAdmin, true);
    const original = (await people(acme._id))[0];
    assert.equal(owner.password, original.password, "the same password");
    assert.equal(owner.name, original.name);

    const rows = await memberships("ann@acme.test");
    assert.deepEqual(
      rows.map((r) => String(r.tenantId)).sort(),
      [String(acme._id), String(north._id)].sort()
    );
    assert.equal(rows.find((r) => String(r.tenantId) === String(north._id)).isDefault, false,
      "they keep landing where they always have");

    // Signing in: the password opens their records; no "duplicate email".
    await db.collection("auditlogs").deleteMany({});
    const signedIn = await login("ann@acme.test", "Starting-pass-1");
    assert.equal(signedIn.status, true, signedIn.message);
    assert.equal(String(signedIn.data.tenantId), String(acme._id));
    assert.equal(await db.collection("auditlogs").countDocuments({ action: "Auth.duplicateEmail" }), 0);
  });

  await check("on the same bill: one account, the new company is the extra one", async () => {
    const acme = await company("acme-builders");
    const north = await company("acme-north");
    assert.ok(acme.billing.accountId, "the main company has an account");
    assert.equal(String(north.billing.accountId), String(acme.billing.accountId));
    assert.equal(north.billing.extraCompany, true);
    assert.equal(acme.billing.extraCompany, false);
  });

  await check("refused: someone who runs no company, or billing with a company that is not theirs", async () => {
    let res = await createCompanyForCustomer({
      ...base, slug: "ghost-co", ownerMode: "existing", existingEmail: "ghost@acme.test",
    });
    assert.equal(res.success, false);
    const olive = await company("olive-table");
    res = await createCompanyForCustomer({
      ...base, slug: "acme-south", ownerMode: "existing", existingEmail: "ann@acme.test",
      billWithCompanyId: String(olive._id),
    });
    assert.match(res.message, /do not run that company/);
  });

  /* ---------------------------------------------------------------- demo */

  await check("a demo company is view-only, said kindly, and never billed", async () => {
    const olive = await company("olive-table");
    assert.equal((await setTenantDemo(String(olive._id), true)).success, true);
    const c = await company("olive-table");
    const access = companyAccess(c);
    assert.equal(access.level, "readOnly");
    assert.equal(access.reason, "demo");
    assert.match(describeAccess(access), /demo company/);
    // A paying company on a package would be billed — a demo is not.
    await db.collection("companies").updateOne(
      { _id: olive._id },
      { $set: { "billing.plan": "workforce", "billing.planAppliedAt": new Date() } }
    );
    const run = await runSubscriptionBilling({ force: true });
    // Not billed, and not even tried: with no seller address set, a company
    // that was due would show up as failed.
    assert.ok(!run.billed.some((b) => b.companies.includes("Olive Table")), "demo not billed");
    assert.ok(!run.failed.some((f) => f.account === "Olive Table"), "demo not even due");
    // Proof the run would have picked it up otherwise.
    await db.collection("companies").updateOne({ _id: olive._id }, { $unset: { "billing.demo": "" } });
    const again = await runSubscriptionBilling({ force: true });
    assert.ok(
      again.failed.some((f) => f.account === "Olive Table") ||
        again.billed.some((b) => b.companies.includes("Olive Table")),
      "an ordinary company in the same state is due"
    );
    await db.collection("companies").updateOne(
      { _id: olive._id },
      { $set: { "billing.demo": true }, $unset: { "billing.paidThrough": "" } }
    );
    // And a lock by hand still wins over it.
    await db.collection("companies").updateOne(
      { _id: olive._id },
      { $set: { "billing.lock": { level: "locked", message: "", at: new Date() } } }
    );
    assert.equal(companyAccess(await company("olive-table")).level, "locked");
    await db.collection("companies").updateOne({ _id: olive._id }, { $unset: { "billing.lock": "" } });
    invalidateCompanyAccess(String(olive._id));
  });

  await check("two-factor is skipped only for a login that reaches nothing but demos", async () => {
    const olive = await company("olive-table");
    const acme = await company("acme-builders");
    assert.equal(
      await reachesOnlyDemoCompanies({ tenantId: String(olive._id), email: "ola@olive.test" }),
      true
    );
    // Ann reaches two real companies.
    assert.equal(
      await reachesOnlyDemoCompanies({ tenantId: String(acme._id), email: "ann@acme.test" }),
      false
    );
    // Give the demo login a real company too: no longer skipped.
    await db.collection("tenantmemberships").insertOne({
      userId: new mongoose.Types.ObjectId(),
      email: "ola@olive.test",
      tenantId: acme._id,
      role: "admin",
      isActive: true,
    });
    assert.equal(
      await reachesOnlyDemoCompanies({ tenantId: String(olive._id), email: "ola@olive.test" }),
      false
    );
    assert.equal(await reachesOnlyDemoCompanies({ tenantId: null, email: "pat@platform.test" }), false);
  });

  await check("turning demo off makes it an ordinary company again", async () => {
    const olive = await company("olive-table");
    assert.equal((await setTenantDemo(String(olive._id), false)).success, true);
    assert.equal(companyAccess(await company("olive-table")).level, "full");
  });

  await check("sign-up still makes a company the same way (shared helper)", async () => {
    const { startSignup, completeSignup } = await import("@/server/authServer/signupServer");
    actAs(null);
    const res = await startSignup({
      companyName: "Bright Minds",
      name: "Bea",
      email: "bea@bright.test",
      slug: "bright-minds",
      phoneNumber: "07700900333",
      password: "Bright-pass-1",
      industry: "tuition",
    });
    assert.equal(res.success, true, res.message);
    // The emailed link carries the raw token; mint one we know instead.
    const crypto = await import("node:crypto");
    const token = "t".repeat(64);
    await db.collection("pendingsignups").updateOne(
      { email: "bea@bright.test" },
      { $set: { tokenHash: crypto.createHash("sha256").update(token).digest("hex") } }
    );
    const done = await completeSignup(token);
    assert.equal(done.success, true, done.message);
    const c = await company("bright-minds");
    const [owner] = await people(c._id);
    assert.equal(owner.isSuperAdmin, true);
    assert.equal(await bcrypt.compare("Bright-pass-1", owner.password), true);
    assert.equal(c.industry, "tuition");
    assert.equal((await memberships("bea@bright.test"))[0].isDefault, true);
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
