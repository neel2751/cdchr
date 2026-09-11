import mongoose from "mongoose";

/**
 * A self-serve signup that has been started but not yet confirmed by email.
 *
 * Nothing real is created until the link in the email is clicked: no company,
 * no employee record, no membership. The whole intent is parked here and
 * replayed by `completeSignup()`.
 *
 * That ordering is deliberate. Creating the tenant up front and activating it
 * on confirmation would mean anyone could reserve `acme` — permanently, with an
 * address they do not own — and the platform console would fill with half-built
 * companies that `isTenantUsable()` and hostname resolution then have to reason
 * about. Here an abandoned signup simply expires and disappears.
 *
 * The trade is that a slug is only checked, never held, so two people can pass
 * the check and race for it. `completeSignup()` re-checks at the moment of
 * creation, and the loser is told the address went.
 *
 * NOT tenant-scoped (see GLOBAL_MODELS in lib/tenantPlugin.js): it is written
 * and read before the tenant it describes exists.
 */
const pendingSignupSchema = new mongoose.Schema(
  {
    // --- the company to create -------------------------------------------
    companyName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },

    // --- the owner account to create --------------------------------------
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phoneNumber: { type: Number, required: true },

    // Hashed at the point of signup, exactly as it would be on the employee
    // record, so a plaintext password never rests in this collection either.
    passwordHash: { type: String, required: true },

    // --- the confirmation link --------------------------------------------
    // Only a SHA-256 hash, matching PasswordResetToken: a database leak must
    // not hand out working confirmation links.
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },

    // Throttles "send it again" without needing a separate counter.
    lastSentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Abandoned signups clear themselves out once they expire.
pendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// One outstanding signup per email — startSignup() replaces rather than stacks.
pendingSignupSchema.index({ email: 1, usedAt: 1 });

// Not unique: an unconfirmed signup reserves nothing (see the note above), so
// several may name the same slug. Ownership is settled at confirmation.
pendingSignupSchema.index({ slug: 1 });

const PendingSignupModel =
  mongoose.models.PendingSignup ||
  mongoose.model("PendingSignup", pendingSignupSchema);

export default PendingSignupModel;
