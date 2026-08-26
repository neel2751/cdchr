import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const roleTypeSchema = new mongoose.Schema(
  {
    roleTitle: { type: String, required: true },
    roleDescription: { type: String },
    isActive: { type: Boolean, default: true },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(roleTypeSchema, "RoleType");

const RoleTypesModel =
  mongoose.models.RoleType || mongoose.model("RoleType", roleTypeSchema);
export default RoleTypesModel;
