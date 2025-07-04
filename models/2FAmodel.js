import mongoose from "mongoose";

const Schema = mongoose.Schema;
const objectId = mongoose.Schema.Types.ObjectId;
const TwoFASchema = new Schema(
  {
    employeeId: {
      type: objectId,
    },
    secret: {
      type: String,
      required: true,
    },
    isEnabled: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    qrCodeUrl: {
      type: String,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const TwoFAMoldel =
  mongoose.models.TwoFA || mongoose.model("TwoFA", TwoFASchema);
export default TwoFAMoldel;
