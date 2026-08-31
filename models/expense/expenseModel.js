import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

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
    isDeleted: {
      type: Boolean,
      default: false,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    archivedAt: Date,
    deletedAt: Date,
    uploadedAt: Date,
    uploadedBy: mongoose.Types.ObjectId,
  },
  { _id: false }
);

const expenseSchema = new mongoose.Schema(
  {
    // Who filed it. The actions also used to set `createdBy`, `updatedBy` and
    // `isActive`, none of which were on this schema — so Mongoose dropped all
    // three on every write and the approval check that read `createdBy` matched
    // nobody. This field is the filer; `updatedBy` below is now real.
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Who last changed it — in practice whoever approved or rejected it.
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
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
      // The last line of defence. The actions validate too, but a schema rule
      // also covers the direct writes a script or a migration might make.
      min: [0, "Amount cannot be negative"],
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
// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(expenseSchema, "Expense");

// The site-expense tab's query: one project's spend, newest first. The plugin
// adds { tenantId, createdAt }, which does not serve the projectId filter.
expenseSchema.index({ tenantId: 1, projectId: 1, date: -1 });

const ExpenseModel =
  mongoose.models.Expense || mongoose.model("Expense", expenseSchema);
export default ExpenseModel;
