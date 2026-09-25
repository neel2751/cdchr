import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

/**
 * An invoice, or a credit note.
 *
 * Tenant-scoped: the document belongs to the company being billed, and they
 * can read their own. Issuing, voiding and crediting are ours.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE THREE RULES THIS MODEL EXISTS TO ENFORCE
 *
 * 1. AN ISSUED INVOICE IS IMMUTABLE. Not "should not be edited" — cannot.
 *    The customer has a copy; changing ours makes two documents with one
 *    number saying different things. A mistake is corrected by issuing a
 *    credit note, which is what credit notes are for.
 *
 * 2. NUMBERS ARE SEQUENTIAL AND UNBROKEN. A gap reads as a deleted invoice,
 *    which is exactly what it would be. So nothing is ever deleted: a void
 *    invoice keeps its number and says it is void.
 *
 * 3. THE FIGURES AND THE ADDRESSES ARE FROZEN AT ISSUE. Prices change, VAT
 *    rates change, we might move office. Last year's invoice must still show
 *    last year's numbers and last year's address — so they are copied onto
 *    the invoice, never looked up when it is read.
 * ─────────────────────────────────────────────────────────────────────────
 */

const lineSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    // No minimum: a credit note carries the original lines with negative
    // quantities, which is how it comes to a negative total.
    quantity: { type: Number, required: true },
    // Whole pence. See lib/money.js for why nothing here is a decimal.
    unitPricePence: { type: Number, required: true },
    // Basis points: 2000 is 20%. Stored per line because lines can differ,
    // and frozen because the rate that applies is the rate at the time of
    // supply, not whatever it is when somebody reopens the invoice.
    vatRateBasisPoints: { type: Number, default: 2000 },
    _id: false,
  },
  { _id: false },
);

const paymentSchema = new mongoose.Schema(
  {
    amountPence: { type: Number, required: true },
    method: {
      type: String,
      enum: ["bank-transfer", "card", "cheque", "cash", "other"],
      default: "bank-transfer",
    },
    // Their bank reference, or Stripe's payment intent. What lets somebody
    // match this line to an entry on a statement.
    reference: String,
    receivedAt: { type: Date, default: Date.now },
    recordedByName: String,
    _id: false,
  },
  { _id: false },
);

/** Name and address as they were, not as they are. See rule 3. */
const partySchema = new mongoose.Schema(
  {
    name: String,
    address: String,
    vatNumber: String,
    companyNumber: String,
    _id: false,
  },
  { _id: false },
);

const invoiceSchema = new mongoose.Schema(
  {
    // Null while a draft. Allocated once, at issue, from InvoiceCounter — a
    // draft that is never issued must not consume a number, or the run has a
    // gap in it for something that never existed.
    number: { type: String, default: null },

    kind: {
      type: String,
      enum: ["invoice", "credit-note"],
      default: "invoice",
    },
    // Set on a credit note: which invoice it corrects.
    creditsInvoiceId: mongoose.Schema.Types.ObjectId,

    status: {
      type: String,
      enum: ["draft", "issued", "part-paid", "paid", "void"],
      default: "draft",
    },

    // What is being billed for. Kept as the order number rather than an id so
    // the invoice still reads correctly if the order is ever archived.
    orderNumber: String,

    lines: [lineSchema],
    currency: { type: String, default: "GBP" },

    // Frozen at issue from the lines. Held rather than recomputed on read,
    // so an invoice cannot change because a price did.
    netPence: { type: Number, default: 0 },
    vatPence: { type: Number, default: 0 },
    grossPence: { type: Number, default: 0 },

    seller: partySchema,
    buyer: partySchema,

    issuedAt: Date,
    issuedByName: String,
    // Terms are captured as a date, not as "30 days", so a change of terms
    // does not silently move an old invoice's due date.
    dueAt: Date,

    payments: [paymentSchema],

    voidedAt: Date,
    voidReason: String,
    voidedByName: String,

    // Stripe, when the customer pays by card. Only identifiers — no card
    // data ever reaches this application. See server/billingServer/stripe.js.
    stripeSessionId: String,
    stripePaymentIntentId: String,
  },
  { timestamps: true },
);

// Unique, but only where a number exists: many drafts share a null.
invoiceSchema.index(
  { number: 1 },
  { unique: true, partialFilterExpression: { number: { $type: "string" } } },
);
invoiceSchema.index({ tenantId: 1, status: 1, issuedAt: -1 });
invoiceSchema.index({ tenantId: 1, orderNumber: 1 });

applyTenantScope(invoiceSchema, "Invoice");

const InvoiceModel =
  mongoose.models.Invoice || mongoose.model("Invoice", invoiceSchema);

export default InvoiceModel;
