import mongoose from "mongoose";

const ReceiptFileSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
    },
    access: {
      type: String,
      enum: ["public", "private"],
      default: "private",
    },
    fileSize: {
      type: Number,
      required: true,
    },
    fileType: {
      type: String,
      required: true,
    },
    uploadedAt: Date,
    uploadedBy: mongoose.Types.ObjectId,
  },
  { _id: false }
);

const expenseSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    title: {
      type: String,
      required: true,
      minlength: 3,
      maxlength: 100,
    },
    amount: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    categoryLabel: {
      type: String,
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    date: {
      type: Date,
      required: true,
    },
    receiptFiles: [ReceiptFileSchema],
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);
const ExpenseModel =
  mongoose.models.Expense || mongoose.model("Expense", expenseSchema);
export default ExpenseModel;
