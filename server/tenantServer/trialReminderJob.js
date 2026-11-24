import { connect } from "@/db/db";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { emailButton, escapeHtml, renderBrandedEmail } from "@/lib/emailTemplate";
import { companyAccess, describeAccess, dueTrialReminder } from "@/lib/tenantAccess";
import CompanyModel from "@/models/companyModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { sendMail } from "@/server/nodeMailerServer/nodemailerServer";

/**
 * Telling a company's owner their free trial is ending, has ended, and what
 * that now means (lib/tenantAccess.js): a week before, three days, the day
 * before, the day it ends, the day it becomes read-only, the day it locks.
 *
 * Context-free — no next/headers, no session — so it runs from the cron route
 * like the dunning job, and shares its two rules:
 *
 *   ONE EMAIL PER STAGE, EVER. The stage is recorded on the company BEFORE the
 *   email goes, guarded on it not being there, so two overlapping runs send
 *   one email. The worst case is a recorded reminder that failed to send.
 *
 *   ONLY THE LATEST STAGE. A run that missed a week sends where the company
 *   stands now, not four emails at once.
 *
 * Sent from our own mailbox, not the company's: this is us writing to them.
 */

function platformMailer() {
  const host = process.env.EMAIL_HOST;
  const userName = process.env.EMAIL_USERNAME;
  const password = process.env.EMAIL_PASSWORD;
  if (!host || !userName || !password) return null;
  return { host, userName, password, port: Number(process.env.EMAIL_PORT) || 587 };
}

const SUBJECTS = {
  "7d": "Your free trial ends in a week",
  "3d": "Your free trial ends in 3 days",
  "1d": "Your free trial ends tomorrow",
  ended: "Your free trial has ended",
  readOnly: "Your account is now read-only",
  locked: "Your account is now paused",
};

function appUrl(company) {
  const root = process.env.PLATFORM_ROOT_DOMAIN;
  if (root && company.slug) return `https://${company.slug}.${root}`;
  return process.env.NEXTAUTH_URL || "";
}

/** The owners to write to: the company's super admins. */
async function ownersOf(tenantId) {
  return runWithTenant(String(tenantId), () =>
    OfficeEmployeeModel.find({
      isSuperAdmin: true,
      delete: { $ne: true },
      isActive: { $ne: false },
      email: { $nin: [null, ""] },
    })
      .select("email name firstName")
      .lean()
  );
}

async function remindOne(company, stage, mailer) {
  const claimed = await CompanyModel.updateOne(
    { _id: company._id, "billing.trialReminders": { $ne: stage } },
    { $push: { "billing.trialReminders": stage } }
  );
  if (!claimed.modifiedCount) return { sent: 0, reason: "already sent" };

  const owners = await ownersOf(company._id);
  if (!owners.length) return { sent: 0, reason: "no super admin with an email" };

  const access = companyAccess(company);
  const url = appUrl(company);
  const contact = process.env.PLATFORM_SUPPORT_EMAIL || "";
  const subject = SUBJECTS[stage];
  const body =
    `<p>${escapeHtml(describeAccess(access, { owner: true }))}</p>` +
    (stage === "readOnly" || stage === "locked"
      ? "<p>Nothing has been deleted. Everything comes back as soon as you choose a plan.</p>"
      : "<p>Choose a plan to keep everything running without a break.</p>") +
    (contact
      ? `<p>Reply to this email, or write to <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a>, and we will set you up.</p>`
      : "") +
    (url ? emailButton("Open your account", url) : "");

  let sent = 0;
  for (const owner of owners) {
    const html = renderBrandedEmail({
      branding: { supportEmail: contact },
      companyName: "",
      appUrl: url,
      heading: subject,
      html: `<p>Hello ${escapeHtml(owner.name || owner.firstName || "")},</p>${body}`,
    });
    const result = await sendMail({
      ...mailer,
      fromName: process.env.PLATFORM_APP_NAME || "Accounts",
      toEmail: owner.email,
      subject: `${subject} — ${company.name}`,
      html,
      text: `${subject}. ${describeAccess(access, { owner: true })}`,
    });
    if (result?.success) sent += 1;
  }

  await logAuditDirect({
    action: "Tenant.trialReminder",
    module: "Tenant",
    entityId: String(company._id),
    tenantId: company._id,
    status: sent ? "success" : "failure",
    description: `Trial reminder "${stage}" to ${owners.length} owner(s), ${sent} sent`,
    actor: { name: "Trial reminder job", role: "system" },
  }).catch(() => {});

  return { sent };
}

/**
 * Every company on a trial with an end date, reminded where one is due.
 *
 * Runs across companies on purpose — the trials are ours to end — through
 * escapeTenant rather than by accident.
 */
export async function runTrialReminderJob({ now = new Date() } = {}) {
  await connect();
  const mailer = platformMailer();
  if (!mailer) return { considered: 0, sent: 0, skipped: "no platform mailbox" };

  const companies = await escapeTenant("trial reminders: companies on trial", () =>
    CompanyModel.find({
      status: "trial",
      delete: { $ne: true },
      "billing.trialEndsAt": { $ne: null },
      "billing.lock": { $exists: false },
    })
      .select("name slug status delete billing")
      .lean()
  );

  const results = { considered: companies.length, sent: 0, failed: [] };
  for (const company of companies) {
    try {
      const stage = dueTrialReminder(
        companyAccess(company, now),
        company.billing?.trialReminders || []
      );
      if (!stage) continue;
      const outcome = await remindOne(company, stage, mailer);
      results.sent += outcome.sent || 0;
      if (!outcome.sent && outcome.reason !== "already sent") {
        results.failed.push({ company: company.name, stage, reason: outcome.reason });
      }
    } catch (error) {
      // One company's bad data must not stop the rest being told.
      console.error(`[trial-reminders] ${company.name} failed:`, error?.message);
      results.failed.push({ company: company.name, reason: error?.message });
    }
  }
  return results;
}
