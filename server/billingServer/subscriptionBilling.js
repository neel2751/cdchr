import { connect } from "@/db/db";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { escapeHtml } from "@/lib/emailTemplate";
import { formatMoney, totalLines } from "@/lib/money";
import { addPeriod, dayStart, invoiceLinesFor } from "@/lib/billing";
import BillingAccountModel from "@/models/billingAccountModel";
import CompanyModel from "@/models/companyModel";
import InvoiceModel from "@/models/invoiceModel";
import { ensureAccount, quoteCompany } from "./accountStore";
import { allocateNumber, sellerDetails } from "./invoiceCore";
import { syncPaymentLocks } from "./paymentLocks";
import { loadPricing } from "./pricingStore";
import {
  billRecipients,
  chargeInvoice,
  emailAccount,
  retryDeclinedCharges,
} from "./cardCharges";

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
 *             emailed, the invoice is due today, and the card is tried
 *             again 3 and 5 days later (cardCharges.js).
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
    payment = await chargeInvoice(account, invoice, { now });
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
  // Declined cards whose retry day has come (cardCharges.js).
  const retried = await retryDeclinedCharges({ now, accountId }).catch((error) => {
    console.log("[billing] retries failed:", error?.message);
    return [];
  });
  const locks = await syncPaymentLocks({ now, accountId });
  return { enabled: true, billed, failed, retried, locks };
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
