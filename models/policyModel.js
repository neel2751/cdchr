import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";
import { audienceSchema } from "@/models/announcementModel";

export const POLICY_STATUSES = ["draft", "active", "archived"];

/**
 * One policy in a company's library — "Fire Evacuation", "Acceptable Use of
 * IT" — independent of any particular file.
 *
 * The documents themselves are PolicyVersions. This record holds what stays
 * the same across them: the title, the shelf it sits on, who is responsible
 * for it, and who may read it. `currentVersionId` is the one version
 * employees see; it is set only by publishing, so a policy with nothing
 * published is a draft and shows to nobody whatever its visibility says.
 *
 * WHO CAN READ IT is two switches, both checked on the server:
 *   visibleToEmployees  off by default, so an upload is never shown by
 *                       accident and the library can be built up in private
 *   audience            the same shape as an announcement's, and read by the
 *                       same visibilityFilter(), so "the Finance department"
 *                       means the same people in both places
 *
 * Office staff only for now. Site staff have no portal to read a policy in;
 * the audience shape can already name them, and the server refuses to until
 * they can.
 *
 * Replaces an earlier stub of the same name that nothing ever called. Its one
 * leftover document has no `isDeleted` field, so every query here — which all
 * ask for `isDeleted: false` — passes it by.
 */
const policySchema = new mongoose.Schema(
  {
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PolicyCategory",
      required: true,
    },
    title: { type: String, required: true, trim: true },
    summary: { type: String, trim: true, default: "" },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
      default: null,
    },
    status: { type: String, enum: POLICY_STATUSES, default: "draft" },

    currentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PolicyVersion",
      default: null,
    },
    // Copied from the current version so the library lists without a join.
    // Written in the same publish that sets currentVersionId.
    currentVersionNumber: { type: Number, default: 0 },
    currentPublishedAt: { type: Date, default: null },

    visibleToEmployees: { type: Boolean, default: false },
    audience: { type: audienceSchema, default: () => ({}) },
    // Ask each reader to confirm they have read and understood the version
    // in force. Per version: a new version asks again. See PolicyReceipt.
    requireAck: { type: Boolean, default: false },
    // When staff were last emailed to read it. One email round a day at
    // most — see notifyPolicyReaders.
    lastNotifiedAt: { type: Date, default: null },

    // WHEN IT IS NEXT LOOKED AT. Every review — a "no changes" sign-off or a
    // new version — resets the clock to reviewIntervalMonths from that day.
    // A null interval means no regular review, and then nextReviewDate is
    // whatever a manager set by hand, or nothing. Dates are working days
    // (UTC midnight of a UK calendar day) — see lib/policies.js.
    reviewIntervalMonths: { type: Number, default: null },
    nextReviewDate: { type: Date, default: null },
    lastReviewedAt: { type: Date, default: null },
    lastReviewedByName: { type: String },
    // Which reminders have gone out for the current due date. An entry is
    // claimed before the email is sent, so two runs cannot both send it, and
    // released if the send fails, so the next run tries again. Emptied when
    // the policy is reviewed: the next due date starts its own set.
    reviewRemindersSent: [
      {
        _id: false,
        milestone: { type: String, required: true },
        dueDate: { type: Date, required: true },
        sentAt: { type: Date, default: Date.now },
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "OfficeEmploye" },
    createdByName: { type: String },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "OfficeEmploye" },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

policySchema.index({ tenantId: 1, categoryId: 1, isDeleted: 1 });
policySchema.index({ tenantId: 1, status: 1, visibleToEmployees: 1 });
policySchema.index({ tenantId: 1, status: 1, nextReviewDate: 1 });

applyTenantScope(policySchema, "Policy");

const PolicyModel =
  mongoose.models.Policy || mongoose.model("Policy", policySchema);

export default PolicyModel;
