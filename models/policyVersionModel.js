import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

export const POLICY_VERSION_STATUSES = ["draft", "published", "superseded"];

/**
 * One file of one policy.
 *
 * Uploaded as a draft, which nobody but the policy's managers can see.
 * Publishing gives it the next number and makes it the version employees
 * read; the one it replaces becomes `superseded` and stays in the history,
 * because "which version was in force on the day of the fire" is exactly the
 * question a policy library exists to answer.
 *
 * NOT EDITABLE ONCE PUBLISHED. There is no update path for a published
 * version's file, note or dates — a correction is a new version. A record
 * that could be quietly rewritten would answer that question with whatever
 * someone last typed.
 *
 * Numbered at publish, not upload, so the published history reads v1, v2, v3
 * without the gaps left by drafts that were deleted.
 *
 * The file key is never sent to an employee. They ask for a policy and the
 * server signs its current version's key after checking they may read it —
 * see server/policyServer/myPolicyServer.js.
 */
const policyVersionSchema = new mongoose.Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Policy",
      required: true,
    },
    versionNumber: { type: Number, default: null },
    status: { type: String, enum: POLICY_VERSION_STATUSES, default: "draft" },

    file: {
      key: { type: String, required: true },
      fileName: { type: String, required: true },
      fileType: { type: String, required: true },
      fileSize: { type: Number, required: true },
    },

    changeNote: { type: String, trim: true, default: "" },
    effectiveDate: { type: Date, default: null },

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "OfficeEmploye" },
    uploadedByName: { type: String },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "OfficeEmploye" },
    publishedByName: { type: String },

    // Drafts only. A published version is history and is never deleted.
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

policyVersionSchema.index({ tenantId: 1, policyId: 1, createdAt: -1 });

// Two publishes racing for the same number fail here rather than both
// becoming "v3". Partial, because every draft's number is null.
policyVersionSchema.index(
  { tenantId: 1, policyId: 1, versionNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { versionNumber: { $type: "number" } },
  },
);

applyTenantScope(policyVersionSchema, "PolicyVersion");

const PolicyVersionModel =
  mongoose.models.PolicyVersion ||
  mongoose.model("PolicyVersion", policyVersionSchema);

export default PolicyVersionModel;
