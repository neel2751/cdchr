import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const leaveCategorySchema = new mongoose.Schema(
  {
    leaveType: {
      type: String,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
    isPaid: {
      type: String,
      default: false,
    },
    isHide: {
      type: String,
      default: true,
    },
    note: {
      type: String,
      required: false,
    },
    isEditable: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(leaveCategorySchema, "LeaveCategory");

const LeaveCategoryModel =
  mongoose.models.LeaveCategory ||
  mongoose.model("LeaveCategory", leaveCategorySchema);
export default LeaveCategoryModel; // export the model
