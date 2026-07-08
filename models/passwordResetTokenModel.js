import mongoose from "mongoose";

// Single-use, time-limited tokens for the self-service "forgot password" flow.
// Only a SHA-256 hash of the token is stored, so a database leak does not expose
// usable reset links.
const passwordResetTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Types.ObjectId, required: true },
    userType: { type: String }, // "office" | "site" | "reception"
    email: { type: String },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Auto-remove documents once they expire.
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
passwordResetTokenSchema.index({ userId: 1, usedAt: 1 });

const PasswordResetTokenModel =
  mongoose.models.PasswordResetToken ||
  mongoose.model("PasswordResetToken", passwordResetTokenSchema);

export default PasswordResetTokenModel;
