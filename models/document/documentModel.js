import mongoose from "mongoose";

const DocumentFileSchema = new mongoose.Schema({
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
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
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
    title: {
      type: String,
      required: true,
      minlength: 3,
      maxlength: 100,
    },
    description: {
      type: String,
    },
    documentsFiles: [DocumentFileSchema],
  },
  { timestamps: true }
);

const DocumentModel =
  mongoose.models.Document || mongoose.model("Document", DocumentSchema);
export default DocumentModel;
