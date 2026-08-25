import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const roleBasedSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoleType",
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    permissions: [
      {
        type: String, // Store menu names directly (e.g., "Office Management")
        required: true,
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and companyId field are not attached.
applyTenantScope(roleBasedSchema, "RoleBased");

const RoleBasedModel =
  mongoose.models.RoleBased || mongoose.model("RoleBased", roleBasedSchema);
export default RoleBasedModel;
