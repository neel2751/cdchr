/**
 * Billing accounts — a customer's companies on one bill — and spotting the
 * same business taking a second free trial.
 *
 * What has to hold:
 *
 *   - THE POINT: in an account, the main company pays the full package price
 *     and the others the extra-company price, decided by the account — and
 *     re-priced when the main company changes or a company leaves;
 *   - a company is in one account at most;
 *   - locking an account locks every company in it, and unlocking reopens them;
 *   - companies sharing an owner's login are suggested as one customer;
 *   - THE POINT: a phone number that already has a workspace gets no second
 *     free trial, and is told so by email, not on screen;
 *   - weaker signs — same work domain, same name, throwaway inbox — only flag
 *     the company for a person to check, and can be dismissed;
 *   - only the platform admin does any of it.
 *
 * Needs a LOCAL replica-set database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_accounts?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-billing-accounts.mjs
 */
import assert from "node:assert";
import crypto from "node:crypto";
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
process.env.AWS_BUCKET_NAME = "accounts-tests-not-a-bucket";

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

  const { phoneKey, nameKey, emailDomain } = await import("@/server/billingServer/trialAbuse");
  const accounts = await import("@/server/billingServer/accountServer");
  const { applyPlanToCompany } = await import("@/server/billingServer/pricingServer");
  const { loadPricing } = await import("@/server/billingServer/pricingStore");
  const { getMyPlan } = await import("@/server/billingServer/myPlanServer");
  const { dismissSignupFlags } = await import("@/server/tenantServer/platformServer");
  const { startSignup, completeSignup } = await import("@/server/authServer/signupServer");
  const { companyAccess } = await import("@/lib/tenantAccess");

  /* ----------------------------------------------------------------- pure */

  await check("one phone number however it is typed", () => {
    assert.equal(phoneKey("07700 900123"), phoneKey("+44 7700 900123"));
    assert.equal(phoneKey("123"), "", "too short to mean anything");
  });

  await check("one company name however it is written", () => {
    assert.equal(nameKey("Acme Builders Ltd."), nameKey("ACME Builders Limited"));
    assert.equal(nameKey("The Smith & Sons Group"), nameKey("Smith and Sons"));
    assert.notEqual(nameKey("Acme Builders"), nameKey("Acme Plumbers"));
    assert.equal(emailDomain("Jo@Acme.CO.UK"), "acme.co.uk");
  });

  /* ------------------------------------------------------------ accounts */

  const oid = () => new mongoose.Types.ObjectId();
  await loadPricing();
  const company = async (name, extra = {}) => {
    const _id = oid();
    await db.collection("companies").insertOne({
      _id,
      name,
      status: "active",
      isActive: true,
      delete: false,
      createdAt: new Date(),
      ...extra,
    });
    return _id;
  };
  const london = await company("CDC London");
  const leeds = await company("CDC Leeds");
  const york = await company("CDC York");
  const other = await company("Other Ltd");

  const platform = () =>
    actAs({ _id: String(oid()), role: "platformAdmin", email: "ops@test", name: "Ops" });
  const priceOf = async (id) =>
    (await db.collection("companies").findOne({ _id: id })).billing?.quotedMonthlyPence;

  platform();
  for (const id of [london, leeds]) {
    await applyPlanToCompany(String(id), { planKey: "workforce" });
  }

  await check("billed alone, every company pays the full package price", async () => {
    assert.equal(await priceOf(london), 12900);
    assert.equal(await priceOf(leeds), 12900);
  });

  let accountId;
  platform();
  await check("THE POINT: in one account, the extra company pays 25% less", async () => {
    const res = await accounts.createAccount({
      name: "Creative Design & Construction",
      companyIds: [String(london), String(leeds)],
    });
    assert.equal(res.success, true, res.message);
    accountId = res.id;
    assert.equal(await priceOf(london), 12900, "the main company");
    assert.equal(await priceOf(leeds), 9675, "the extra company");
  });

  platform();
  await check("…decided by the account when a package is applied", async () => {
    await applyPlanToCompany(String(leeds), { planKey: "workforce" });
    assert.equal(await priceOf(leeds), 9675);
  });

  platform();
  await check("moving the main company re-prices both", async () => {
    const res = await accounts.setPrimaryCompany(accountId, String(leeds));
    assert.equal(res.success, true, res.message);
    assert.equal(await priceOf(leeds), 12900);
    assert.equal(await priceOf(london), 9675);
  });

  platform();
  await check("a company is in one account at most", async () => {
    const second = await accounts.createAccount({ name: "Other", companyIds: [String(other)] });
    assert.equal(second.success, true, second.message);
    platform();
    const res = await accounts.addCompanyToAccount(second.id, String(london));
    assert.equal(res.success, false);
    assert.match(res.message, /another account/);
  });

  platform();
  await check("the account's total adds up its companies", async () => {
    await accounts.addCompanyToAccount(accountId, String(york));
    platform();
    const data = JSON.parse((await accounts.getAccount(accountId)).data);
    assert.equal(data.companies.length, 3);
    const sum = data.companies.reduce((s, c) => s + c.quote.monthlyNetPence, 0);
    assert.equal(data.total.monthlyNetPence, sum);
  });

  platform();
  await check("taking out the main company hands the place on", async () => {
    const res = await accounts.removeCompanyFromAccount(String(leeds));
    assert.equal(res.success, true, res.message);
    const acc = await db.collection("billingaccounts").findOne({ _id: new mongoose.Types.ObjectId(accountId) });
    assert.notEqual(String(acc.primaryCompanyId), String(leeds));
    assert.equal(await priceOf(leeds), 12900, "billed alone again: full price");
    assert.equal(await priceOf(london), 12900, "now the main company");
  });

  platform();
  await check("locking an account locks every company in it", async () => {
    const res = await accounts.setAccountLock(accountId, { level: "locked", message: "Invoice overdue" });
    assert.equal(res.success, true, res.message);
    for (const id of [london, york]) {
      const c = await db.collection("companies").findOne({ _id: id });
      assert.equal(companyAccess(c).level, "locked");
    }
    const outside = await db.collection("companies").findOne({ _id: leeds });
    assert.equal(companyAccess(outside).level, "full", "a company outside the account");
    platform();
    await accounts.setAccountLock(accountId, { level: null });
    const reopened = await db.collection("companies").findOne({ _id: london });
    assert.equal(companyAccess(reopened).level, "full");
  });

  await check("companies sharing an owner are suggested as one customer", async () => {
    const a = await company("Smith North");
    const b = await company("Smith South");
    const userId = oid();
    await db.collection("tenantmemberships").insertMany([
      { userId, email: "smith@smith.test", tenantId: a, role: "superAdmin", isActive: true },
      { userId, email: "smith@smith.test", tenantId: b, role: "superAdmin", isActive: true },
    ]);
    platform();
    const data = JSON.parse((await accounts.listAccounts()).data);
    const s = data.suggestions.find((g) => g.owner === "smith@smith.test");
    assert.ok(s, "not suggested");
    assert.equal(s.companies.length, 2);
  });

  const ownerOf = async (tenantId) => {
    const _id = oid();
    await db.collection("officeemployes").insertOne({
      _id,
      tenantId,
      email: `owner-${String(tenantId).slice(-4)}@cdc.test`,
      name: "Owner",
      isSuperAdmin: true,
      isActive: true,
      delete: false,
      phoneNumber: 7700900555,
    });
    return _id;
  };
  await ownerOf(london);

  actAs({ _id: String(oid()), role: "superAdmin", tenantId: String(york) });
  await check("the owner of an extra company sees the shared bill", async () => {
    const page = JSON.parse((await getMyPlan()).data);
    assert.equal(page.account.name, "Creative Design & Construction");
    assert.deepEqual(page.account.others.map((c) => c.name), ["CDC London"]);
    assert.equal(page.account.extraCompany, true);
  });

  actAs({ _id: String(oid()), role: "superAdmin", tenantId: String(london) });
  await check("only the platform admin manages accounts", async () => {
    assert.equal((await accounts.listAccounts()).success, false);
    assert.equal((await accounts.createAccount({ name: "x", companyIds: [String(london)] })).success, false);
    assert.equal((await accounts.setAccountLock(accountId, { level: "locked" })).success, false);
  });

  /* ------------------------------------------------------ repeat trials */

  const form = (extra = {}) => ({
    companyName: "Brand New Builders",
    slug: `brand-new-${Date.now()}`,
    name: "Sam",
    email: `sam-${Date.now()}@example.test`,
    phoneNumber: "07700 900555",
    password: "a-long-enough-password",
    industry: "construction",
    ...extra,
  });

  actAs(null);
  await check("THE POINT: an owner's phone number gets no second free trial", async () => {
    const f = form({ phoneNumber: "+44 7700 900555" });
    const res = await startSignup(f);
    // The same reply as a fresh sign-up: the screen says nothing about whose
    // number it is. The person is told by email.
    assert.equal(res.success, true);
    const pending = await db.collection("pendingsignups").findOne({ email: f.email });
    assert.equal(pending, null, "a sign-up was started anyway");
  });

  actAs(null);
  await check("a new phone number signs up as before", async () => {
    const f = form({ phoneNumber: "07700 900999" });
    const res = await startSignup(f);
    assert.equal(res.success, true, res.message);
    assert.ok(await db.collection("pendingsignups").findOne({ email: f.email }));
  });

  // An earlier self-serve company at acme.co.uk.
  await company("ACME Builders Limited", {
    signup: { emailDomain: "acme.co.uk", phoneKey: "1111111111", at: new Date() },
  });

  const confirm = async ({ companyName, email, phone = 7700900888 }) => {
    const token = crypto.randomBytes(16).toString("hex");
    await db.collection("pendingsignups").insertOne({
      companyName,
      slug: `c-${crypto.randomUUID().slice(0, 8)}`,
      name: "Owner",
      email,
      phoneNumber: phone,
      industry: "construction",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuuJw1mY3u9U7rS1o2b3c4d5e6f7g8h9i0",
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: null,
    });
    const res = await completeSignup(token);
    assert.equal(res.success, true, res.message);
    return db.collection("companies").findOne({ name: companyName });
  };

  let flagged;
  actAs(null);
  await check("same work domain and same name are flagged, not stopped", async () => {
    flagged = await confirm({ companyName: "Acme Builders Ltd", email: "new@acme.co.uk" });
    const codes = flagged.signup.flags.map((f) => f.code).sort();
    assert.deepEqual(codes, ["sameEmailDomain", "sameName"]);
    assert.equal(flagged.status, "trial", "still got its trial");
  });

  actAs(null);
  await check("a throwaway inbox is flagged; a gmail address is not", async () => {
    const throwaway = await confirm({ companyName: "Quick Co", email: "x@mailinator.com", phone: 7700900777 });
    assert.deepEqual(throwaway.signup.flags.map((f) => f.code), ["disposableEmail"]);
    const plain = await confirm({ companyName: "Plain Co", email: "plain@gmail.com", phone: 7700900666 });
    assert.equal(plain.signup.flags, undefined);
    assert.equal(plain.signup.phoneKey, "7700900666", "kept, for the next sign-up");
  });

  platform();
  await check("a flagged company can be marked as checked", async () => {
    const res = await dismissSignupFlags(String(flagged._id));
    assert.equal(res.success, true, res.message);
    const c = await db.collection("companies").findOne({ _id: flagged._id });
    assert.ok(c.signup.reviewedAt);
    assert.equal(c.signup.flags.length, 2, "what was found is kept");
  });

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
