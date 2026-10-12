import { emailButton } from "@/lib/emailTemplate";

/**
 * Subject and body for an order we cancelled ourselves.
 *
 * Only for the operator's cancellation. A customer who cancels their own order
 * does not need an email telling them what they just did.
 *
 * The reason is the substance of this message, so it is quoted rather than
 * summarised, and it is quoted as ours: somebody on our side typed it, and
 * paraphrasing it into softer language would make the sentence the customer
 * reads something nobody actually decided.
 *
 * Nothing here says anything about money. Billing for tags happens outside the
 * app (see the note at the top of server/tagServer/orders.js), so a template
 * that promised a refund would be inventing a process — and one that mentioned
 * a charge would be alarming for an order that was never fulfilled. What the
 * customer needs to know is that it is not coming and why, and who to talk to.
 */
export function tagOrderCancelledTemplate({
  orderNumber,
  items = [],
  reason,
  companyName,
  orderUrl,
  supportEmail,
}) {
  const lines = items
    .map((item) => `${item.quantity} × ${item.productName || item.productSku}`)
    .join(", ");

  const what = lines ? `<p>The order was for ${lines}.</p>` : "";

  // Only offered when we know where their workspace lives. A button to a host
  // we had to guess is worse than no button.
  const action = orderUrl
    ? emailButton("Order again", `${orderUrl}/admin/clockSettings`)
    : "";

  const contact = supportEmail
    ? `<p>If you were expecting these, reply to this email or write to
       <a href="mailto:${supportEmail}" style="color:#4f46e5">${supportEmail}</a>
       and we will sort it out.</p>`
    : `<p>If you were expecting these, reply to this email and we will sort it
       out.</p>`;

  return {
    subject: `Tag order ${orderNumber} has been cancelled`,
    heading: "Your tag order has been cancelled",
    html: `
      <p>Hello${companyName ? ` ${companyName}` : ""},</p>
      <p>We have cancelled tag order <strong>${orderNumber}</strong>. Nothing
      has been sent and nothing further will be.</p>
      ${what}
      <p><strong>Why:</strong> ${reason}</p>
      ${contact}
      ${action}`,
  };
}
