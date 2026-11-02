import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

export const POLICY_REVIEW_OUTCOMES = ["no-change", "new-version"];

/**
 * One time somebody looked at a policy and decided it was still right — or
 * replaced it.
 *
 * The audit log records the same event, but only a super admin can read the
 * audit log, and "when was this last reviewed, by whom, and what did they
 * conclude" is a question the policy's own managers are asked: by an
 * inspector, an insurer, a client's supplier questionnaire. So the answer
 * lives on the policy's page.
 *
 * Append-only. Nothing edits or deletes a review.
 */
const policyReviewSchema = new mongoose.Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Policy",
      required: true,
    },
    outcome: { type: String, enum: POLICY_REVIEW_OUTCOMES, required: true },
    // Set when the review was a new version being published.
    versionNumber: { type: Number, default: null },
    note: { type: String, trim: true, default: "" },
    // The due date this review answered, and the one it set. Kept so the
    // history shows a review done late as late.
    dueDate: { type: Date, default: null },
    nextReviewDate: { type: Date, default: null },
    reviewedAt: { type: Date, default: Date.now },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "OfficeEmploye" },
    reviewedByName: { type: String },
  },
  { timestamps: true },
);

policyReviewSchema.index({ tenantId: 1, policyId: 1, reviewedAt: -1 });

applyTenantScope(policyReviewSchema, "PolicyReview");

const PolicyReviewModel =
  mongoose.models.PolicyReview ||
  mongoose.model("PolicyReview", policyReviewSchema);

export default PolicyReviewModel;
