import { Schema, model, models } from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const MediaSchema = new Schema(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    fileType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    key: {
      type: String,
      required: true,
    },
    access: {
      type: String,
      enum: ["public", "private"],
      default: "private",
    },
    status: {
      type: String,
      enum: ["uploaded", "processing", "failed", "archived", "deleted"],
      default: "uploaded",
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
    category: {
      type: String,
      trim: true,
      default: "general",
    },
    tags: {
      type: [String],
      default: [],
    },
    archivedAt: {
      type: Date,
    },
    deletedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);
MediaSchema.index({ status: 1 });

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(MediaSchema, "Media");

const MediaModel = models.Media || model("Media", MediaSchema);
export default MediaModel;
