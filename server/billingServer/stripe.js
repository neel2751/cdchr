"use server";

import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { formatMoney, outstanding } from "@/lib/money";
import { openSecret, sealSecret, secretHint, secretsConfigured } from "@/lib/secretBox";
import CarrierAccountModel from "@/models/carrierAccountModel";
import InvoiceModel from "@/models/invoiceModel";
import { getServerSideProps } from "../session/session";

/**
 * Taking a card payment, without ever touching a card.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE RULE: NO CARD NUMBER REACHES THIS APPLICATION.
 *
 * Not "we are careful with them" — they never arrive. The customer is sent to
 * a Checkout page hosted by Stripe, on Stripe's domain, and types the card
 * there. What comes back here is a session id and later a payment intent id:
 * references, not instruments.
 *
 * That is the whole reason this is Checkout rather than a card form of our
 * own. A form we host puts this application in PCI scope — the audits, the
 * scanning, the liability — for the sake of a nicer-looking page. It is not a
 * trade worth making, and it is not reversible once cards have flowed through
 * a system.
 *
 * So: no card fields anywhere, no card data stored, and nothing in this file
 * that could start doing either.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Verified against the live API as far as a key allows: the endpoint, that
 * authentication is a Bearer secret key, and the `{error:{message,type}}`
 * shape of a refusal. A successful session was not seen — that needs a real
 * key — so the success path is written to Stripe's documentation.
 *
 * Credentials live in CarrierAccountModel under the provider key "stripe".
 * Reusing that collection rather than adding a third one of the same shape:
 * it already means "a platform-held account, sealed", which is exactly what
 * this is.
 */

const STRIPE_PROVIDER = "stripe";
const API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 15000;

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { ok: false, message: "Not signed in" };
  if (user.role !== "platformAdmin") {
    return { ok: false, message: "Not authorized" };
  }
  return { ok: true, user };
}

async function secretKey() {
  const account = await escapeTenant("stripe: account", () =>
    CarrierAccountModel.findOne({ provider: STRIPE_PROVIDER }).lean(),
  );
  if (!account?.isEnabled) return null;

  const raw =
    account.credentials instanceof Map
      ? Object.fromEntries(account.credentials)
      : account.credentials || {};
  return raw.secretKey ? openSecret(raw.secretKey) : null;
}

/** Stripe wants form encoding, including for nested fields. */
function formBody(params) {
  return new URLSearchParams(params).toString();
}

async function callStripe(path, params, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody(params),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      // Stripe's own message names the field that was wrong, which is more
      // use than anything we could write.
      throw new Error(payload?.error?.message || `Stripe answered ${res.status}`);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Stripe did not answer in time.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Is card payment switched on? Readable by anyone who can see an invoice. */
export async function stripeAvailable() {
  try {
    const { props } = await getServerSideProps();
    if (!props?.session?.user?._id) {
      return { success: true, data: JSON.stringify({ available: false }) };
    }
    await connect();
    const account = await escapeTenant("stripe: availability", () =>
      CarrierAccountModel.findOne({ provider: STRIPE_PROVIDER })
        .select("isEnabled")
        .lean(),
    );
    return {
      success: true,
      data: JSON.stringify({ available: Boolean(account?.isEnabled) }),
    };
  } catch {
    return { success: true, data: JSON.stringify({ available: false }) };
  }
}

/** Store the secret key. Never returned afterwards — only a four-character hint. */
export async function saveStripeAccount({ secretKey: key, isEnabled } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!secretsConfigured()) {
      return {
        success: false,
        message: "TAG_KEY_MASTER is not set, so the key cannot be sealed.",
      };
    }

    await connect();
    const existing = await escapeTenant("stripe: find", () =>
      CarrierAccountModel.findOne({ provider: STRIPE_PROVIDER }),
    );

    const sealed = existing?.credentials || new Map();
    const hints = existing?.hints || new Map();
    const trimmed = (key || "").trim();

    if (trimmed) {
      // A publishable key here would be a quiet disaster: it looks like a
      // key, seals fine, and fails only at the moment somebody tries to pay.
      if (trimmed.startsWith("pk_")) {
        return {
          success: false,
          message:
            "That is a publishable key. Checkout sessions need the SECRET " +
            "key (sk_…), which is the one never put in a browser.",
        };
      }
      if (!trimmed.startsWith("sk_") && !trimmed.startsWith("rk_")) {
        return {
          success: false,
          message: "A Stripe secret key starts with sk_ (or rk_ for a restricted one).",
        };
      }
      sealed.set("secretKey", sealSecret(trimmed));
      hints.set("secretKey", secretHint(trimmed));
    } else if (!existing) {
      return { success: false, message: "Enter a secret key first" };
    }

    await escapeTenant("stripe: save", () =>
      CarrierAccountModel.updateOne(
        { provider: STRIPE_PROVIDER },
        {
          $set: {
            credentials: sealed,
            hints,
            ...(isEnabled === undefined ? {} : { isEnabled: Boolean(isEnabled) }),
          },
          $setOnInsert: { provider: STRIPE_PROVIDER },
        },
        { upsert: true },
      ),
    );

    await logAuditDirect({
      action: "Stripe.save",
      module: "Invoice",
      // Records that it changed. Never the key.
      description: `Stripe account updated${trimmed ? " (key changed)" : ""}`,
      actor: auth.user,
    }).catch(() => {});

    return { success: true, message: "Stripe settings saved" };
  } catch (error) {
    console.log("Error saving Stripe settings:", error?.message);
    return { success: false, message: "Could not save that" };
  }
}

/** Whether a key is stored, and its hint. Never the key. */
export async function getStripeAccount() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const account = await escapeTenant("stripe: read", () =>
      CarrierAccountModel.findOne({ provider: STRIPE_PROVIDER }).lean(),
    );
    const hints =
      account?.hints instanceof Map
        ? Object.fromEntries(account.hints)
        : account?.hints || {};

    return {
      success: true,
      data: JSON.stringify({
        configured: Boolean(hints.secretKey),
        hint: hints.secretKey || "",
        isEnabled: Boolean(account?.isEnabled),
        sealingReady: secretsConfigured(),
      }),
    };
  } catch (error) {
    console.log("Error reading Stripe settings:", error?.message);
    return { success: false, message: "Could not read Stripe settings" };
  }
}

/**
 * A Checkout link for what is still owed on an invoice.
 *
 * Callable by the customer, for their own invoice — that is the point. They
 * follow the link, pay on Stripe's page, and the payment is recorded here
 * when they come back or when reconciliation runs.
 */
export async function createInvoiceCheckout({ id, returnUrl } = {}) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!["superAdmin", "admin", "platformAdmin"].includes(user?.role)) {
      return { success: false, message: "Not authorized" };
    }
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid invoice" };
    }

    await connect();
    // Scoped for a customer, escaped only for platform staff. A customer must
    // never be able to open a checkout for somebody else's invoice.
    const invoice =
      user.role === "platformAdmin"
        ? await escapeTenant("stripe: find any invoice", () =>
            InvoiceModel.findById(createObjectId(id)).lean(),
          )
        : await InvoiceModel.findById(createObjectId(id)).lean();

    if (!invoice) return { success: false, message: "Invoice not found" };
    if (invoice.status === "draft") {
      return { success: false, message: "That invoice has not been issued" };
    }
    if (invoice.status === "void") {
      return { success: false, message: `${invoice.number} is void` };
    }

    const owed = outstanding(invoice.grossPence, invoice.payments);
    if (owed <= 0) {
      return { success: false, message: `${invoice.number} is already settled` };
    }

    const key = await secretKey();
    if (!key) {
      return {
        success: false,
        message: "Card payment is not switched on. Pay by bank transfer instead.",
      };
    }

    const base = (returnUrl || "").trim() || "https://example.invalid/invoices";
    const session = await callStripe(
      "/checkout/sessions",
      {
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": (invoice.currency || "GBP").toLowerCase(),
        // Already in the smallest unit, which is exactly what Stripe wants —
        // one of the few places these two agree without conversion.
        "line_items[0][price_data][unit_amount]": String(owed),
        "line_items[0][price_data][product_data][name]": `Invoice ${invoice.number}`,
        // Carried so a webhook or a reconciliation pass can find the invoice
        // again without guessing from the amount.
        "metadata[invoiceId]": String(invoice._id),
        "metadata[invoiceNumber]": invoice.number || "",
        success_url: `${base}?paid=${encodeURIComponent(invoice.number || "")}`,
        cancel_url: base,
      },
      key,
    );

    if (!session?.url) {
      return { success: false, message: "Stripe did not return a payment link" };
    }

    await escapeTenant("stripe: record the session", () =>
      InvoiceModel.updateOne(
        { _id: invoice._id },
        { $set: { stripeSessionId: session.id } },
      ),
    );

    return {
      success: true,
      message: `Pay ${formatMoney(owed, invoice.currency)}`,
      data: JSON.stringify({ url: session.url }),
    };
  } catch (error) {
    console.log("Error creating a checkout session:", error?.message);
    return {
      success: false,
      message: error?.message || "Could not start that payment",
    };
  }
}

/**
 * Ask Stripe whether a checkout was actually paid, and record it if so.
 *
 * Deliberately a pull rather than a webhook. A webhook is the right long-term
 * answer, but it is an unauthenticated public endpoint that writes payment
 * records, so it needs signature verification done properly — and half a
 * webhook is worse than none. This asks Stripe directly, which cannot be
 * forged by anybody, and leaves the webhook as a known piece of work.
 *
 * Idempotent: a session already recorded is not recorded twice.
 */
export async function reconcileInvoicePayment({ id } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid invoice" };
    }

    await connect();
    const invoice = await escapeTenant("stripe: find", () =>
      InvoiceModel.findById(createObjectId(id)).lean(),
    );
    if (!invoice) return { success: false, message: "Invoice not found" };
    if (!invoice.stripeSessionId) {
      return { success: false, message: "No card payment was started for this" };
    }
    if (
      (invoice.payments || []).some(
        (p) => p.reference && p.reference === invoice.stripePaymentIntentId,
      )
    ) {
      return { success: true, message: "That payment is already recorded" };
    }

    const key = await secretKey();
    if (!key) return { success: false, message: "Card payment is not switched on" };

    // A GET, but callStripe posts; Stripe accepts a POST with no body for
    // retrieval, and keeping one code path keeps the error handling identical.
    const session = await callStripe(
      `/checkout/sessions/${encodeURIComponent(invoice.stripeSessionId)}`,
      {},
      key,
    );

    if (session?.payment_status !== "paid") {
      return {
        success: false,
        message: `Stripe says that session is "${session?.payment_status || "unknown"}", not paid.`,
      };
    }

    const amount = Math.round(Number(session.amount_total) || 0);
    const intent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || "";

    await escapeTenant("stripe: record the payment", () =>
      InvoiceModel.updateOne(
        // Guarded on the intent not already being stored, so two operators
        // reconciling at once record one payment.
        { _id: invoice._id, stripePaymentIntentId: { $ne: intent } },
        {
          $push: {
            payments: {
              amountPence: amount,
              method: "card",
              reference: intent,
              receivedAt: new Date(),
              recordedByName: auth.user.name,
            },
          },
          $set: {
            stripePaymentIntentId: intent,
            status:
              outstanding(invoice.grossPence, [
                ...(invoice.payments || []),
                { amountPence: amount },
              ]) === 0
                ? "paid"
                : "part-paid",
          },
        },
      ),
    );

    await logAuditDirect({
      action: "Invoice.cardPayment",
      module: "Invoice",
      entityId: String(invoice._id),
      tenantId: invoice.tenantId,
      description: `Card payment of ${formatMoney(amount, invoice.currency)} recorded against ${invoice.number}`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: `${formatMoney(amount, invoice.currency)} recorded against ${invoice.number}`,
    };
  } catch (error) {
    console.log("Error reconciling a payment:", error?.message);
    return { success: false, message: error?.message || "Could not check that payment" };
  }
}
