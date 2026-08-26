import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const attendanceCategorySchema = new mongoose.Schema(
  {
    attendanceCategoryName: {
      type: String,
      required: true,
    },
    attendanceCategoryValue: {
      type: String,
      required: true,
    },
    attendanceCategoryDescription: {
      type: String,
      required: false,
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
applyTenantScope(attendanceCategorySchema, "AttendanceCategory");

const AttendanceCategoryModel =
  mongoose.models.AttendanceCategory ||
  mongoose.model("AttendanceCategory", attendanceCategorySchema);
export default AttendanceCategoryModel; // export the model
