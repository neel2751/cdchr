/**
 * The monthly bill: invoices made, cards charged, unpaid bills locking.
 *
 * What has to hold:
 *
 *   - THE POINT: a paying company is billed in advance, once a period — a
 *     second run the same day bills nothing; a yearly one is billed for the
 *     year;
 *   - one invoice per customer account, the extra company discounted, and the
 *     lines adding up to the quote;
 *   - a saved card is charged at once and the invoice marked paid; a declined
 *     card is noted and the invoice left to pay;
 *   - a customer paying by invoice gets terms;
 *   - THE POINT: unpaid, the account goes read-only after a week and locked
 *     after two; paying reopens it — but a lock a person put on stays;
 *   - nothing is billed with automatic billing off, unless a person says so;
 *   - trial companies, and locked ones, are not billed;
 *   - saving a card only ever attaches it to the account the page was for.
 *
 * Stripe is stood in for by a fake `fetch`: no network, no real charges.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_billing?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-subscription-billing.mjs
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
process.env.AWS_BUCKET_NAME = "billing-tests-not-a-bucket";
if (!process.env.TAG_KEY_MASTER) process.env.TAG_KEY_MASTER = "b".repeat(64);

/* ------------------------------------------------------------ fake Stripe */

const stripeCalls = [];
let declineNext = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.stripe.com/v1")) return realFetch(url, init);
  const path = u.replace("https://api.stripe.com/v1", "").split("?")[0];
  const body = Object.fromEntries(new URLSearchParams(init.body || ""));
  stripeCalls.push({ path, body, headers: init.headers || {} });
  const json = (status, payload) =>
    new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

  if (path === "/payment_intents") {
    if (declineNext) {
      declineNext = false;
      return json(402, {
        error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." },
      });
    }
    return json(200, { id: `pi_${stripeCalls.length}`, status: "succeeded", amount_received: Number(body.amount) });
  }
  if (path.startsWith("/checkout/sessions/")) {
    const id = path.split("/").pop();
    const forAccount = id.replace("cs_for_", "");
    return json(200, {
      id,
      mode: "setup",
      customer: "cus_123",
      metadata: { accountId: forAccount },
      setup_intent: { status: "succeeded", payment_method: "pm_456" },
    });
  }
  if (path === "/payment_methods/pm_456") {
    return json(200, { id: "pm_456", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 } });
  }
  if (path.startsWith("/customers")) return json(200, { id: "cus_123" });
  return json(404, { error: { message: `no fake for ${path}` } });
};

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}
const DAY = 86400000;

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.db.dropDatabase();
  const db = mongoose.connection.db;

  const { addPeriod, unpaidLevel } = await import("@/lib/billing");
  const { quote, DEFAULT_PLANS, DEFAULT_PRICING_SETTINGS } = await import("@/lib/pricing");
  const { invoiceLinesFor } = await import("@/lib/billing");
  const { totalLines } = await import("@/lib/money");
  const { runSubscriptionBilling } = await import("@/server/billingServer/subscriptionBilling");
  const { syncPaymentLocks } = await import("@/server/billingServer/paymentLocks");
  const { loadPricing } = await import("@/server/billingServer/pricingStore");
  const { saveCardFromSession } = await import("@/server/billingServer/cardStore");
  const { finishCardSetup } = await import("@/server/billingServer/cardServer");
  const { companyAccess } = await import("@/lib/tenantAccess");
  const { sealSecret } = await import("@/lib/secretBox");

  /* ----------------------------------------------------------------- pure */

  await check("periods: next month, month-end kept, a year", () => {
    assert.equal(addPeriod(new Date("2026-01-15"), "monthly").toISOString().slice(0, 10), "2026-02-15");
    assert.equal(addPeriod(new Date("2026-01-31"), "monthly").toISOString().slice(0, 10), "2026-02-28");
    assert.equal(addPeriod(new Date("2026-03-10"), "yearly").toISOString().slice(0, 10), "2027-03-10");
  });

  await check("invoice lines add up to the quote, monthly and yearly", () => {
    for (const cycle of ["monthly", "yearly"]) {
      const result = quote({
        companies: [{ planKey: "workforce", officeStaff: 30, workers: 120, storageGb: 0, addOns: ["crm"] }],
        cycle,
        discountPercent: 10,
        plans: DEFAULT_PLANS,
        settings: DEFAULT_PRICING_SETTINGS,
      });
      const lines = invoiceLinesFor({
        companyName: "X",
        result,
        from: new Date(),
        to: new Date(),
        vatRateBasisPoints: 2000,
      });
      assert.equal(totalLines(lines).netPence, result.periodNetPence, cycle);
    }
  });

  await check("unpaid: nothing, then read-only at 7 days, locked at 14", () => {
    assert.equal(unpaidLevel(3), null);
    assert.equal(unpaidLevel(7), "readOnly");
    assert.equal(unpaidLevel(14), "locked");
    assert.equal(unpaidLevel(30, { unpaidReadOnlyDays: 7, unpaidLockDays: 0 }), "readOnly", "0 never locks");
  });

  /* ---------------------------------------------------------------- setup */

  await loadPricing();
  await db.collection("platformsettings").insertOne({
    singleton: "only",
    billingName: "Staffmain Ltd",
    billingAddress: "1 High Street, London",
    paymentTermsDays: 30,
  });
  await db.collection("carrieraccounts").insertOne({
    provider: "stripe",
    isEnabled: true,
    credentials: { secretKey: sealSecret("sk_test_fake") },
  });

  const oid = () => new mongoose.Types.ObjectId();
  const now = new Date("2026-12-01T09:00:00Z");
  const company = async (name, billing = {}, extra = {}) => {
    const _id = oid();
    await db.collection("companies").insertOne({
      _id,
      name,
      slug: name.toLowerCase().replace(/\W+/g, "-"),
      status: "active",
      isActive: true,
      delete: false,
      billing: { plan: "workforce", planAppliedAt: new Date("2026-11-01"), cycle: "monthly", ...billing },
      ...extra,
    });
    await db.collection("officeemployes").insertOne({
      tenantId: _id,
      email: `owner@${_id}.test`,
      name: "Owner",
      isSuperAdmin: true,
      isActive: true,
      delete: false,
    });
    return _id;
  };

  // A customer with two companies on one account, paying by card.
  const london = await company("CDC London");
  const leeds = await company("CDC Leeds");
  const accountId = oid();
  await db.collection("billingaccounts").insertOne({
    _id: accountId,
    name: "CDC",
    primaryCompanyId: london,
    paymentMethod: "card",
    stripeCustomerId: "cus_123",
    card: { paymentMethodId: "pm_456", brand: "visa", last4: "4242" },
  });
  await db.collection("companies").updateMany(
    { _id: { $in: [london, leeds] } },
    { $set: { "billing.accountId": accountId } }
  );

  // Billed on its own, by invoice; yearly.
  const solo = await company("Solo Ltd", { cycle: "yearly" });
  // Not billed: on trial; locked.
  await company("Trial Co", {}, { status: "trial" });
  await company("Locked Co", { lock: { level: "locked", message: "x" } });

  const invoicesFor = (filter) =>
    db.collection("invoices").find({ source: "subscription", ...filter }).toArray();
  const platform = () => actAs({ _id: String(oid()), role: "platformAdmin", name: "Ops" });

  /* -------------------------------------------------------------- running */

  await check("with automatic billing off, nothing is billed", async () => {
    const res = await runSubscriptionBilling({ now });
    assert.equal(res.enabled, false);
    assert.equal((await invoicesFor({})).length, 0);
  });

  await db.collection("pricingsettings").updateOne({ singleton: "only" }, { $set: { billingEnabled: true } });

  let run;
  await check("THE POINT: switched on, the paying companies are billed", async () => {
    run = await runSubscriptionBilling({ now });
    assert.equal(run.failed.length, 0, JSON.stringify(run.failed));
    const names = run.billed.flatMap((b) => b.companies).sort();
    assert.deepEqual(names, ["CDC Leeds", "CDC London", "Solo Ltd"], "trial and locked are not billed");
  });

  await check("one invoice per account, the extra company discounted", async () => {
    const [inv] = await invoicesFor({ accountId });
    assert.ok(inv, "no invoice for the account");
    assert.match(inv.number, /^INV-\d{4}-\d{4}$/);
    assert.equal(String(inv.tenantId), String(london), "issued to the main company");
    const net = inv.lines.reduce((s, l) => s + l.quantity * l.unitPricePence, 0);
    assert.equal(net, 12900 + 9675);
    assert.equal(inv.netPence, net);
  });

  await check("THE POINT: the saved card is charged and the bill marked paid", async () => {
    const [inv] = await invoicesFor({ accountId });
    assert.equal(inv.status, "paid");
    assert.equal(inv.payments[0].method, "card");
    const charge = stripeCalls.find((c) => c.path === "/payment_intents");
    assert.equal(charge.body.amount, String(inv.grossPence));
    assert.equal(charge.body.off_session, "true");
    assert.equal(charge.headers["Idempotency-Key"], `bill-${inv._id}`, "a retry cannot charge twice");
  });

  await check("billed in advance: paid through the next month", async () => {
    const c = await db.collection("companies").findOne({ _id: london });
    assert.equal(c.billing.paidThrough.toISOString().slice(0, 10), "2027-01-01");
  });

  let soloInvoice;
  await check("a company on its own: its own account, an invoice with terms", async () => {
    const c = await db.collection("companies").findOne({ _id: solo });
    assert.ok(c.billing.accountId, "no account was made for it");
    [soloInvoice] = await invoicesFor({ accountId: c.billing.accountId });
    assert.equal(soloInvoice.status, "issued", "not charged — no card");
    const days = Math.round((soloInvoice.dueAt - now) / DAY);
    assert.equal(days, 14);
  });

  await check("yearly billing: a year, less the yearly discount", async () => {
    assert.equal(soloInvoice.netPence, 12900 * 12 - Math.round(12900 * 12 * 0.15));
    const c = await db.collection("companies").findOne({ _id: solo });
    assert.equal(c.billing.paidThrough.toISOString().slice(0, 10), "2027-12-01");
  });

  await check("THE POINT: a second run the same day bills nothing", async () => {
    const again = await runSubscriptionBilling({ now });
    assert.equal(again.billed.length, 0);
    assert.equal((await invoicesFor({})).length, 2);
  });

  await check("a month on, the monthly companies are billed again", async () => {
    const next = await runSubscriptionBilling({ now: new Date("2027-01-01T09:00:00Z") });
    assert.deepEqual(next.billed.flatMap((b) => b.companies).sort(), ["CDC Leeds", "CDC London"]);
  });

  await check("a declined card is noted, and the bill left to pay", async () => {
    declineNext = true;
    const res = await runSubscriptionBilling({ now: new Date("2027-02-01T09:00:00Z") });
    assert.equal(res.billed[0].charged, false);
    assert.match(res.billed[0].reason, /insufficient funds/);
    const acc = await db.collection("billingaccounts").findOne({ _id: accountId });
    assert.ok(acc.cardFailedAt);
    const unpaid = await db.collection("invoices").findOne({ accountId, status: "issued" });
    assert.ok(unpaid, "the bill is not left to pay");
  });

  /* ------------------------------------------------------- unpaid → lock */

  const soloAccount = (await db.collection("companies").findOne({ _id: solo })).billing.accountId;
  const access = async (id) => companyAccess(await db.collection("companies").findOne({ _id: id })).level;

  await check("THE POINT: unpaid a week past due, the account goes read-only", async () => {
    const due = soloInvoice.dueAt;
    await syncPaymentLocks({ accountId: soloAccount, now: new Date(due.getTime() + 8 * DAY) });
    assert.equal(await access(solo), "readOnly");
  });

  await check("…and locked at two weeks", async () => {
    await syncPaymentLocks({ accountId: soloAccount, now: new Date(soloInvoice.dueAt.getTime() + 15 * DAY) });
    assert.equal(await access(solo), "locked");
    const c = await db.collection("companies").findOne({ _id: solo });
    assert.match(c.billing.lock.message, new RegExp(soloInvoice.number));
  });

  await check("THE POINT: paying reopens it straight away", async () => {
    const { creditInvoice } = await import("@/server/billingServer/stripeWebhook");
    await creditInvoice({
      invoiceId: String(soloInvoice._id),
      amountPence: soloInvoice.grossPence,
      reference: "pi_paid_late",
      eventId: "evt_test",
    });
    assert.equal(await access(solo), "full");
  });

  await check("a lock a person put on is never lifted by the bills", async () => {
    await db.collection("companies").updateOne(
      { _id: solo },
      { $set: { "billing.lock": { level: "locked", message: "fraud check" } } }
    );
    await syncPaymentLocks({ accountId: soloAccount, now: new Date("2028-01-01") });
    assert.equal(await access(solo), "locked");
  });

  /* ------------------------------------------------------------ the card */

  await check("a saved card is kept, and becomes how the account pays", async () => {
    const acc2 = oid();
    await db.collection("billingaccounts").insertOne({ _id: acc2, name: "New Co", stripeCustomerId: "cus_123", paymentMethod: "invoice" });
    const outcome = await saveCardFromSession(`cs_for_${acc2}`);
    assert.match(outcome, /saved visa ending 4242/);
    const acc = await db.collection("billingaccounts").findOne({ _id: acc2 });
    assert.equal(acc.paymentMethod, "card");
    assert.equal(acc.card.paymentMethodId, "pm_456");
  });

  const someone = await company("Someone Else");
  const theirAccount = oid();
  await db.collection("billingaccounts").insertOne({ _id: theirAccount, name: "Someone", primaryCompanyId: someone, paymentMethod: "invoice" });
  await db.collection("companies").updateOne({ _id: someone }, { $set: { "billing.accountId": theirAccount } });

  actAs({ _id: String(oid()), role: "superAdmin", tenantId: String(someone) });
  await check("a card page for another account cannot be attached to yours", async () => {
    const res = await finishCardSetup({ sessionId: `cs_for_${accountId}` });
    assert.equal(res.success, false);
    const acc = await db.collection("billingaccounts").findOne({ _id: theirAccount });
    assert.equal(acc.card, undefined);
  });

  actAs({ _id: String(oid()), role: "superAdmin", tenantId: String(leeds) });
  await check("an extra company's owner cannot change how the account pays", async () => {
    const { setMyPaymentMethod } = await import("@/server/billingServer/cardServer");
    const res = await setMyPaymentMethod("invoice");
    assert.equal(res.success, false);
    assert.match(res.message, /paid by CDC London/);
  });

  platform();
  await check("Bill now works with automatic billing off", async () => {
    await db.collection("pricingsettings").updateOne({ singleton: "only" }, { $set: { billingEnabled: false } });
    const fresh = await company("Fresh Ltd");
    const res = await runSubscriptionBilling({ now, force: true, by: "Ops" });
    assert.ok(res.billed.some((b) => b.companies.includes("Fresh Ltd")));
    const c = await db.collection("companies").findOne({ _id: fresh });
    assert.ok(c.billing.paidThrough);
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
