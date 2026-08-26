import mongoose from "mongoose";

/**
 * A platform admin's time-boxed, read-only visit to a company.
 *
 * The record is the authority, not the JWT. A cookie could be replayed after a
 * visit was revoked, so the session callback re-checks this collection on every
 * update rather than trusting what the browser presents.
 *
 * Global (see GLOBAL_MODELS): it spans the platform and one tenant by
 * definition, and has to be readable while acting as that tenant.
 */
const supportSessionSchema = new mongoose.Schema(
  {
    platformUserId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    platformUserEmail: { type: String, required: true },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Companie",
      required: true,
      index: true,
    },
    tenantName: { type: String },
    // Why the visit was needed. Required, so every entry in the audit trail
    // answers "what was this for" without asking anyone.
    reason: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    // Hard stop. A forgotten session expires on its own.
    expiresAt: { type: Date, required: true, index: true },
    endedAt: { type: Date },
  },
  { timestamps: true }
);

/** The visit currently in force for an account, if any. */
supportSessionSchema.statics.findActiveFor = function (platformUserId) {
  return this.findOne({
    platformUserId,
    endedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ startedAt: -1 })
    .lean();
};

const SupportSessionModel =
  mongoose.models.SupportSession ||
  mongoose.model("SupportSession", supportSessionSchema);

export default SupportSessionModel;
