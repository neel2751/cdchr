// models/MicrosoftIntegration.ts
import mongoose, { Schema } from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const MicrosoftIntegrationSchema = new Schema(
  {
    employeeId: { type: mongoose.Types.ObjectId, required: true },
    connected: { type: Boolean, default: false },
    accessToken: String,
    refreshToken: String,
    tokenExpiresAt: Date,
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(MicrosoftIntegrationSchema, "MicrosoftIntegration");

const MicrosoftIntegration =
  mongoose.models.MicrosoftIntegration ||
  mongoose.model("MicrosoftIntegration", MicrosoftIntegrationSchema);
export default MicrosoftIntegration;
