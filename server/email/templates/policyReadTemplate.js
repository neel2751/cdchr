import { emailButton, escapeHtml } from "@/lib/emailTemplate";

const formatDay = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

/**
 * Asking a member of staff to read a policy.
 *
 * The link goes to their Company Policies page, not to the file: opening it
 * there is what records that they have, and it is where the "I have read and
 * understood" button is. A direct file link would be read and never counted.
 *
 * Body only; sendTenantMail wraps it in the company's branding.
 */
export function policyReadTemplate({
  title,
  summary,
  categoryName,
  versionNumber,
  changeNote,
  effectiveDate,
  requireAck,
  link,
}) {
  const subject = requireAck
    ? `Please read and confirm: ${title}`
    : `Please read: ${title}`;

  const html = `
    <p>Hello,</p>
    <p>Please read the <strong>${escapeHtml(title)}</strong> policy${categoryName ? ` (${escapeHtml(categoryName)})` : ""}${
      versionNumber > 1 ? `, which has been updated to version ${escapeHtml(versionNumber)}` : ""
    }.</p>
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
    ${changeNote ? `<p><strong>What changed:</strong> ${escapeHtml(changeNote)}</p>` : ""}
    ${effectiveDate ? `<p>It is in force from ${escapeHtml(formatDay(effectiveDate))}.</p>` : ""}
    ${
      requireAck
        ? "<p>Once you have read it, confirm in the app that you have read and understood it.</p>"
        : ""
    }
    ${emailButton("Read the policy", link)}`;

  return { subject, heading: requireAck ? "Please read and confirm" : "Please read", html };
}
