import mongoose from "mongoose";

/**
 * A package we sell — Essentials, Workforce, Enterprise. Platform-level, like
 * the tag catalogue: one price list every company is sold from, so NOT tenant
 * scoped (lib/tenantPlugin.js GLOBAL_MODELS).
 *
 * The arithmetic lives in lib/pricing.js; this only stores the figures.
 * Pence, always — never floating pounds.
 */
const pricingPlanSchema = new mongoose.Schema(
  {
    // Stable handle stored on a company (billing.plan). The NAME can change
    // freely; the key does not, or companies lose track of their plan.
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
    // Retired plans stay for the companies already on them, but are not
    // offered to anyone new.
    isActive: { type: Boolean, default: true },
    monthlyPence: { type: Number, default: 0, min: 0 },
    included: {
      officeStaff: { type: Number, default: 0, min: 0 },
      workers: { type: Number, default: 0, min: 0 },
      storageGb: { type: Number, default: 0, min: 0 },
    },
    // A month, for each one over the allowance.
    extraPence: {
      officeStaff: { type: Number, default: 0, min: 0 },
      worker: { type: Number, default: 0, min: 0 },
      storageGb: { type: Number, default: 0, min: 0 },
    },
    // Module keys from data/features.js the package includes.
    features: { type: [String], default: [] },
  },
  { timestamps: true }
);

const PricingPlanModel =
  mongoose.models.PricingPlan ||
  mongoose.model("PricingPlan", pricingPlanSchema);

export default PricingPlanModel;
