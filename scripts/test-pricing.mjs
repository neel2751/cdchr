/**
 * Packages, the price list, trial offer codes, and putting a company on a plan.
 *
 * What has to hold:
 *
 *   - THE POINT: a package price plus each person over the allowance — and a
 *     student or site worker costs less than an office member;
 *   - people are counted per company; a customer's extra company pays a
 *     discounted package price;
 *   - yearly is twelve months less the yearly discount; VAT on top;
 *   - an add-on is charged only for a module the package does not include;
 *   - the trial is as long as the console says — or as an offer code says,
 *     until the code runs out or ends;
 *   - applying a package records the price, and can end the trial;
 *   - only the platform admin changes any of it.
 *
 * Needs a LOCAL replica-set database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_pricing?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-pricing.mjs
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
// Storage usage asks the bucket; point it at nothing so it fails fast.
process.env.AWS_ENDPOINT_URL_S3 = "http://127.0.0.1:9";
process.env.AWS_ACCESS_ID = "test";
process.env.AWS_ACCESS_PORTAL_KEY = "test";
process.env.AWS_REGION = "eu-west-2";
process.env.AWS_BUCKET_NAME = "pricing-tests-not-a-bucket";

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.db.dropDatabase();
  const db = mongoose.connection.db;

  const {
    DEFAULT_PLANS,
    DEFAULT_PRICING_SETTINGS,
    quote,
    cleanPlan,
    cleanPricingSettings,
    offerUsable,
  } = await import("@/lib/pricing");
  const {
    getPricing,
    savePlan,
    savePricingSettings,
    saveTrialOffer,
    applyPlanToCompany,
  } = await import("@/server/billingServer/pricingServer");
  const { getSignupTrial } = await import("@/server/billingServer/trialOfferServer");
  const { startSignup, completeSignup } = await import("@/server/authServer/signupServer");

  const plans = DEFAULT_PLANS;
  const settings = DEFAULT_PRICING_SETTINGS;
  const one = (company, extra = {}) =>
    quote({ companies: [company], plans, settings, ...extra });

  /* ---------------------------------------------------------- arithmetic */

  await check("THE POINT: package price plus each person over the allowance", () => {
    // Workforce: £129, 25 office + 100 workers + 25 GB included;
    // £3.50 / £1.25 / £0.40 for each one over.
    const q = one({ planKey: "workforce", officeStaff: 30, workers: 120, storageGb: 30 });
    assert.equal(q.monthlySubtotalPence, 12900 + 5 * 350 + 20 * 125 + 5 * 40);
    assert.equal(q.vatPence, Math.round(q.periodNetPence * 0.2));
    assert.equal(q.periodGrossPence, q.periodNetPence + q.vatPence);
  });

  await check("a student or site worker costs less than an office member", () => {
    const office = one({ planKey: "essentials", officeStaff: 20, workers: 0, storageGb: 0 });
    const workers = one({ planKey: "essentials", officeStaff: 0, workers: 35, storageGb: 0 });
    // Ten over the allowance each way.
    assert.ok(workers.monthlySubtotalPence < office.monthlySubtotalPence);
  });

  await check("within the allowance it is just the package price", () => {
    const q = one({ planKey: "essentials", officeStaff: 10, workers: 25, storageGb: 5 });
    assert.equal(q.monthlySubtotalPence, 4900);
    assert.equal(q.companies[0].lines.length, 1);
  });

  await check("storage is charged per started GB", () => {
    const q = one({ planKey: "essentials", officeStaff: 0, workers: 0, storageGb: 5.2 });
    assert.equal(q.monthlySubtotalPence, 4900 + 50);
  });

  await check("an extra company: discounted package, its own people counted", () => {
    const q = quote({
      companies: [
        { planKey: "workforce", officeStaff: 10, workers: 0, storageGb: 0 },
        { planKey: "workforce", officeStaff: 30, workers: 0, storageGb: 0 },
      ],
      plans,
      settings,
    });
    assert.equal(q.companies[0].monthlyPence, 12900);
    // 25% off the package; its 30 office staff against its own 25 included.
    assert.equal(q.companies[1].monthlyPence, 9675 + 5 * 350);
  });

  await check("yearly is twelve months less the yearly discount", () => {
    const q = one(
      { planKey: "workforce", officeStaff: 0, workers: 0, storageGb: 0 },
      { cycle: "yearly" }
    );
    assert.equal(q.periodNetPence, 12900 * 12 - Math.round(12900 * 12 * 0.15));
  });

  await check("a deal discount comes off the monthly total", () => {
    const q = one(
      { planKey: "workforce", officeStaff: 0, workers: 0, storageGb: 0 },
      { discountPercent: 10 }
    );
    assert.equal(q.monthlyNetPence, 12900 - 1290);
  });

  await check("an add-on is charged only when the package lacks the module", () => {
    const essentials = one({ planKey: "essentials", addOns: ["crm"] });
    assert.equal(essentials.monthlySubtotalPence, 4900 + 2000);
    const enterprise = one({ planKey: "enterprise", addOns: ["crm"] });
    assert.equal(enterprise.monthlySubtotalPence, 34900, "Enterprise already has CRM");
  });

  await check("console input is tidied: whole pence, known modules, sane trial", () => {
    assert.ok(cleanPlan({ key: "x", name: "X" }).error, "a one-letter key");
    const { plan } = cleanPlan({ key: "Team", name: "Team", monthlyPence: 12.6, features: ["crm", "nope"] });
    assert.equal(plan.key, "team");
    assert.equal(plan.monthlyPence, 13);
    assert.deepEqual(plan.features, ["crm"]);
    assert.equal(cleanPricingSettings({ trialDays: 0 }).trialDays, 14);
    assert.equal(cleanPricingSettings({ trialDays: 900 }).trialDays, 365);
  });

  await check("an offer stops working when switched off, ended or used up", () => {
    assert.equal(offerUsable({ trialDays: 30 }), true);
    assert.equal(offerUsable({ isActive: false }), false);
    assert.equal(offerUsable({ validUntil: new Date(Date.now() - DAY) }), false);
    assert.equal(offerUsable({ maxUses: 2, uses: 2 }), false);
  });

  /* -------------------------------------------------------- the console */

  const platform = () => actAs({ _id: String(new mongoose.Types.ObjectId()), role: "platformAdmin", email: "ops@test" });

  platform();
  await check("a fresh console starts from Essentials, Workforce and Enterprise", async () => {
    const data = JSON.parse((await getPricing()).data);
    assert.deepEqual(data.plans.map((p) => p.name), ["Essentials", "Workforce", "Enterprise"]);
    assert.equal(data.reviewed, false, "suggested until someone saves");
  });

  platform();
  await check("a package can be renamed; its key stays", async () => {
    const res = await savePlan({ ...DEFAULT_PLANS[0], name: "Essentials Plus" });
    assert.equal(res.success, true, res.message);
    const doc = await db.collection("pricingplans").findOne({ key: "essentials" });
    assert.equal(doc.name, "Essentials Plus");
  });

  actAs({ _id: String(new mongoose.Types.ObjectId()), role: "superAdmin", tenantId: String(new mongoose.Types.ObjectId()) });
  await check("only the platform admin changes prices", async () => {
    assert.equal((await savePlan({ ...DEFAULT_PLANS[0], monthlyPence: 1 })).success, false);
    assert.equal((await savePricingSettings({ trialDays: 365 })).success, false);
    assert.equal((await saveTrialOffer({ code: "FREE365", trialDays: 365 })).success, false);
    assert.equal((await getPricing()).success, false);
  });

  /* ------------------------------------------------------ flexible trials */

  platform();
  await check("the standard trial length is set in the console", async () => {
    const res = await savePricingSettings({ ...DEFAULT_PRICING_SETTINGS, trialDays: 21 });
    assert.equal(res.success, true, res.message);
    actAs(null);
    assert.equal((await getSignupTrial(null)).trialDays, 21);
  });

  platform();
  await check("an event code gives a longer trial", async () => {
    const res = await saveTrialOffer({
      isNew: true,
      code: "expo30",
      label: "Construction Expo",
      trialDays: 30,
      maxUses: 1,
    });
    assert.equal(res.success, true, res.message);
    actAs(null);
    const trial = await getSignupTrial("EXPO30");
    assert.equal(trial.success, true);
    assert.equal(trial.trialDays, 30);
    assert.equal((await getSignupTrial("NOPE99")).success, false);
  });

  const signupForm = (extra = {}) => ({
    companyName: "Expo Builders",
    slug: `expo-${Date.now()}`,
    name: "Eve",
    email: `eve-${Date.now()}@expo.test`,
    phoneNumber: "07700900123",
    password: "a-long-enough-password",
    industry: "construction",
    ...extra,
  });

  actAs(null);
  await check("a code that does not work is refused at signup, not ignored", async () => {
    const res = await startSignup(signupForm({ offerCode: "NOPE99" }));
    assert.equal(res.success, false);
    assert.match(res.message, /offer code/i);
  });

  const confirm = async (name, offerCode) => {
    const token = crypto.randomBytes(16).toString("hex");
    await db.collection("pendingsignups").insertOne({
      companyName: name,
      slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}`,
      name: "Owner",
      email: `${crypto.randomUUID()}@expo.test`,
      phoneNumber: 7700900123,
      industry: "construction",
      offerCode,
      passwordHash: "$2a$10$abcdefghijklmnopqrstuuJw1mY3u9U7rS1o2b3c4d5e6f7g8h9i0",
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: null,
    });
    const res = await completeSignup(token);
    assert.equal(res.success, true, res.message);
    const company = await db.collection("companies").findOne({ name });
    return { company, days: (new Date(company.billing.trialEndsAt) - Date.now()) / DAY };
  };

  actAs(null);
  await check("THE POINT: signing up with EXPO30 gives 30 days", async () => {
    const { company, days } = await confirm("Expo One", "EXPO30");
    assert.ok(days > 29.9 && days <= 30, `${days} days`);
    assert.equal(company.billing.trialOffer, "EXPO30");
    const offer = await db.collection("trialoffers").findOne({ code: "EXPO30" });
    assert.equal(offer.uses, 1);
  });

  actAs(null);
  await check("…and once used up, the next one gets the standard trial", async () => {
    const { company, days } = await confirm("Expo Two", "EXPO30");
    assert.ok(days > 20.9 && days <= 21, `${days} days`);
    assert.equal(company.billing.trialOffer, undefined);
  });

  actAs(null);
  await check("without a code: the console's standard length", async () => {
    const { days } = await confirm("Plain Co", undefined);
    assert.ok(days > 20.9 && days <= 21, `${days} days`);
  });

  /* ------------------------------------------------ putting one on a plan */

  const tenantId = (await db.collection("companies").findOne({ name: "Plain Co" }))._id;
  // 30 office staff in all, one of whom has left, and 5 site workers.
  const staff = Array.from({ length: 30 }, (_, i) => ({
    tenantId,
    email: `s${i}@plain.test`,
    name: `Staff ${i}`,
    isActive: true,
    delete: false,
  }));
  staff[0].delete = true;
  await db.collection("officeemployes").insertMany(staff);
  await db.collection("employes").insertMany(
    Array.from({ length: 5 }, (_, i) => ({ tenantId, firstName: `W${i}`, delete: false }))
  );

  actAs({ _id: String(new mongoose.Types.ObjectId()), role: "superAdmin", tenantId: String(tenantId) });
  await check("only the platform admin puts a company on a plan", async () => {
    const res = await applyPlanToCompany(String(tenantId), { planKey: "workforce" });
    assert.equal(res.success, false);
  });

  platform();
  await check("THE POINT: applying a plan records the price and ends the trial", async () => {
    const res = await applyPlanToCompany(String(tenantId), {
      planKey: "workforce",
      cycle: "monthly",
      matchModules: true,
      markPaying: true,
    });
    assert.equal(res.success, true, res.message);
    const c = await db.collection("companies").findOne({ _id: tenantId });
    assert.equal(c.status, "active", "the trial is over");
    assert.equal(c.billing.plan, "workforce");
    // The signup's owner, plus 29 current staff (the leaver is not counted):
    // 30 against 25 included. Five workers, well inside 100.
    assert.equal(c.billing.quotedMonthlyPence, 12900 + 5 * 350);
    assert.equal(c.features.crm, false, "Workforce does not include CRM");
    assert.equal(c.features.expenses, true);
  });

  platform();
  await check("an add-on switches its module on with the plan", async () => {
    await applyPlanToCompany(String(tenantId), {
      planKey: "workforce",
      addOns: ["crm"],
      matchModules: true,
    });
    const c = await db.collection("companies").findOne({ _id: tenantId });
    assert.equal(c.features.crm, true);
    assert.equal(c.billing.quotedMonthlyPence, 12900 + 5 * 350 + 2000);
  });

  platform();
  await check("REGRESSION: without 'match modules' nothing is switched off", async () => {
    await db.collection("companies").updateOne({ _id: tenantId }, { $set: { "features.crm": true, "features.devices": true } });
    await applyPlanToCompany(String(tenantId), { planKey: "essentials" });
    const c = await db.collection("companies").findOne({ _id: tenantId });
    assert.equal(c.features.devices, true);
    assert.equal(c.billing.plan, "essentials");
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
