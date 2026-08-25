import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const statusesSchema = new mongoose.Schema(
  {
    entityId: {
      type: mongoose.Types.ObjectId,
    },
    entityCollection: {
      type: String,
    },
    status: {
      enum: ["Approve", "Reject", "Pending", "No Status"],
      default: "Pending",
    },
    reason: {
      type: String,
    },
    statusDate: {
      type: Date,
    },
    approveId: {
      type: mongoose.Types.ObjectId,
    },
    rejectedId: {
      type: mongoose.Types.ObjectId,
    },
    userCollection: {
      type: String,
    },
    additionalData: Object,
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and companyId field are not attached.
applyTenantScope(statusesSchema, "Statuses");

const StatusesModel =
  mongoose.models.Statuses || mongoose.model("Statuses", statusesSchema);
export default StatusesModel;
