import mongoose from "mongoose";

const Schema = mongoose.Schema;
const DeviceSchema = new Schema(
  {
    // employeeId: {
    //   type: objectId,
    // },
    employeeName: { type: String, required: true },
    submissionId: String,
    email: { type: String, required: true },
    department: { type: String, required: true },
    devices: { type: Array, default: [] },
    browsers: { type: Array, default: [] },
    submitSystemInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    submissionDate: { type: Date, default: new Date() },
    submittedBy: String,
    encryptionKey: String,
    userAgent: String,
    ipAddress: String,
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const DeviceModel =
  mongoose.models.device || mongoose.model("device", DeviceSchema);
export default DeviceModel;
