import mongoose from "mongoose";

const visitorPurposeSchema = new mongoose.Schema({
  visitorPurpose: {
    type: String,
    required: true,
  },
  visitorType: {
    type: String,
    required: true,
  },
  visitorStatus: {
    type: String,
    default: "pending",
  },
  otherPurpose: {
    type: String,
  },
  visitorCheckInTime: {
    type: Date,
  },
  visitorCheckOutTime: {
    type: Date,
  },
  visitorNotes: {
    type: String,
  },
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});

const visitorSchema = new mongoose.Schema(
  {
    visitorName: {
      type: String,
      required: true,
    },
    visitorEmail: {
      type: String,
      required: true,
    },
    visitorPhone: {
      type: String,
      required: true,
    },
    visitorCompany: {
      type: String,
    },
    visitorPurpose: {
      type: [visitorPurposeSchema],
      required: true,
    },
  },
  { timestamps: true }
);
const VisitorModel =
  mongoose.models.Visitor || mongoose.model("Visitor", visitorSchema);
export default VisitorModel;
