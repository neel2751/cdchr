import mongoose from "mongoose";

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

const AttendanceCategoryModel =
  mongoose.models.AttendanceCategory ||
  mongoose.model("AttendanceCategory", attendanceCategorySchema);
export default AttendanceCategoryModel; // export the model
