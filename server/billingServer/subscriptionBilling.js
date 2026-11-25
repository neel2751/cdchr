import { connect } from "@/db/db";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { emailButton, escapeHtml, renderBrandedEmail } from "@/lib/emailTemplate";
import { formatMoney, outstanding, totalLines } from "@/lib/money";
import { addPeriod, dayStart, invoiceLinesFor } from "@/lib/billing";
import BillingAccountModel from "@/models/billingAccountModel";
import CompanyModel from "@/models/companyModel";
import InvoiceModel from "@/models/invoiceModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { sendMail } from "@/server/nodeMailerServer/nodemailerServer";
import { ensureAccount, quoteCompany } from "./accountStore";
import { allocateNumber, sellerDetails } from "./invoiceCore";
import { syncPaymentLocks } from "./paymentLocks";
import { loadPricing } from "./pricingStore";
import { callStripe, secretKey } from "./stripeCore";
import { creditInvoice } from "./stripeWebhook";

/**
 * The monthly bill.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS CHARGES CARDS AND EMAILS CUSTOMERS WITH NOBODY IN THE LOOP.
 *
 * So the daily run does nothing until the platform admin switches it on
 * (PricingSetting.billingEnabled), and "Bill now" on an account — a person
 * deciding — is the only other way in. Every company's period is claimed
 * before its invoice is made, so two runs cannot bill the same month twice,
 * and a card is charged with an idempotency key, so a retry cannot charge it
 * twice either.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Billed in advance. A paying company on a package is due when its
 * `billing.paidThrough` is today or past (or it has none yet): it is billed
 * for the month — or year — from then, at its usage on the day. One invoice
 * per customer account, with each due company's lines on it, issued to the
 * account's main company.
 *
 * Then, by how the customer pays (BillingAccount.paymentMethod):
 *   card    — the saved card is charged now. Declined: the customer is
 *             emailed a link to pay, and the invoice is due today.
 *   invoice — emailed, due in PricingSetting.invoiceTermsDays.
 *
 * Unpaid, it locks the account after a while (paymentLocks.js).
 *
 * Stripe's Subscriptions product is deliberately not used: Stripe would
 * issue invoices of its own beside these, two numbering runs for one bill,
 * and its fixed prices do not fit a bill that follows headcount.
 *
 * NOT "use server".
 */

const DAY_MS = 86400000;

function platformMailer() {
  const host = process.env.EMAIL_HOST;
  const userName = process.env.EMAIL_USERNAME;
  const password = process.env.EMAIL_PASSWORD;
  if (!host || !userName || !password) return null;
  return { host, userName, password, port: Number(process.env.EMAIL_PORT) || 587 };
}

function appUrl(company) {
  const root = process.env.PLATFORM_ROOT_DOMAIN;
  if (root && company?.slug) return `https://${company.slug}.${root}`;
  return process.env.NEXTAUTH_URL || "";
}

/**
 * Companies due a bill: paying, on a package, and billed up to today or
 * never. A locked company is not billed — it cannot use what it would be
 * paying for. Read-only still is.
 */
async function dueCompanies(now, accountId) {
  return CompanyModel.find({
    delete: { $ne: true },
    status: { $in: ["active", null] },
    "billing.plan": { $nin: [null, ""] },
    "billing.planAppliedAt": { $ne: null },
    "billing.lock.level": { $ne: "locked" },
    $or: [
      { "billing.paidThrough": { $exists: false } },
      { "billing.paidThrough": null },
      { "billing.paidThrough": { $lte: now } },
    ],
    ...(accountId ? { "billing.accountId": accountId } : {}),
  })
    .select("name slug status billing")
    .lean();
}

/** The period a company is billed for now: from where it was paid up to. */
function periodFor(company, now) {
  const from = company.billing?.paidThrough
    ? dayStart(company.billing.paidThrough)
    : dayStart(now);
  return { from, to: addPeriod(from, company.billing?.cycle || "monthly") };
}

/** Who reads the bill: the account's billing email, else the main company's owners. */
async function billRecipients(account) {
  if (account.billingEmail) return [account.billingEmail];
  if (!account.primaryCompanyId) return [];
  const owners = await runWithTenant(String(account.primaryCompanyId), () =>
    OfficeEmployeeModel.find({
      isSuperAdmin: true,
      delete: { $ne: true },
      isActive: { $ne: false },
      email: { $nin: [null, ""] },
    })
      .select("email")
      .lean()
  );
  return owners.map((o) => o.email);
}

async function emailAccount(account, { subject, heading, html }) {
  const mailer = platformMailer();
  if (!mailer) return 0;
  const to = await billRecipients(account);
  const main = account.primaryCompanyId
    ? await CompanyModel.findById(account.primaryCompanyId).select("slug").lean()
    : null;
  const url = appUrl(main);
  let sent = 0;
  for (const toEmail of to) {
    const result = await sendMail({
      ...mailer,
      fromName: process.env.PLATFORM_APP_NAME || "Accounts",
      toEmail,
      subject,
      html: renderBrandedEmail({
        branding: { supportEmail: process.env.PLATFORM_SUPPORT_EMAIL || "" },
        appUrl: url,
        heading,
        html: html + (url ? emailButton("Open Plan & Billing", `${url}/admin/plan`) : ""),
      }),
      text: subject,
    }).catch(() => null);
    if (result?.success) sent += 1;
  }
  return sent;
}

/**
 * Charge the account's saved card for an invoice. Records the payment on
 * success (which lifts any unpaid lock); on failure notes Stripe's reason on
 * the account and emails a link to pay instead.
 */
async function chargeInvoice(account, invoice) {
  const owed = outstanding(invoice.grossPence, invoice.payments);
  if (owed <= 0) return { charged: false, reason: "nothing owed" };

  const key = await secretKey();
  const fail = async (reason) => {
    await BillingAccountModel.updateOne(
      { _id: account._id },
      { $set: { cardFailedAt: new Date(), cardFailure: reason } }
    );
    await emailAccount(account, {
      subject: `We could not take payment for ${invoice.number}`,
      heading: "Your card payment did not go through",
      html:
        `<p>We tried to take ${escapeHtml(formatMoney(owed, invoice.currency))} for invoice ` +
        `${escapeHtml(invoice.number)} from your saved card, and it did not go through: ` +
        `${escapeHtml(reason)}.</p><p>Please pay it, or add a new card, on Plan &amp; Billing. ` +
        `Everything keeps working while you do.</p>`,
    });
    return { charged: false, reason };
  };
  if (!key) return fail("card payment is not switched on");
  if (!account.card?.paymentMethodId || !account.stripeCustomerId) {
    return fail("there is no saved card");
  }

  try {
    const intent = await callStripe(
      "/payment_intents",
      {
        amount: String(owed),
        currency: (invoice.currency || "GBP").toLowerCase(),
        customer: account.stripeCustomerId,
        payment_method: account.card.paymentMethodId,
        off_session: "true",
        confirm: "true",
        description: `Invoice ${invoice.number}`,
        "metadata[invoiceId]": String(invoice._id),
        "metadata[invoiceNumber]": invoice.number || "",
        "metadata[accountId]": String(account._id),
      },
      key,
      // One charge per invoice, whatever retries or overlapping runs do.
      { idempotencyKey: `bill-${invoice._id}` }
    );

    if (intent?.status !== "succeeded") {
      return fail(
        intent?.status === "requires_action"
          ? "your bank asked you to confirm the payment"
          : `the payment is ${intent?.status || "not complete"}`
      );
    }

    await creditInvoice({
      invoiceId: String(invoice._id),
      amountPence: intent.amount_received ?? owed,
      reference: intent.id,
      eventId: "billing run",
    });
    await BillingAccountModel.updateOne(
      { _id: account._id },
      { $unset: { cardFailedAt: "", cardFailure: "" } }
    );
    await emailAccount(account, {
      subject: `Receipt for ${invoice.number}`,
      heading: "Thank you — payment received",
      html:
        `<p>We have taken ${escapeHtml(formatMoney(owed, invoice.currency))} for invoice ` +
        `${escapeHtml(invoice.number)} from your ${escapeHtml(account.card.brand || "card")} ` +
        `ending ${escapeHtml(account.card.last4 || "")}.</p>`,
    });
    return { charged: true, reference: intent.id };
  } catch (error) {
    const s = error?.stripe;
    const reason =
      s?.code === "authentication_required"
        ? "your bank asked you to confirm the payment"
        : s?.decline_code
          ? `the card was declined (${s.decline_code.replace(/_/g, " ")})`
          : error?.message || "the payment failed";
    return fail(reason);
  }
}

/**
 * Bill one account for its due companies: claim each company's period,
 * make and issue one invoice, then charge the card or email the invoice.
 *
 * @returns null when nothing was due, else what was billed
 */
async function billAccount(account, companies, { now, by }) {
  const pricing = await loadPricing();
  const { seller } = await sellerDetails();
  if (!seller.name || !seller.address) {
    throw new Error(
      "Set the billing name and address (Billing page) first — a VAT invoice has to carry them."
    );
  }

  // Claim each company's period first. Guarded on paidThrough still being
  // what was read, so a second run at the same moment claims nothing.
  const claimed = [];
  for (const company of companies) {
    const { from, to } = periodFor(company, now);
    const old = company.billing?.paidThrough || null;
    const res = await CompanyModel.updateOne(
      {
        _id: company._id,
        ...(old ? { "billing.paidThrough": old } : { "billing.paidThrough": { $in: [null] } }),
      },
      { $set: { "billing.paidThrough": to } }
    );
    if (res.modifiedCount) claimed.push({ company, from, to, old });
  }
  if (!claimed.length) return null;

  const release = () =>
    Promise.all(
      claimed.map(({ company, old }) =>
        CompanyModel.updateOne(
          { _id: company._id },
          old ? { $set: { "billing.paidThrough": old } } : { $unset: { "billing.paidThrough": "" } }
        )
      )
    );

  let invoice;
  try {
    const lines = [];
    for (const { company, from, to } of claimed) {
      const { result } = await quoteCompany(company, { pricing, account });
      lines.push(
        ...invoiceLinesFor({
          companyName: company.name,
          result,
          from,
          to,
          vatRateBasisPoints: pricing.settings.vatRateBasisPoints,
        })
      );
    }
    const totals = totalLines(lines);
    const tenantId = String(account.primaryCompanyId || claimed[0].company._id);
    const recipients = await billRecipients(account);
    const draft = await runWithTenant(tenantId, () =>
      InvoiceModel.create({
        kind: "invoice",
        status: "draft",
        source: "subscription",
        accountId: account._id,
        periodFrom: new Date(Math.min(...claimed.map((c) => c.from))),
        periodTo: new Date(Math.max(...claimed.map((c) => c.to))),
        lines,
        currency: pricing.settings.currency || "GBP",
        ...totals,
        seller,
        buyer: { name: account.name, email: recipients[0] || "" },
      })
    );

    // Issued as invoices.js issues one: the number is taken only once the
    // invoice is certainly going out.
    const number = await allocateNumber();
    const card = account.paymentMethod === "card" && account.card?.paymentMethodId;
    const dueAt = card
      ? now
      : new Date(now.getTime() + (pricing.settings.invoiceTermsDays ?? 14) * DAY_MS);
    await escapeTenant("billing: issue", () =>
      InvoiceModel.updateOne(
        { _id: draft._id },
        {
          $set: {
            status: "issued",
            number,
            issuedAt: now,
            issuedByName: by,
            dueAt,
          },
        }
      )
    );
    invoice = { ...draft.toObject(), number, status: "issued", issuedAt: now, dueAt };
  } catch (error) {
    await release();
    throw error;
  }

  await logAuditDirect({
    action: "Invoice.issue",
    module: "Invoice",
    entityId: String(invoice._id),
    tenantId: invoice.tenantId,
    description: `Plan bill ${invoice.number} for ${account.name}: ${formatMoney(invoice.grossPence, invoice.currency)}`,
    actor: { name: by, role: "system" },
  }).catch(() => {});

  let payment;
  if (account.paymentMethod === "card" && account.card?.paymentMethodId) {
    payment = await chargeInvoice(account, invoice);
  } else {
    await emailAccount(account, {
      subject: `Invoice ${invoice.number} — ${formatMoney(invoice.grossPence, invoice.currency)}`,
      heading: `Your bill for ${account.name}`,
      html:
        `<p>Invoice ${escapeHtml(invoice.number)} for ` +
        `${escapeHtml(formatMoney(invoice.grossPence, invoice.currency))} is ready, due ` +
        `${escapeHtml(new Date(invoice.dueAt).toLocaleDateString("en-GB"))}.</p>` +
        `<p>Pay it by card on Plan &amp; Billing, or by bank transfer quoting ` +
        `${escapeHtml(invoice.number)}. To have it paid automatically each month, save a card there.</p>`,
    });
    payment = { charged: false, reason: "sent as an invoice" };
  }

  return {
    account: account.name,
    accountId: String(account._id),
    invoice: invoice.number,
    grossPence: invoice.grossPence,
    companies: claimed.map((c) => c.company.name),
    ...payment,
  };
}

/** Due companies, grouped by the account each is billed under. */
async function dueByAccount(now, accountId, { create }) {
  const companies = await dueCompanies(now, accountId);
  const groups = new Map();
  for (const company of companies) {
    const account = create
      ? await ensureAccount(company)
      : company.billing?.accountId
        ? await BillingAccountModel.findById(company.billing.accountId).lean()
        : null;
    const key = account ? String(account._id) : `new-${company._id}`;
    if (!groups.has(key)) {
      groups.set(key, { account: account || { name: company.name, primaryCompanyId: company._id }, companies: [] });
    }
    groups.get(key).companies.push(company);
  }
  return [...groups.values()];
}

/**
 * The daily run, or "Bill now". Bills every account with a company due, then
 * brings unpaid-bill locks up to date.
 *
 * @param {{ now?: Date, force?: boolean, accountId?: any, by?: string }} [o]
 *   `force` — a person asked; runs even with automatic billing off
 */
export async function runSubscriptionBilling({ now = new Date(), force = false, accountId, by = "Billing run" } = {}) {
  await connect();
  const { settings } = await loadPricing();
  if (!settings.billingEnabled && !force) {
    const locks = await syncPaymentLocks({ now });
    return { enabled: false, billed: [], failed: [], locks };
  }

  const billed = [];
  const failed = [];
  for (const group of await dueByAccount(now, accountId, { create: true })) {
    try {
      const account = await BillingAccountModel.findById(group.account._id).lean();
      const outcome = await billAccount(account, group.companies, { now, by });
      if (outcome) billed.push(outcome);
    } catch (error) {
      // One customer's problem must not stop everyone else being billed.
      console.log(`[billing] ${group.account.name} failed:`, error?.message);
      failed.push({ account: group.account.name, reason: error?.message });
    }
  }
  const locks = await syncPaymentLocks({ now, accountId });
  return { enabled: true, billed, failed, locks };
}

/**
 * What a run would bill today, without billing anything — for the console to
 * show before the switch is turned on, and before "Bill now".
 */
export async function previewSubscriptionBilling({ now = new Date(), accountId } = {}) {
  await connect();
  const pricing = await loadPricing();
  const out = [];
  for (const group of await dueByAccount(now, accountId, { create: false })) {
    const companies = [];
    let net = 0;
    for (const company of group.companies) {
      const { from, to } = periodFor(company, now);
      const { result } = await quoteCompany(company, {
        pricing,
        account: group.account._id ? group.account : null,
      });
      net += result.periodNetPence;
      companies.push({
        name: company.name,
        from,
        to,
        cycle: result.cycle,
        netPence: result.periodNetPence,
      });
    }
    out.push({
      account: group.account.name,
      accountId: group.account._id ? String(group.account._id) : null,
      paymentMethod:
        group.account.paymentMethod === "card" && group.account.card?.paymentMethodId
          ? `card ending ${group.account.card.last4}`
          : "invoice",
      companies,
      netPence: net,
    });
  }
  return out;
}
