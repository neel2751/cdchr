import mongoose from "mongoose";

// One stored copy of a week's attendance sheet. The same shape is reused for
// the live file and for every superseded file kept in `previousFiles`, so a
// replaced upload is still downloadable from the record's detail view.
const AttendanceUploadFileSchema = new mongoose.Schema(
  {
    // Name the file had on the uploader's machine — the randomized S3 name is
    // useless to a human, so the UI always shows this one.
    originalName: {
      type: String,
      required: true,
    },
    // Randomized name generated at upload time (last segment of `key`).
    fileName: {
      type: String,
      required: true,
    },
    key: {
      type: String,
      required: true,
    },
    fileType: String,
    fileSize: Number,
    access: {
      type: String,
      enum: ["public", "private"],
      default: "private",
    },
    uploadedAt: Date,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    // Denormalized so the detail view can name the uploader of an old file
    // without a second lookup per version.
    uploadedByName: String,
  },
  { _id: false }
);

const attendanceUploadSchema = new mongoose.Schema(
  {
    // Monday of the covered week, normalized to UTC midnight. Weeks run
    // Monday–Sunday here to match the weekly rota.
    weekStartDate: {
      type: Date,
      required: true,
    },
    weekEndDate: {
      type: Date,
      required: true,
    },
    note: {
      type: String,
      trim: true,
    },
    file: {
      type: AttendanceUploadFileSchema,
      required: true,
    },
    // Files this week previously held, newest first. Populated when a super
    // admin re-uploads over an existing week.
    previousFiles: {
      type: [AttendanceUploadFileSchema],
      default: [],
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    uploadedByName: String,
    uploadedByEmail: String,
    lastReplacedAt: Date,
  },
  { timestamps: true }
);

// One record per week — this is what makes "already uploaded" authoritative
// rather than a best-effort check the UI does before submitting.
attendanceUploadSchema.index({ weekStartDate: 1 }, { unique: true });

const AttendanceUploadModel =
  mongoose.models.AttendanceUpload ||
  mongoose.model("AttendanceUpload", attendanceUploadSchema);

export default AttendanceUploadModel;
