import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { formatMoney, outstanding } from "@/lib/money";
import { dueReminder, findStage } from "@/lib/dunning";
import InvoiceModel from "@/models/invoiceModel";
import PlatformSettingModel from "@/models/platformSettingModel";
import { dunningTemplate } from "@/server/email/templates/dunningTemplate";
import { sendMail } from "@/server/nodeMailerServer/nodemailerServer";

/**
 * Chasing unpaid invoices.
 *
 * Context-free — no next/headers, no next-auth — so it runs from the cron
 * route, the same shape as the visa and shift-close jobs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS SENDS EMAIL TO REAL CUSTOMERS WITH NOBODY IN THE LOOP.
 *
 * Which is why it is off until somebody turns it on, why every stage sends
 * exactly once, and why the ladder ends. The failure mode that matters here is
 * not a missed reminder — it is thirty identical emails to a good customer who
 * is a fortnight late, and the relationship that breaks is not recoverable by
 * fixing the code afterwards.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * The platform's own sender.
 *
 * Deliberately NOT the tenant's mailbox: this is us writing to them about
 * money they owe us. Sending it from their own branded mailbox would be a
 * customer receiving a chase apparently from themselves.
 */
function platformMailer() {
  const host = process.env.EMAIL_HOST;
  const userName = process.env.EMAIL_USERNAME;
  const password = process.env.EMAIL_PASSWORD;
  if (!host || !userName || !password) return null;
  return { host, userName, password, port: Number(process.env.EMAIL_PORT) || 587 };
}

/**
 * Send one reminder and record it.
 *
 * The record is written FIRST, guarded on that stage not already being
 * present. Two overlapping runs then produce one email rather than two, and
 * the worst case is a recorded reminder that failed to send — which is visible
 * on the invoice and fixable, where the other way round is a customer with two
 * copies and no way to tell it happened.
 */
async function sendReminder({ invoice, stage, settings, by = "cron", payUrl }) {
  const owed = outstanding(invoice.grossPence, invoice.payments);
  const to = invoice.buyer?.email;

  const claimed = await escapeTenant("dunning: claim a stage", () =>
    InvoiceModel.updateOne(
      { _id: invoice._id, "reminders.stage": { $ne: stage.key } },
      {
        $push: {
          reminders: { stage: stage.key, sentAt: new Date(), to, by },
        },
      },
    ),
  );
  if (!claimed.modifiedCount) {
    return { sent: false, reason: "already sent by another run" };
  }

  const mailer = platformMailer();
  if (!mailer) {
    return { sent: false, reason: "no platform mailbox is configured" };
  }

  const { subject, html } = dunningTemplate({
    stage: stage.key,
    invoiceNumber: invoice.number,
    companyName: invoice.buyer?.name,
    outstandingPence: owed,
    currency: invoice.currency,
    dueAt: invoice.dueAt,
    daysPastDue: Math.max(
      0,
      Math.floor((Date.now() - new Date(invoice.dueAt).getTime()) / 86400000),
    ),
    sellerName: invoice.seller?.name || settings?.billingName,
    bankDetails: settings?.bankDetails,
    payUrl,
  });

  const result = await sendMail({
    ...mailer,
    fromName: invoice.seller?.name || settings?.billingName || "Accounts",
    toEmail: to,
    subject,
    html,
    text: subject,
  });

  await logAuditDirect({
    action: "Invoice.reminderSent",
    module: "Invoice",
    entityId: String(invoice._id),
    tenantId: invoice.tenantId,
    status: result?.success ? "success" : "failure",
    description:
      `${stage.label} for ${invoice.number} (${formatMoney(owed, invoice.currency)}) ` +
      `to ${to}${result?.success ? "" : " — send failed"}`,
    actor: { name: by === "cron" ? "Dunning job" : by, role: "system" },
  }).catch(() => {});

  return {
    sent: Boolean(result?.success),
    stage: stage.key,
    to,
    reason: result?.success ? undefined : result?.message || "send failed",
  };
}

/**
 * Every invoice that is owed, chased where one is due.
 *
 * Runs across tenants deliberately — the debts are ours to collect — through
 * escapeTenant rather than by accident.
 */
export async function runDunningJob({ force = false } = {}) {
  await connect();

  const settings = await escapeTenant("dunning: settings", () =>
    PlatformSettingModel.findOne({ singleton: "only" }).lean(),
  );

  // `force` exists for a manual "send now", which is a person deciding. The
  // automatic path needs the switch.
  if (!settings?.dunningEnabled && !force) {
    return { enabled: false, considered: 0, sent: 0, skipped: [] };
  }

  const candidates = await escapeTenant("dunning: find what is owed", () =>
    InvoiceModel.find({
      kind: "invoice",
      status: { $in: ["issued", "part-paid"] },
      chaseDisabled: { $ne: true },
      dueAt: { $ne: null },
    })
      .sort({ dueAt: 1 })
      .limit(500)
      .lean(),
  );

  const results = { enabled: true, considered: candidates.length, sent: 0, failed: 0, skipped: [] };

  for (const invoice of candidates) {
    try {
      const stage = dueReminder(invoice);
      if (!stage) continue;

      const outcome = await sendReminder({ invoice, stage, settings });
      if (outcome.sent) results.sent += 1;
      else {
        results.failed += 1;
        results.skipped.push({
          number: invoice.number,
          stage: stage.key,
          reason: outcome.reason,
        });
      }
    } catch (error) {
      // One bad invoice must not stop the rest — the next one might be the
      // only debt that matters this month.
      console.error(
        `[dunning] ${invoice.number} failed:`,
        error?.message,
      );
      results.failed += 1;
      results.skipped.push({ number: invoice.number, reason: error?.message });
    }
  }

  return results;
}

/** Chase one invoice now, because a person said so. Exported for the action. */
export async function sendReminderNow({ invoice, stageKey, by, payUrl }) {
  const stage = findStage(stageKey) || dueReminder(invoice);
  if (!stage) return { sent: false, reason: "no reminder is due" };

  const settings = await escapeTenant("dunning: settings", () =>
    PlatformSettingModel.findOne({ singleton: "only" }).lean(),
  );
  return sendReminder({ invoice, stage, settings, by, payUrl });
}
