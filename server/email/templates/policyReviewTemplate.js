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
 * The reminder that a policy is coming up for review.
 *
 * Says what to do in both cases — still right, or needs changing — because
 * the owner's usual question on opening it is "what does it want from me?",
 * and the answer for most reviews is one button.
 *
 * Body only: sendTenantMail wraps it in the company's branded shell, with
 * `heading` as its title.
 *
 * @param {object} p
 * @param {string} p.milestone      from reviewMilestone() in lib/policies.js
 * @param {number} p.daysUntilDue   negative when overdue
 * @param {boolean} p.toOwner       false when it went to the HR mailbox instead
 */
export function policyReviewTemplate({
  milestone,
  daysUntilDue,
  title,
  categoryName,
  dueDate,
  versionNumber,
  publishedAt,
  lastReviewedAt,
  lastReviewedByName,
  recipientName,
  toOwner,
  link,
}) {
  const due = formatDay(dueDate);
  const overdueDays = -daysUntilDue;

  const subject =
    milestone === "30_days" || milestone === "7_days"
      ? `Policy review due ${due}: ${title}`
      : daysUntilDue === 0
        ? `Policy review due today: ${title}`
        : `Policy review overdue: ${title}`;

  const when =
    daysUntilDue > 0
      ? `is due for review on <strong>${escapeHtml(due)}</strong>, in ${daysUntilDue} ${daysUntilDue === 1 ? "day" : "days"}`
      : daysUntilDue === 0
        ? "is due for review <strong>today</strong>"
        : `was due for review on <strong>${escapeHtml(due)}</strong> and is ${overdueDays} ${overdueDays === 1 ? "day" : "days"} overdue`;

  const history = lastReviewedAt
    ? `It was last reviewed on ${escapeHtml(formatDay(lastReviewedAt))}${lastReviewedByName ? ` by ${escapeHtml(lastReviewedByName)}` : ""}.`
    : "It has not been reviewed since it was published.";

  const firstName = String(recipientName || "").split(" ")[0];

  const html = `
    <p>Hello${firstName ? ` ${escapeHtml(firstName)}` : ""},</p>
    <p>The <strong>${escapeHtml(title)}</strong> policy${categoryName ? ` (${escapeHtml(categoryName)})` : ""} ${when}.</p>
    <p>Version ${escapeHtml(versionNumber)} has been in force since ${escapeHtml(formatDay(publishedAt))}. ${history}</p>
    <p>If it still says the right thing, open it and mark it as reviewed. If something needs to change, upload a new version — publishing it counts as the review.</p>
    ${emailButton("Review the policy", link)}
    <p style="font-size:12px;color:#71717a;">${
      toOwner
        ? "You are receiving this because you are this policy's owner."
        : "This policy has no owner, so the reminder has come to this mailbox. Setting an owner on the policy sends future reminders to them."
    }</p>`;

  return { subject, heading: "Policy review", html };
}
