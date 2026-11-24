import mongoose from "mongoose";

/**
 * A code that gives a longer free trial — "EXPO30" for a trade show, 30 days.
 *
 * Typed at signup, or carried in a link (/signup?offer=EXPO30). Without one a
 * trial is PricingSetting.trialDays long. Platform-level, not tenant scoped:
 * it is read before the company it creates exists.
 */
const trialOfferSchema = new mongoose.Schema(
  {
    // Stored upper case; see normaliseOfferCode in lib/pricing.js.
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    // What it was for, e.g. "Construction Expo 2026". Shown on the console.
    label: { type: String, default: "" },
    trialDays: { type: Number, required: true, min: 1, max: 365 },
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    // 0 or null: as many as like.
    maxUses: { type: Number, default: null, min: 0 },
    // Counted when a company is actually created with it, not when typed.
    uses: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

const TrialOfferModel =
  mongoose.models.TrialOffer || mongoose.model("TrialOffer", trialOfferSchema);

export default TrialOfferModel;
