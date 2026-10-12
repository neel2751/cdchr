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
    // Menu PATHS, not menu names: "/admin/officeEmployee", not "Office
    // Management". The comment here said names for a long time and the stored
    // data never did — proxy.js matches `menuItem.path` against this list, and
    // so do lib/employeeAccess.js and lib/actionAccess.js. A reader who
    // believed the comment and wrote a name would have built a permission that
    // grants nothing and silently refuses everyone.
    permissions: [
      {
        type: String,
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
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(roleBasedSchema, "RoleBased");

const RoleBasedModel =
  mongoose.models.RoleBased || mongoose.model("RoleBased", roleBasedSchema);
export default RoleBasedModel;
