import mongoose from "mongoose";

/**
 * The invoice number sequence.
 *
 * A collection of its own, holding one document per year, for one reason: an
 * invoice number has to be allocated ATOMICALLY. Reading the highest number
 * and adding one is a race, and two invoices sharing a number is not a bug you
 * can fix afterwards — the copies are already with customers.
 *
 * So allocation is a single findOneAndUpdate with $inc, which MongoDB
 * guarantees is atomic even when two people press Issue at the same instant.
 *
 * Platform-level and deliberately NOT tenant-scoped. We are the issuer, so the
 * sequence is ours: one unbroken run across every customer, not one per
 * customer. A sequence per tenant would put our first invoice number on every
 * customer's first invoice.
 */
const invoiceCounterSchema = new mongoose.Schema(
  {
    // The year the sequence belongs to, e.g. 2026. Restarting each year is
    // ordinary practice and keeps the numbers short; the run stays unbroken
    // within the year, which is what matters.
    year: { type: Number, required: true, unique: true },
    // Last number handed out. The next is this plus one.
    lastNumber: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const InvoiceCounterModel =
  mongoose.models.InvoiceCounter ||
  mongoose.model("InvoiceCounter", invoiceCounterSchema);

export default InvoiceCounterModel;
