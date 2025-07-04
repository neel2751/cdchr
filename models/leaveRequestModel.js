import mongoose from "mongoose";

const leaveRequestSchema = new mongoose.Schema(
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
    leaveType: {
      type: String,
      required: true,
    },
    leaveSubmitDate: {
      type: Date,
      default: new Date(),
      required: true,
    },
    leaveStatus: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Expired"],
      default: "Pending",
    },
    leaveReason: {
      type: String,
    },
    leaveStartDate: {
      type: Date,
      required: true,
    },
    leaveEndDate: {
      type: Date,
      required: true,
    },
    isPaid: {
      type: Boolean,
      default: true,
    },
    leaveDays: {
      type: Number,
      required: true,
    },
    leaveTotalHours: {
      type: Number,
    },
    approvedBy: {
      type: mongoose.Types.ObjectId,
      ref: "OfficeEmploye",
      required: false,
    },
    approvedDate: {
      type: Date,
      required: false,
    },
    adminComment: {
      type: String,
    },
    rejectBy: {
      type: mongoose.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    submitBy: {
      type: mongoose.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    isDeletd: {
      type: Boolean,
      default: false,
    },
    wasExpired: {
      type: Boolean,
      default: false,
    },
    addByAdmin: {
      type: Boolean,
      default: false,
    },
    isHalfDay: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const LeaveRequestModel =
  mongoose.models.LeaveRequest ||
  mongoose.model("LeaveRequest", leaveRequestSchema);
export default LeaveRequestModel;
