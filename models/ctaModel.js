import mongoose from "mongoose";

const ctaSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
      required: true,
    },
    headerText: {
      type: String,
      default: "Get in Touch with Us!",
    },
    website: {
      type: String,
      default: "",
    },
    contactNumber: {
      type: String,
      default: "",
    },
    email: {
      type: String,
      default: "",
    },
    mediaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Media",
    },
    logoUrl: {
      type: String,
      default: "",
    },
    brandColor: {
      type: String,
      default: "#000000",
    },
    backgroundColor: {
      type: String,
      default: "#ffffff",
    },
    textColor: {
      type: String,
      default: "#000000",
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

const CtaModel = mongoose.models.Cta || mongoose.model("Cta", ctaSchema);
export default CtaModel;
