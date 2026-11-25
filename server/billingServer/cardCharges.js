import { connect } from "@/db/db";
import { allowWrite, escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { emailButton, escapeHtml, renderBrandedEmail } from "@/lib/emailTemplate";
import { formatMoney, outstanding } from "@/lib/money";
import { MAX_CHARGE_ATTEMPTS, retryDue } from "@/lib/billing";
import BillingAccountModel from "@/models/billingAccountModel";
import CompanyModel from "@/models/companyModel";
import InvoiceModel from "@/models/invoiceModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { sendMail } from "@/server/nodeMailerServer/nodemailerServer";
import { callStripe, secretKey } from "./stripeCore";
import { creditInvoice } from "./stripeWebhook";

/**
 * Charging a customer's saved card for a plan bill — the first time, the
 * retries after a decline, and straight away when a new card is saved.
 *
 * Every attempt is recorded on the invoice (chargeAttempts), and each one has
 * its own idempotency key: the same attempt sent twice is one charge, while a
 * retry days later is genuinely a new one.
 *
 * Retries follow lib/billing.js: three and five days after the first
 * failure, then no more. The customer is emailed after the first failure
 * and after the last — not after each retry in between, which would be the
 * same news three times.
 *
 * NOT "use server".
 */

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

/** Who reads the bill: the account's billing email, else the main company's owners. */
export async function billRecipients(account) {
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

export async function emailAccount(account, { subject, heading, html }) {
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

function declineReason(error) {
  const s = error?.stripe;
  if (s?.code === "authentication_required") return "your bank asked you to confirm the payment";
  if (s?.decline_code) return `the card was declined (${s.decline_code.replace(/_/g, " ")})`;
  return error?.message || "the payment failed";
}

/**
 * Try the account's saved card for what an invoice still owes.
 *
 * @param {object} account
 * @param {object} invoice
 * @param {{ kind?: "first"|"retry"|"new card", now?: Date }} [o]
 * @returns {Promise<{ charged: boolean, reason?: string, reference?: string }>}
 */
export async function chargeInvoice(account, invoice, { kind = "first", now = new Date() } = {}) {
  const owed = outstanding(invoice.grossPence, invoice.payments);
  if (owed <= 0) return { charged: false, reason: "nothing owed" };

  const attempt = (invoice.chargeAttempts?.length || 0) + 1;
  const record = (entry) =>
    escapeTenant("billing: record a charge attempt", () =>
      InvoiceModel.updateOne(
        { _id: invoice._id },
        // The run's date, not the clock's: retries are timed from it.
        { $push: { chargeAttempts: { at: now, kind, ...entry } } }
      )
    );

  const fail = async (reason) => {
    await record({ ok: false, reason });
    await BillingAccountModel.updateOne(
      { _id: account._id },
      { $set: { cardFailedAt: new Date(), cardFailure: reason } }
    );
    // Told after the first failure and after the last; the retries between
    // are quiet. A new card that fails is said so on the screen they are on.
    const last = attempt >= MAX_CHARGE_ATTEMPTS;
    if (kind === "first" || (kind === "retry" && last)) {
      await emailAccount(account, {
        subject: last
          ? `We still could not take payment for ${invoice.number}`
          : `We could not take payment for ${invoice.number}`,
        heading: "Your card payment did not go through",
        html:
          `<p>We tried to take ${escapeHtml(formatMoney(owed, invoice.currency))} for invoice ` +
          `${escapeHtml(invoice.number)} from your saved card, and it did not go through: ` +
          `${escapeHtml(reason)}.</p>` +
          (last
            ? `<p>We have tried ${MAX_CHARGE_ATTEMPTS} times and will not try again. Please pay it, ` +
              `or add a new card, on Plan &amp; Billing — a new card is charged for it straight away.</p>`
            : `<p>We will try the card again in a few days. To settle it now, pay it or add a new ` +
              `card on Plan &amp; Billing. Everything keeps working meanwhile.</p>`),
      });
    }
    return { charged: false, reason };
  };

  const key = await secretKey();
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
      // One key per attempt: the same attempt sent twice is one charge; a
      // retry days later is a new one.
      { idempotencyKey: attempt === 1 ? `bill-${invoice._id}` : `bill-${invoice._id}-${attempt}` }
    );

    if (intent?.status !== "succeeded") {
      return fail(
        intent?.status === "requires_action"
          ? "your bank asked you to confirm the payment"
          : `the payment is ${intent?.status || "not complete"}`
      );
    }

    await record({ ok: true, reference: intent.id });
    await creditInvoice({
      invoiceId: String(invoice._id),
      amountPence: intent.amount_received ?? owed,
      reference: intent.id,
      eventId: kind === "first" ? "billing run" : kind,
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
    return fail(declineReason(error));
  }
}

/** An account's plan bills that still owe money, oldest first. */
async function unpaidBills(accountId) {
  const invoices = await escapeTenant("billing: unpaid plan bills", () =>
    InvoiceModel.find({
      source: "subscription",
      accountId,
      status: { $in: ["issued", "part-paid"] },
    })
      .sort({ issuedAt: 1 })
      .lean()
  );
  return invoices.filter((inv) => outstanding(inv.grossPence, inv.payments) > 0);
}

/**
 * Retry declined cards whose retry day has come (lib/billing.js retryDue).
 * Only for accounts still paying by a saved card.
 *
 * @returns {Promise<Array<{ invoice: string, charged: boolean, reason?: string }>>}
 */
export async function retryDeclinedCharges({ now = new Date(), accountId } = {}) {
  await connect();
  const invoices = await escapeTenant("billing: declined plan bills", () =>
    InvoiceModel.find({
      source: "subscription",
      status: { $in: ["issued", "part-paid"] },
      "chargeAttempts.0": { $exists: true },
      ...(accountId ? { accountId } : {}),
    }).lean()
  );

  const out = [];
  for (const invoice of invoices) {
    if (outstanding(invoice.grossPence, invoice.payments) <= 0) continue;
    if (!retryDue(invoice.chargeAttempts, now)) continue;
    const account = await BillingAccountModel.findById(invoice.accountId).lean();
    if (account?.paymentMethod !== "card" || !account.card?.paymentMethodId) continue;
    const result = await chargeInvoice(account, invoice, { kind: "retry", now });
    out.push({ invoice: invoice.number, ...result });
  }
  return out;
}

/**
 * A card has just been saved: charge it for every plan bill the account still
 * owes. Paying them lifts any lock they caused (via creditInvoice).
 *
 * Allowed to write while the company is read-only or locked for an unpaid
 * bill — paying is how they get out. Only invoices and the account, nothing
 * of the company's own.
 *
 * @returns {Promise<Array<{ invoice: string, charged: boolean, reason?: string }>>}
 */
export async function chargeOutstanding(accountId) {
  return allowWrite("paying a bill with a newly saved card", async () => {
    await connect();
    const out = [];
    for (const invoice of await unpaidBills(accountId)) {
      // Re-read each time: the last charge changed the card's failure state.
      const account = await BillingAccountModel.findById(accountId).lean();
      if (!account?.card?.paymentMethodId) break;
      const result = await chargeInvoice(account, invoice, { kind: "new card" });
      out.push({ invoice: invoice.number, ...result });
      // A card that has just failed will fail the next bill too.
      if (!result.charged) break;
    }
    return out;
  });
}
