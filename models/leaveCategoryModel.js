import mongoose from "mongoose";

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

const LeaveCategoryModel =
  mongoose.models.LeaveCategory ||
  mongoose.model("LeaveCategory", leaveCategorySchema);
export default LeaveCategoryModel; // export the model
