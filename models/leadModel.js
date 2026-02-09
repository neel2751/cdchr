import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ["agent", "lead"],
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ["sent", "delivered", "read"],
    default: "sent",
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const leadSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
      required: true,
    },
    qrCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QRCode",
      required: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FormTemplate",
      required: true,
    },
    // Automatically extract common fields for easier searching and filtering
    name: {
      type: String,
    },
    email: {
      type: String,
    },
    // any field mixed with any type of data
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "lost"],
      default: "new",
    },
    conversations: [conversationSchema],
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const LeadModel = mongoose.models.Lead || mongoose.model("Lead", leadSchema);
export default LeadModel;
