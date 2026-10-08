import mongoose from "mongoose";

const Schema = mongoose.Schema;
const objectId = mongoose.Schema.Types.ObjectId;

// Single-use recovery codes. Only the hash is stored, so a leaked database row
// cannot be replayed, and a used code is kept rather than deleted — that is what
// keeps "wrong code" and "already used" distinguishable, and what makes the
// remaining count meaningful.
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
    // When a TOTP code was last accepted. The session-update handler in auth.js
    // requires a recent stamp before it will clear the per-login 2FA gate, so a
    // client cannot simply assert that it verified.
    lastVerifiedAt: {
      type: Date,
    },
    qrCodeUrl: {
      type: String,
    },
    // The way back in when the authenticator app is gone. Without these, an
    // account that must use 2FA (every admin, super admin and platform admin —
    // see the signIn callback in auth.js) is locked out of the product for good
    // the moment its phone is lost.
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
