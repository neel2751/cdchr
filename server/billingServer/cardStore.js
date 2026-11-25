import { connect } from "@/db/db";
import BillingAccountModel from "@/models/billingAccountModel";
import { callStripe, getStripe, secretKey } from "./stripeCore";

/**
 * A customer's saved card, for charging each bill without them doing
 * anything.
 *
 * The card is typed on Stripe's own page (Checkout in "setup" mode) and never
 * reaches us. What we keep is Stripe's id for it, and enough to show which
 * card it is: brand, last four digits, expiry.
 *
 * NOT "use server": these act on any account. cardServer.js checks who asks;
 * the Stripe webhook arrives already verified.
 */

/** The account's Stripe customer, made the first time it is needed. */
export async function ensureStripeCustomer(account, key) {
  if (account.stripeCustomerId) return account.stripeCustomerId;
  const customer = await callStripe(
    "/customers",
    {
      name: account.name,
      ...(account.billingEmail ? { email: account.billingEmail } : {}),
      "metadata[accountId]": String(account._id),
    },
    key,
    { idempotencyKey: `customer-${account._id}` }
  );
  await BillingAccountModel.updateOne(
    { _id: account._id, stripeCustomerId: { $in: [null, undefined] } },
    { $set: { stripeCustomerId: customer.id } }
  );
  const fresh = await BillingAccountModel.findById(account._id).select("stripeCustomerId").lean();
  return fresh?.stripeCustomerId || customer.id;
}

/**
 * A Stripe page to add a card. Returns its URL; the person comes back to
 * `returnUrl` with `?card=done&session_id=…`.
 */
export async function cardSetupSession(account, returnUrl) {
  const key = await secretKey();
  if (!key) throw new Error("Card payment is not switched on yet.");
  const customer = await ensureStripeCustomer(account, key);
  const base = String(returnUrl || "").trim() || "https://example.invalid/admin/plan";
  const join = base.includes("?") ? "&" : "?";
  const session = await callStripe(
    "/checkout/sessions",
    {
      mode: "setup",
      customer,
      "payment_method_types[0]": "card",
      "metadata[accountId]": String(account._id),
      success_url: `${base}${join}card=done&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}${join}card=cancelled`,
    },
    key
  );
  if (!session?.url) throw new Error("Stripe did not return a page to add the card.");
  return session.url;
}

/**
 * Keep the card a finished setup page saved — called when the person comes
 * back, and again by the webhook in case they never do. Doing it twice is
 * harmless.
 *
 * The account is taken from the session's own metadata and checked against
 * the session's customer: a session id from somebody else cannot attach a
 * card to the wrong account.
 *
 * @param {string} sessionId
 * @param {{ expectAccountId?: any }} [o] when the caller knows which account
 *   it should be, a session for any other is refused
 * @returns a sentence saying what happened
 */
export async function saveCardFromSession(sessionId, { expectAccountId } = {}) {
  if (!sessionId) return "no session id";
  const key = await secretKey();
  if (!key) return "card payment is not switched on";
  await connect();

  const session = await getStripe(
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { "expand[]": "setup_intent" },
    key
  );
  if (session?.mode !== "setup") return "not a card setup";
  const accountId = session?.metadata?.accountId;
  if (!accountId) return "no account on the session";
  if (expectAccountId && String(expectAccountId) !== String(accountId)) {
    return "that card page was for another account";
  }
  const account = await BillingAccountModel.findById(accountId).lean();
  if (!account) return "account not found";
  if (account.stripeCustomerId && session.customer && session.customer !== account.stripeCustomerId) {
    return "the session's customer is not this account's";
  }

  const intent = session.setup_intent;
  const methodId = typeof intent === "string" ? null : intent?.payment_method;
  if (!methodId || intent?.status !== "succeeded") return "the card was not saved";
  const pmId = typeof methodId === "string" ? methodId : methodId.id;

  const method = await getStripe(`/payment_methods/${encodeURIComponent(pmId)}`, {}, key);
  const card = method?.card || {};

  // Charged without the customer present from now on, so it becomes the
  // customer's default too.
  await callStripe(
    `/customers/${encodeURIComponent(session.customer || account.stripeCustomerId)}`,
    { "invoice_settings[default_payment_method]": pmId },
    key
  ).catch(() => {});

  await BillingAccountModel.updateOne(
    { _id: account._id },
    {
      $set: {
        paymentMethod: "card",
        card: {
          paymentMethodId: pmId,
          brand: card.brand || "card",
          last4: card.last4 || "",
          expMonth: card.exp_month || null,
          expYear: card.exp_year || null,
          addedAt: new Date(),
        },
        ...(session.customer ? { stripeCustomerId: session.customer } : {}),
      },
      $unset: { cardFailedAt: "", cardFailure: "" },
    }
  );
  return `saved ${card.brand || "card"} ending ${card.last4 || "????"} for ${account.name}`;
}

/** Forget the card — at Stripe too, so it can no longer be charged. */
export async function removeCard(account) {
  const key = await secretKey();
  const pm = account.card?.paymentMethodId;
  if (key && pm) {
    await callStripe(`/payment_methods/${encodeURIComponent(pm)}/detach`, {}, key).catch(
      (error) => console.log("Could not detach the card at Stripe:", error?.message)
    );
  }
  await BillingAccountModel.updateOne(
    { _id: account._id },
    { $set: { paymentMethod: "invoice" }, $unset: { card: "", cardFailedAt: "", cardFailure: "" } }
  );
}
