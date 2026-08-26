import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const commonLeaveSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Types.ObjectId,
      ref: "OfficeEmploye",
      required: true,
    },
    leaveYear: {
      type: String,
      required: true,
    },
    leaveData: {
      type: Array,
      required: true,
    },
    submitedBy: mongoose.Types.ObjectId,
    submitedDate: Date,
    leaveHistory: {
      type: Array,
      default: [],
    },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(commonLeaveSchema, "CommonLeave");

const CommonLeaveModel =
  mongoose.models.CommonLeave ||
  mongoose.model("CommonLeave", commonLeaveSchema);
export default CommonLeaveModel;
