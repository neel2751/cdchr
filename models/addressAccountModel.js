import mongoose from "mongoose";

/**
 * Our licence with a PAF reseller.
 *
 * Platform-level, like CarrierAccount and for the same reason: the licence is
 * ours, billed to us, and every customer's lookups run through it. Listed in
 * GLOBAL_MODELS.
 *
 * Deliberately a separate collection from CarrierAccount rather than a shared
 * "integration account" with a `kind`. They look alike today and will not stay
 * that way — a carrier has an environment and a service code, an address
 * provider has neither — and merging two things because their current fields
 * match is how a model ends up half-applicable to everything in it.
 *
 * Credentials are sealed (lib/secretBox.js) and never returned to a screen.
 */
const addressAccountSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, unique: true, trim: true },

    credentials: { type: Map, of: String, default: () => new Map() },
    hints: { type: Map, of: String, default: () => new Map() },

    // Off by default. Every lookup through an enabled account is billable, so
    // switching it on is a spending decision and should be a deliberate one.
    isEnabled: { type: Boolean, default: false },

    // A ceiling per company per day. Not a performance guard — a cost one.
    // One customer holding down a button must not run up our bill.
    dailyLookupLimit: { type: Number, default: 200, min: 0 },

    lastTestedAt: Date,
    lastTestOk: Boolean,
    lastTestMessage: String,
  },
  { timestamps: true },
);

// Deliberately NOT tenant-scoped. See the note above.
const AddressAccountModel =
  mongoose.models.AddressAccount ||
  mongoose.model("AddressAccount", addressAccountSchema);

export default AddressAccountModel;
