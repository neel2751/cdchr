import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

/**
 * One person's relationship with one VERSION of one policy.
 *
 * Keyed by version, not by policy, because that is what an acknowledgement
 * means: "I have read and understood this text". When version 3 replaces
 * version 2, nobody has read version 3 yet, and nobody has to be asked to
 * re-confirm by hand — their version-2 receipt simply no longer counts.
 *
 * Written lazily, when somebody opens the policy, like announcement receipts.
 * The absence of a receipt means not opened.
 *
 *   firstOpenedAt   when they first opened this version
 *   lastOpenedAt    the most recent time
 *   acknowledgedAt  when they pressed "I have read and understood" — only
 *                   possible after opening, and only on a policy that asks
 *
 * Office staff only, for now, like the rest of the policy reader; the kind is
 * stored so the report never has to guess whose id an id is.
 */
const policyReceiptSchema = new mongoose.Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Policy",
      required: true,
    },
    versionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PolicyVersion",
      required: true,
    },
    versionNumber: { type: Number, required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, required: true },
    employeeKind: {
      type: String,
      enum: ["office", "field"],
      default: "office",
      required: true,
    },
    firstOpenedAt: { type: Date, default: null },
    lastOpenedAt: { type: Date, default: null },
    openCount: { type: Number, default: 0 },
    acknowledgedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

policyReceiptSchema.index(
  { tenantId: 1, versionId: 1, employeeId: 1 },
  { unique: true },
);
policyReceiptSchema.index({ tenantId: 1, employeeId: 1, versionId: 1 });

applyTenantScope(policyReceiptSchema, "PolicyReceipt");

const PolicyReceiptModel =
  mongoose.models.PolicyReceipt ||
  mongoose.model("PolicyReceipt", policyReceiptSchema);

export default PolicyReceiptModel;
