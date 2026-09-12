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
      enum: [
        "Pending",
        "Approved",
        "Rejected",
        "Expired",
        "Cancelled",
        "Rolled Back",
      ],
      default: "Pending",
    },
    leaveReason: {
      type: String,
    },
    leaveDates: {
      type: [Date], // can hold multiple scattered dates
      required: true,
    },
    leaveBreakdown: [
      {
        leaveType: String,
        leaveYear: String,
        leaveDays: Number,
      },
    ],

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
    isDeleted: {
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
    halfDayType: {
      type: String,
      enum: ["First Half", "Second Half"],
    },
    // Fit note / sick note evidence. Mandatory once a sick leave runs for
    // SICK_NOTE_MIN_CONSECUTIVE_DAYS consecutive calendar days or more.
    sickNote: {
      key: String,
      fileName: String,
      fileSize: Number,
      fileType: String,
      access: {
        type: String,
        default: "private",
      },
      uploadedAt: Date,
      uploadedBy: {
        type: mongoose.Types.ObjectId,
        ref: "OfficeEmploye",
      },
    },
    // A super admin can undo an approval. The request is never deleted — it
    // keeps its history and carries who reversed it, when, and why.
    rollback: {
      reason: String,
      previousStatus: String,
      rolledBackBy: {
        type: mongoose.Types.ObjectId,
        ref: "OfficeEmploye",
      },
      rolledBackAt: Date,
      // Days handed back to the balance, so the entry is auditable on its own.
      restoredDays: Number,
      restoredLeaveType: String,
    },
  },
  { timestamps: true }
);

const LeaveRequestModel =
  mongoose.models.LeaveRequest ||
  mongoose.model("LeaveRequest", leaveRequestSchema);
export default LeaveRequestModel;
