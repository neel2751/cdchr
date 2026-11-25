import mongoose from "mongoose";

/**
 * The price list around the packages: discounts, VAT, add-on module prices,
 * and how long a free trial lasts. One document (the singleton trick, as in
 * platformSettingModel.js). Platform-level, not tenant scoped.
 *
 * Defaults and the arithmetic: lib/pricing.js.
 */
const pricingSettingSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: "only", enum: ["only"], unique: true },
    currency: { type: String, default: "GBP" },
    yearlyDiscountPercent: { type: Number, default: 15, min: 0, max: 100 },
    extraCompanyDiscountPercent: { type: Number, default: 25, min: 0, max: 100 },
    vatRateBasisPoints: { type: Number, default: 2000, min: 0, max: 10000 },
    // { moduleKey: pence a month }
    addOnPence: { type: Map, of: Number, default: () => ({}) },
    trialDays: { type: Number, default: 14, min: 1, max: 365 },

    // The monthly billing run (server/billingServer/subscriptionBilling.js).
    // OFF until a person switches it on: it charges cards and emails
    // customers with nobody in the loop. "Bill now" on an account is a person
    // deciding, and works either way.
    billingEnabled: { type: Boolean, default: false },
    // Days to pay a bill sent as an invoice.
    invoiceTermsDays: { type: Number, default: 14, min: 0, max: 90 },
    // Days overdue before an unpaid bill makes the customer's companies
    // read-only, then locked (lib/tenantAccess.js). 0 switches that step off.
    unpaidReadOnlyDays: { type: Number, default: 7, min: 0, max: 365 },
    unpaidLockDays: { type: Number, default: 14, min: 0, max: 365 },
    // Null until a person has looked at the suggested prices and saved them.
    // The console says "suggested prices" until then.
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

const PricingSettingModel =
  mongoose.models.PricingSetting ||
  mongoose.model("PricingSetting", pricingSettingSchema);

export default PricingSettingModel;
