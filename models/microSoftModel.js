// models/MicrosoftIntegration.ts
import mongoose, { Schema } from "mongoose";

const MicrosoftIntegrationSchema = new Schema(
  {
    employeeId: { type: mongoose.Types.ObjectId, required: true },
    connected: { type: Boolean, default: false },
    accessToken: String,
    refreshToken: String,
    tokenExpiresAt: Date,
  },
  { timestamps: true }
);

const MicrosoftIntegration =
  mongoose.models.MicrosoftIntegration ||
  mongoose.model("MicrosoftIntegration", MicrosoftIntegrationSchema);
export default MicrosoftIntegration;
