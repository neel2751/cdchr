import mongoose from "mongoose";

const EmailUsageSchema = new mongoose.Schema(
  {
    feature: { type: String, required: true }, // e.g., 'invoice', 'payroll'
    emailId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    status: {
      type: String,
      enum: ["success", "error", "pending"],
      default: "pending",
    },
    emailSendType: {
      type: String,
      enum: ["Test", "Live"],
      default: "Live",
    },
    emailDate: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// 🔍 Ensure only one primary per feature
// EmailUsageSchema.index(
//   { feature: 1, isPrimary: 1 },
//   { unique: true, partialFilterExpression: { isPrimary: true } }
// );

const EmailUsageModel =
  mongoose.models.EmailUsage || mongoose.model("EmailUsage", EmailUsageSchema);
export default EmailUsageModel;
