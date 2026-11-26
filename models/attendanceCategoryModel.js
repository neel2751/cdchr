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
    // What choosing it means on a rota — lib/rotaCategories.js. Absent on
    // categories made before rules existed; read from the value then.
    kind: {
      type: String,
      enum: ["work", "place", "off"],
    },
    // Hours filled in when it is chosen. Not used for "off".
    startTime: { type: String },
    endTime: { type: String },
    // The order on the rota's dropdown.
    sortOrder: { type: Number, default: 0 },
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
