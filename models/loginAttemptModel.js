import mongoose from "mongoose";

// Tracks failed login attempts for brute-force protection. Records are keyed by
// `${email}|${ip}` so throttling is scoped to a single source — this prevents an
// attacker from one IP brute-forcing an account without locking that account out
// for the legitimate user signing in from elsewhere.
const loginAttemptSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    email: { type: String },
    ip: { type: String },
    count: { type: Number, default: 0 },
    firstAttemptAt: { type: Date, default: Date.now },
    lastAttemptAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

// Auto-clean stale records 24h after the last attempt.
loginAttemptSchema.index(
  { lastAttemptAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 }
);

const LoginAttemptModel =
  mongoose.models.LoginAttempt ||
  mongoose.model("LoginAttempt", loginAttemptSchema);

export default LoginAttemptModel;
