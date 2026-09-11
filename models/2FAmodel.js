import mongoose from "mongoose";

const Schema = mongoose.Schema;
const objectId = mongoose.Schema.Types.ObjectId;

// Single-use recovery codes. Only the hash is stored, so a leaked database row
// cannot be replayed, and a used code is kept (rather than deleted) so the
// remaining count and the "already used" case stay distinguishable.
const BackupCodeSchema = new Schema(
  {
    codeHash: {
      type: String,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

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
    backupCodes: {
      type: [BackupCodeSchema],
      default: [],
    },
    backupCodesGeneratedAt: {
      type: Date,
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
