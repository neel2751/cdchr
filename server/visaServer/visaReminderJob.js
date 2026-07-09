// Context-free visa-reminder engine: no next/headers and no next-auth, so it
// can run from the cron API route as well as from the manual server action.
// All sends are recorded to the AuditLog (module "Visa") and are idempotent
// per (employee, visaEndDate, milestone) via the dedupe check below.

import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import CompanyModel from "@/models/companyModel";
import AuditLogModel from "@/models/auditLogModel";
import { getSMTPForFeature } from "@/server/email/emailSMTP";
import { sendMail } from "@/server/nodeMailerServer/nodemailerServer";
import { visaReminderTemplate } from "@/server/email/templates/visaReminderTemplate";
import { logAuditDirect } from "@/lib/audit";
import {
  MILESTONE_WINDOW_DAYS,
  daysUntil,
  getMilestone,
  milestoneLabel,
} from "@/lib/visaMilestones";

// How many times HR may manually resend a reminder for the same
// (employee, visaEndDate, milestone). The automated cron always sends once.
export const MAX_MANUAL_SENDS = 3;

// employeeType -> visa date field on the model
const VISA_FIELD = { OfficeEmploye: "visaEndDate", Employe: "eVisaExp" };

// Resolve the company name for an office employee (field staff have none).
async function getCompanyName(employee, employeeType) {
  if (employeeType !== "OfficeEmploye" || !employee?.company) return undefined;
  try {
    const company = await CompanyModel.findById(employee.company)
      .select("name")
      .lean();
    return company?.name || undefined;
  } catch {
    return undefined;
  }
}

// Number of successful reminders already sent for this exact
// (employee, visaEndDate, milestone).
export async function getVisaReminderSentCount({
  employeeId,
  visaEndDateISO,
  milestone,
}) {
  return AuditLogModel.countDocuments({
    module: "Visa",
    action: "Visa.reminderSent",
    status: "success",
    entityId: employeeId,
    "metadata.milestone": milestone,
    "metadata.visaEndDate": visaEndDateISO,
  });
}

/**
 * Send (or skip) a single visa reminder and record the outcome.
 *
 * @param {Object} p
 * @param {Object} p.employee       Lean employee document
 * @param {"OfficeEmploye"|"Employe"} p.employeeType
 * @param {string} p.milestone      Milestone key (or "expired")
 * @param {{_id?:string,name?:string,email?:string,role?:string,system?:boolean}} p.actor
 * @param {"manual"|"auto"} p.channel
 * @param {boolean} [p.force]       Bypass the dedupe check (manual resend)
 */
export async function sendVisaReminderCore({
  employee,
  employeeType,
  milestone,
  actor,
  channel,
  force = false,
  ccHr = false,
}) {
  await connect();

  const visaField = VISA_FIELD[employeeType];
  const visaEndDate = employee?.[visaField];
  const name = employee?.name || employee?.firstName || "Colleague";
  const toEmail = employee?.email;

  if (!visaEndDate)
    return { success: false, message: "No visa date on record" };
  if (!toEmail) return { success: false, message: "Employee has no email" };
  if (!milestone)
    return { success: false, message: "Not within a reminder window" };

  const visaEndDateISO = new Date(visaEndDate).toISOString();

  const sentCount = await getVisaReminderSentCount({
    employeeId: employee._id,
    visaEndDateISO,
    milestone,
  });

  if (!force) {
    // Automated cron stays idempotent — one send per milestone.
    if (channel === "auto" && sentCount >= 1) {
      return {
        success: false,
        duplicate: true,
        sentCount,
        message: "Reminder already sent for this milestone",
      };
    }
    // HR may manually resend up to MAX_MANUAL_SENDS times per milestone.
    if (channel === "manual" && sentCount >= MAX_MANUAL_SENDS) {
      return {
        success: false,
        limitReached: true,
        sentCount,
        maxSends: MAX_MANUAL_SENDS,
        message: `Already sent ${sentCount} times for the ${milestoneLabel(
          milestone,
        )} reminder (maximum ${MAX_MANUAL_SENDS}).`,
      };
    }
  }

  const days = daysUntil(visaEndDate);
  const companyName = await getCompanyName(employee, employeeType);
  const { subject, html } = visaReminderTemplate({
    name,
    visaEndDate,
    daysRemaining: days,
    milestone,
    companyName,
  });

  const smtpRes = await getSMTPForFeature("HR");
  if (!smtpRes?.success) {
    await logAuditDirect({
      actor,
      action: "Visa.reminderSent",
      module: "Visa",
      entityId: employee._id,
      description: `Failed to send ${milestone} visa reminder to ${name} (no HR email account)`,
      status: "failure",
      errorMessage: smtpRes?.message || "No HR SMTP configured",
      metadata: {
        milestone,
        visaEndDate: visaEndDateISO,
        channel,
        toEmail,
        employeeType,
      },
    });
    return { success: false, message: "No HR email account configured" };
  }

  const smtp = JSON.parse(smtpRes.data);
  // Copy to HR's mailbox (the email account's own address). Opt-in for manual
  // sends (admin ticks the box); always copied on the automated cron run.
  const hrEmail = smtp?.toEmail;
  const copyHr = channel === "auto" ? true : Boolean(ccHr);
  const cc = copyHr && hrEmail && hrEmail !== toEmail ? [hrEmail] : [];

  const sendRes = await sendMail({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    userName: smtp.userName,
    password: smtp.password,
    fromName: smtp.fromName || "CDC HR",
    toEmail,
    cc,
    subject,
    html,
  });

  const ok = Boolean(sendRes?.success);
  await logAuditDirect({
    actor,
    action: "Visa.reminderSent",
    module: "Visa",
    entityId: employee._id,
    description: `${ok ? "Sent" : "Failed to send"} ${milestone} visa reminder to ${name} <${toEmail}>`,
    status: ok ? "success" : "failure",
    errorMessage: ok ? undefined : sendRes?.message,
    metadata: {
      milestone,
      visaEndDate: visaEndDateISO,
      channel,
      toEmail,
      cc,
      employeeType,
      daysRemaining: days,
    },
  });

  if (!ok) {
    return { success: false, message: sendRes?.message || "Failed to send email" };
  }

  const nextCount = sentCount + 1;
  return {
    success: true,
    sentCount: nextCount,
    maxSends: MAX_MANUAL_SENDS,
    message:
      channel === "manual"
        ? `Reminder sent — ${nextCount} of ${MAX_MANUAL_SENDS} for the ${milestoneLabel(
            milestone,
          )} reminder.`
        : `Reminder sent (${milestone})`,
  };
}

/**
 * Daily job: scan office + field employees whose visa is within the reminder
 * window (or already expired) and send the current milestone once each.
 * Safe to run repeatedly — dedupe prevents duplicate sends.
 */
export async function runVisaReminderJob() {
  await connect();
  const results = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  const upper = new Date();
  upper.setDate(upper.getDate() + MILESTONE_WINDOW_DAYS);

  const [office, field] = await Promise.all([
    OfficeEmployeeModel.find({
      delete: { $ne: true },
      isActive: true,
      immigrationType: { $ne: "British" },
      visaEndDate: { $ne: null, $lte: upper },
    }).lean(),
    EmployeModel.find({
      delete: { $ne: true },
      isActive: true,
      immigrationType: { $ne: "British" },
      eVisaExp: { $ne: null, $lte: upper },
    }).lean(),
  ]);

  const batches = [
    { list: office, type: "OfficeEmploye", field: "visaEndDate" },
    { list: field, type: "Employe", field: "eVisaExp" },
  ];

  for (const batch of batches) {
    for (const employee of batch.list) {
      const milestone = getMilestone(daysUntil(employee[batch.field]));
      if (!milestone) continue;
      results.processed++;
      const res = await sendVisaReminderCore({
        employee,
        employeeType: batch.type,
        milestone,
        actor: { system: true },
        channel: "auto",
      });
      if (res.success) results.sent++;
      else if (res.duplicate) results.skipped++;
      else results.failed++;
    }
  }

  return results;
}
