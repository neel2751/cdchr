import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const DocumentFileSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  fileName: {
    type: String,
    required: true,
  },
  key: {
    type: String,
    required: true,
  },
  docType: {
    type: String,
    default: "other",
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
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
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
});

const DocumentSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    docType: {
      type: String,
      default: "other",
    },
    description: {
      type: String,
    },
    documentsFiles: [DocumentFileSchema],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and companyId field are not attached.
applyTenantScope(DocumentSchema, "Document");

const DocumentModel =
  mongoose.models.Document || mongoose.model("Document", DocumentSchema);
export default DocumentModel;
