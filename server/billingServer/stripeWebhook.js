import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { formatMoney, outstanding } from "@/lib/money";
import { openSecret } from "@/lib/secretBox";
import CarrierAccountModel from "@/models/carrierAccountModel";
import InvoiceModel from "@/models/invoiceModel";
import WebhookEventModel from "@/models/webhookEventModel";

/**
 * What to do with a Stripe event once it is known to be genuine.
 *
 * Deliberately NOT a "use server" module: nothing here is callable from a
 * browser. It is reached only by the route handler, after the signature has
 * been verified, and separating the two means the decision "is this real" and
 * the decision "what does it mean" can be read — and tested — apart.
 */

/** The signing secret for the endpoint, sealed alongside the API key. */
export async function webhookSecret() {
  const account = await escapeTenant("stripe: webhook secret", () =>
    CarrierAccountModel.findOne({ provider: "stripe" }).lean(),
  );
  const raw =
    account?.credentials instanceof Map
      ? Object.fromEntries(account.credentials)
      : account?.credentials || {};
  return raw.webhookSecret ? openSecret(raw.webhookSecret) : null;
}

/**
 * Claim an event id, or discover somebody already has.
 *
 * An insert rather than a read-then-write: the unique index decides, so two
 * deliveries arriving at the same instant cannot both pass. Returns false when
 * this event has been seen, which is a success for the caller — Stripe should
 * get its 2xx and stop retrying.
 */
async function claimEvent(event) {
  try {
    await escapeTenant("stripe: claim an event", () =>
      WebhookEventModel.create({
        source: "stripe",
        eventId: event.id,
        type: event.type,
      }),
    );
    return true;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

async function noteOutcome(eventId, outcome) {
  await escapeTenant("stripe: record an outcome", () =>
    WebhookEventModel.updateOne({ eventId }, { $set: { outcome } }),
  ).catch(() => {});
}

/**
 * Record a payment against the invoice an object points at.
 *
 * The invoice is found through `metadata.invoiceId`, which we put there when
 * the checkout was created — never by matching on the amount, which would
 * attach a payment to the wrong invoice the moment two are for the same sum.
 */
async function creditInvoice({ invoiceId, amountPence, reference, eventId }) {
  if (!invoiceId) return "no invoice id in the event metadata";

  const invoice = await escapeTenant("stripe: find the invoice", () =>
    InvoiceModel.findById(invoiceId).lean(),
  ).catch(() => null);
  if (!invoice) return `invoice ${invoiceId} not found`;
  if (invoice.status === "void") return `invoice ${invoice.number} is void`;

  // Already recorded, by this reference. The event claim above stops the same
  // delivery twice; this stops two different events describing one payment.
  if ((invoice.payments || []).some((p) => p.reference && p.reference === reference)) {
    return `already recorded against ${invoice.number}`;
  }

  const owed = outstanding(invoice.grossPence, invoice.payments);
  if (owed <= 0) return `${invoice.number} was already settled`;

  // Never more than is owed. Stripe's amount should match, but an invoice
  // part-paid by bank transfer between checkout and callback would otherwise
  // be overpaid by arithmetic rather than by anybody's intention.
  const amount = Math.min(Math.round(Number(amountPence) || 0), owed);
  if (amount <= 0) return "nothing to record";

  const res = await escapeTenant("stripe: record the payment", () =>
    InvoiceModel.updateOne(
      // Guarded on the reference still being absent, so two workers handling
      // different events for one payment write it once.
      { _id: invoice._id, "payments.reference": { $ne: reference } },
      {
        $push: {
          payments: {
            amountPence: amount,
            method: "card",
            reference,
            receivedAt: new Date(),
            recordedByName: "Stripe webhook",
          },
        },
        $set: {
          stripePaymentIntentId: reference,
          status: owed - amount === 0 ? "paid" : "part-paid",
        },
      },
    ),
  );
  if (!res.modifiedCount) return `already recorded against ${invoice.number}`;

  await logAuditDirect({
    action: "Invoice.cardPayment",
    module: "Invoice",
    entityId: String(invoice._id),
    tenantId: invoice.tenantId,
    description:
      `${formatMoney(amount, invoice.currency)} received by card against ` +
      `${invoice.number} (Stripe event ${eventId})`,
    // No session behind a webhook. Named so the audit trail does not imply a
    // person did this.
    actor: { name: "Stripe webhook", role: "system" },
  }).catch(() => {});

  return `recorded ${formatMoney(amount, invoice.currency)} against ${invoice.number}`;
}

/**
 * Handle one verified event.
 *
 * Always resolves. A thrown error here would become a 500, which Stripe reads
 * as "try again" — right for a database being down, wrong for an event we
 * simply do not care about, and it would be retried for three days.
 */
export async function handleStripeEvent(event) {
  await connect();

  const fresh = await claimEvent(event);
  if (!fresh) {
    return { ok: true, outcome: "duplicate delivery, ignored" };
  }

  let outcome;
  try {
    const object = event?.data?.object || {};

    switch (event.type) {
      case "checkout.session.completed": {
        // A completed session is not necessarily a paid one — an asynchronous
        // method can complete the session and settle days later.
        if (object.payment_status !== "paid") {
          outcome = `session ${object.id} completed but payment_status is "${object.payment_status}"`;
          break;
        }
        outcome = await creditInvoice({
          invoiceId: object?.metadata?.invoiceId,
          amountPence: object.amount_total,
          reference:
            typeof object.payment_intent === "string"
              ? object.payment_intent
              : object.payment_intent?.id || object.id,
          eventId: event.id,
        });
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        // The other half of the case above: a delayed method that has now
        // cleared.
        outcome = await creditInvoice({
          invoiceId: object?.metadata?.invoiceId,
          amountPence: object.amount_total,
          reference:
            typeof object.payment_intent === "string"
              ? object.payment_intent
              : object.payment_intent?.id || object.id,
          eventId: event.id,
        });
        break;
      }

      case "payment_intent.succeeded": {
        // Only acted on when the intent carries our metadata. Stripe sends
        // this alongside checkout.session.completed for the same money, and
        // the reference guard above is what stops it being counted twice.
        outcome = await creditInvoice({
          invoiceId: object?.metadata?.invoiceId,
          amountPence: object.amount_received ?? object.amount,
          reference: object.id,
          eventId: event.id,
        });
        break;
      }

      default:
        outcome = `no handler for ${event.type}`;
    }
  } catch (error) {
    // Recorded and swallowed. The claim is left in place: retrying an event
    // whose handler threw would hit the duplicate guard anyway, so a failure
    // here needs a human, not another delivery.
    console.log("Stripe webhook handler failed:", error?.message);
    outcome = `handler error: ${error?.message}`;
  }

  await noteOutcome(event.id, outcome);
  return { ok: true, outcome };
}
