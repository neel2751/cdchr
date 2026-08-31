import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

// create a schema for the site expense model
const expenseCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    budget: {
      type: Number,
      required: true,
      min: [0, "Budget cannot be negative"],
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    projectIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    status: {
      type: Boolean,
      default: false,
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

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(expenseCategorySchema, "ExpenseCategory");

const ExpenseCategoryModel =
  mongoose.models.ExpenseCategory ||
  mongoose.model("ExpenseCategory", expenseCategorySchema);

export default ExpenseCategoryModel;
