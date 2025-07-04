import mongoose from "mongoose";

const attendance = new mongoose.Schema({
  employeeId: {
    type: mongoose.Types.ObjectId,
    ref: "OfficeEmploye",
  },
  employeeName: {
    type: String,
  },
  schedule: Array, // if it is not work so make Object again
});

const weeklyRotaSchema = new mongoose.Schema(
  {
    weekStartDate: {
      type: Date,
    },
    attendanceData: [attendance],
    submitDate: {
      type: Date,
      default: new Date(),
    },
    // we have to make one for approve  and reject
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    approvedCount: {
      type: Number,
      default: 0,
    },
    approvedDate: {
      type: Date,
    },
    approvedStatus: {
      type: String,
      enum: ["Approved", "Rejected", "Pending"],
      default: "Approved",
    },
    rejectedReason: {
      type: String,
    },
    status: {
      enum: ["Active", "Inactive"],
      default: "Active",
      type: String,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const WeeklyRotaModel =
  mongoose.models.WeeklyRota || mongoose.model("WeeklyRota", weeklyRotaSchema);
export default WeeklyRotaModel;
