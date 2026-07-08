import mongoose from "mongoose";

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;
const Mixed = Schema.Types.Mixed;

const auditLogSchema = new Schema(
  {
    // Who performed the action
    actorId: {
      type: ObjectId,
    },
    actorType: {
      type: String, // "OfficeEmploye" | "Employe"
    },
    actorName: {
      type: String,
    },
    actorEmail: {
      type: String,
    },
    actorRole: {
      type: String, // "admin" | "superAdmin"
    },

    // What happened
    action: {
      type: String, // name passed to withAudit, e.g. "Clock.update"
      required: true,
    },
    module: {
      type: String, // e.g. "Clock", "SiteAssignment", "OfficeEmployee"
    },
    entityId: {
      type: ObjectId, // affected document (optional)
    },
    description: {
      type: String,
    },

    // Before/after detail
    before: {
      type: Mixed,
    },
    after: {
      type: Mixed,
    },
    changes: {
      type: Mixed, // { field: { from, to } }
    },

    // Outcome
    status: {
      type: String,
      enum: ["success", "failure"],
      default: "success",
    },
    errorMessage: {
      type: String,
    },

    // Request context
    ipAddress: {
      type: String,
    },
    metadata: {
      type: Mixed, // sanitized args summary, userAgent, etc.
    },
  },
  { timestamps: true },
);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ module: 1, createdAt: -1 });
auditLogSchema.index({ entityId: 1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const AuditLogModel =
  mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);

export default AuditLogModel;
