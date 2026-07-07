import { format } from "date-fns";
import { formatVisaRemaining } from "@/lib/visaMilestones";

/**
 * Build the subject + HTML body for a visa-expiry reminder email.
 *
 * @param {Object} p
 * @param {string} p.name           Employee name
 * @param {Date|string} p.visaEndDate
 * @param {number} p.daysRemaining  Whole days until expiry (negative if expired)
 * @param {string} p.milestone      Milestone key ("3_months" | ... | "expired")
 * @param {string} [p.companyName]  Employee's company (shown in the email)
 * @returns {{ subject: string, html: string }}
 */
export function visaReminderTemplate({
  name,
  visaEndDate,
  daysRemaining,
  milestone,
  companyName,
}) {
  const expired = milestone === "expired" || daysRemaining <= 0;
  const prettyDate = visaEndDate
    ? format(new Date(visaEndDate), "PPP")
    : "the recorded date";

  // Use the actual time remaining (e.g. "1 month 5 days") rather than the
  // reminder milestone bucket — a visa ~45 days out sits in the "3 months"
  // bucket, which would otherwise wrongly read "expires in 3 months".
  const remaining = formatVisaRemaining(visaEndDate) || `${daysRemaining} days`;

  const subject = expired
    ? `Urgent: your visa has expired (${prettyDate})`
    : `Action required: your visa expires in ${remaining} on ${prettyDate}`;

  const headline = expired
    ? "Your visa has expired"
    : `Your visa expires in ${remaining}`;

  const body = expired
    ? `<p>Our records show your visa expired on <strong>${prettyDate}</strong>. Please contact the HR team immediately to provide updated documentation.</p>`
    : `<p>This is a reminder that your visa is due to expire on <strong>${prettyDate}</strong> (in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}).</p>
       <p>Please ensure your immigration documents are renewed in good time and share the updated details with the HR team.</p>`;

  const companyLine = companyName
    ? `<p style="margin:4px 0;"><strong>Company:</strong> ${companyName}</p>`
    : "";
  const signature = companyName ? `${companyName} HR` : "HR Management";
  const footerOrg = companyName ? `from ${companyName}` : "from CDC HR";

  const html = `
  <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
    <h2 style="color: ${expired ? "#b91c1c" : "#b45309"}; margin-bottom: 8px;">${headline}</h2>
    <p>Dear ${name || "Colleague"},</p>
    ${companyLine}
    <p style="margin:4px 0;"><strong>Visa expiry date:</strong> ${prettyDate}</p>
    ${body}
    <p style="margin-top: 16px;">If you have already actioned this, please disregard this message.</p>
    <p style="margin-top: 24px;">Kind regards,<br/>${signature}</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
    <p style="font-size:12px;color:#6b7280;">This is an automated compliance reminder ${footerOrg}.</p>
  </div>`;

  return { subject, html };
}
