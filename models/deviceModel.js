import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const Schema = mongoose.Schema;
const DeviceSchema = new Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    employeeName: { type: String, required: true },
    submissionId: String,
    email: { type: String, required: true },
    department: { type: String, required: true },
    devices: { type: Array, default: [] },
    browsers: { type: Array, default: [] },
    workApplications: { type: Array, default: [] },
    submitSystemInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    submissionDate: { type: Date, default: new Date() },
    submittedBy: String,
    encryptionKey: String,
    userAgent: String,
    ipAddress: String,
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(DeviceSchema, "device");

const DeviceModel =
  mongoose.models.device || mongoose.model("device", DeviceSchema);
export default DeviceModel;
