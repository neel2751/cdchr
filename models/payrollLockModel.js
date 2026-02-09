import mongoose from "mongoose";

const payrollLockSchema = new mongoose.Schema(
  {
    // companyId: {
    //   type: mongoose.Types.ObjectId,
    //   ref: "Company",
    //   required: true,
    // },

    lockType: {
      type: String,
      enum: ["MONTH", "LEAVE_YEAR"],
      required: true,
    },

    // Example:
    // MONTH  → "2026-01"
    // YEAR   → "2025-26"
    lockKey: {
      type: String,
      required: true,
    },

    isLocked: {
      type: Boolean,
      default: true,
    },

    lockedAt: {
      type: Date,
      default: new Date(),
    },

    lockedBy: {
      type: mongoose.Types.ObjectId,
      ref: "OfficeEmploye",
    },

    source: {
      type: String,
      enum: ["MANUAL", "XERO", "SYSTEM"],
      default: "MANUAL",
    },
  },
  { timestamps: true }
);

const PayrollLockModel =
  mongoose.models.PayrollLock ||
  mongoose.model("PayrollLock", payrollLockSchema);

export default PayrollLockModel;
