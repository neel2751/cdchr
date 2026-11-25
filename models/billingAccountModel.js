import mongoose from "mongoose";

/**
 * A customer we bill: one or more companies on one bill.
 *
 * A business with branches is often several companies here — each with its
 * own staff, sites and settings — but it is one customer. The account ties
 * them together: one main company pays the full package price and each of
 * the others the extra-company price (lib/pricing.js), and a lock for an
 * unpaid bill reaches all of them.
 *
 * Companies point here (Companie.billing.accountId); the account does not
 * list them, so a company can never be in two accounts. Platform-level, not
 * tenant scoped (lib/tenantPlugin.js GLOBAL_MODELS): it spans companies by
 * definition.
 */
const billingAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Where the bill goes (Step 5). Not a login.
    billingEmail: { type: String, trim: true, lowercase: true, default: "" },
    // The company that pays the full package price. The rest are extras.
    primaryCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: "Companie" },
    notes: { type: String, default: "" },
    createdBy: { type: String, default: "" },

    // How the customer pays (server/billingServer/subscriptionBilling.js):
    //   "card"    — the saved card is charged when each bill is made. The
    //               default once a card is on file.
    //   "invoice" — the bill is emailed with a link to pay it, by card or
    //               bank transfer, within the terms.
    paymentMethod: { type: String, enum: ["card", "invoice"], default: "invoice" },
    // Stripe's ids only. No card number ever reaches us — the card is typed
    // on Stripe's page (server/billingServer/stripe.js).
    stripeCustomerId: { type: String },
    card: {
      paymentMethodId: { type: String },
      brand: { type: String },
      last4: { type: String },
      expMonth: { type: Number },
      expYear: { type: Number },
      addedAt: { type: Date },
    },
    // The last time charging the card failed, and Stripe's reason. Cleared
    // by the next success or a new card.
    cardFailedAt: { type: Date },
    cardFailure: { type: String },
  },
  { timestamps: true }
);

const BillingAccountModel =
  mongoose.models.BillingAccount ||
  mongoose.model("BillingAccount", billingAccountSchema);

export default BillingAccountModel;
