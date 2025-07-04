import mongoose from "mongoose";

const employeAttendanceSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Types.ObjectId,
    ref: "Employe",
    required: true,
  },
  hours: {
    type: Number,
    required: true,
    validate(value) {
      if (typeof value !== "number") throw new Error("Hours must be a number");
    },
  },
  breakHours: {
    type: Number,
    default: 0,
    validate(value) {
      if (this.hours < value)
        throw new Error("Break time can't be longer than work time");
    },
  },
  extraHours: {
    type: Number,
    default: 0,
  },
  totalHours: {
    type: Number,
    required: true,
  },
  totalPay: {
    type: Number,
    required: true,
  },
  aPayRate: {
    type: Number,
    required: true,
  },
  aDate: {
    type: Date,
    required: true,
  },
  isPresent: {
    type: Boolean,
    required: true,
  },
  note: { type: String, required: false },
});
const attendanceSchema = new mongoose.Schema(
  {
    attendanceDate: {
      type: Date,
      required: true,
    },
    siteId: {
      type: mongoose.Types.ObjectId,
      ref: "ProjectSite",
      required: true, // Ensure siteId is mandatory
    },
    employeAttendance: {
      type: [employeAttendanceSchema],
      required: true,
    },
  },
  { timestamps: true, versionKey: false }
);

const AttendanceModel =
  mongoose.models.Attendance || mongoose.model("Attendance", attendanceSchema);
export default AttendanceModel;
