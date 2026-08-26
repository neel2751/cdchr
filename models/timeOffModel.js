import { applyTenantScope } from "@/lib/tenantPlugin";
const { default: mongoose } = require("mongoose");

const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const timeOffSchema = new Schema(
  {
    employeeId: [{ type: ObjectId, ref: "Employee" }],
    date: Date,
    startTime: String,
    endTime: String,
    breakTime: Array,
    status: String,
    isActive: Boolean,
    isDeleted: Boolean,
    isVerified: Boolean, // TODO: add verification
  },
  {
    timestamps: true,
  }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(timeOffSchema, "timeOff");

const TimeOffModel =
  mongoose.models.timeOff || mongoose.model("timeOff", timeOffSchema);
export default TimeOffModel;
