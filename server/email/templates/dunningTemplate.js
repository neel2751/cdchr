import { formatMoney } from "@/lib/money";

/**
 * Subject and body for one payment reminder.
 *
 * The tone escalates with the stage, and that escalation is the substance
 * rather than decoration. A courtesy note three days before the due date and a
 * final reminder a month after it are different messages to different people:
 * the first is usually to somebody who has forgotten, and treating them like a
 * debtor is how a good customer becomes a difficult one.
 *
 * Nothing here threatens anything. Software should not invent consequences —
 * interest, legal action, suspended accounts — that a person has not decided
 * on, and a template that does is one somebody has to apologise for.
 */
export function dunningTemplate({
  stage,
  invoiceNumber,
  companyName,
  outstandingPence,
  currency = "GBP",
  dueAt,
  daysPastDue,
  sellerName,
  bankDetails,
  payUrl,
}) {
  const amount = formatMoney(outstandingPence, currency);
  const due = dueAt ? new Date(dueAt).toLocaleDateString("en-GB") : "";

  const opening = {
    "due-soon": `This is a friendly reminder that invoice ${invoiceNumber} for ${amount} is due on ${due}.`,
    due: `Invoice ${invoiceNumber} for ${amount} is due today.`,
    "overdue-7": `Invoice ${invoiceNumber} for ${amount} was due on ${due} and is now a week overdue.`,
    "overdue-14": `Invoice ${invoiceNumber} for ${amount} was due on ${due} and is now two weeks overdue.`,
    final: `Invoice ${invoiceNumber} for ${amount} was due on ${due}, ${daysPastDue} days ago.`,
  }[stage];

  const closing = {
    "due-soon": "No action is needed if payment is already on its way.",
    due: "If it has already been paid, please ignore this.",
    "overdue-7":
      "If it has already been paid, please ignore this — otherwise we would be grateful for payment.",
    "overdue-14":
      "If there is a problem with this invoice, please reply and tell us — we would rather know.",
    final:
      "This is the last automatic reminder we will send. If payment is not " +
      "on its way, please reply so we can sort it out between us.",
  }[stage];

  const subject = {
    "due-soon": `${invoiceNumber} is due shortly`,
    due: `${invoiceNumber} is due today`,
    "overdue-7": `${invoiceNumber} is overdue`,
    "overdue-14": `${invoiceNumber} is two weeks overdue`,
    final: `${invoiceNumber} — final reminder`,
  }[stage];

  const html = `
    <p>Hello${companyName ? ` ${escapeHtml(companyName)}` : ""},</p>
    <p>${escapeHtml(opening || `Invoice ${invoiceNumber} for ${amount} is outstanding.`)}</p>
    ${
      payUrl
        ? `<p><a href="${escapeHtml(payUrl)}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">Pay ${escapeHtml(amount)} by card</a></p>`
        : ""
    }
    ${
      bankDetails
        ? `<p>Or by bank transfer:</p><p style="white-space:pre-line">${escapeHtml(bankDetails)}</p>`
        : ""
    }
    <p>${escapeHtml(closing || "")}</p>
    <p>Thank you,<br>${escapeHtml(sellerName || "")}</p>
  `;

  return { subject: subject || `${invoiceNumber} is outstanding`, html };
}

/**
 * A company name, a bank block and an amount all end up in this HTML, and none
 * of them is ours. Escaping is cheap insurance against a stray angle bracket
 * breaking the layout, or worse.
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
