import mongoose from "mongoose";

const qrCodeSchema = new mongoose.Schema(
  {
    title: {
      type: String, // e.g., "Main Entrance QR Code"
      required: true,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmployee",
      required: true,
    },
    slug: {
      type: String, // e.g., "main-entrance-qr-code"
      required: true,
      unique: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    scanCount: {
      type: Number,
      default: 0,
    },
    formTitle: {
      type: String, // e.g., "Visitor Check-In Form"
      default: "Welcome! Please Fill Out Your Details",
    },
    successMessage: {
      type: String, // e.g., "Thank you for checking in!"
      default: "Thank you! We will contact you soon.",
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FormTemplate",
      required: true,
    },
    mediaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Media",
    },
  },
  { timestamps: true }
);

const QrCodeModel =
  mongoose.models.QrCode || mongoose.model("QrCode", qrCodeSchema);
export default QrCodeModel;
