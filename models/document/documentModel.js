import mongoose from "mongoose";

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

const DocumentModel =
  mongoose.models.Document || mongoose.model("Document", DocumentSchema);
export default DocumentModel;
