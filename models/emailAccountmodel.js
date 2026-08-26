import { decrypt, encrypt } from "@/lib/algo";
import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

const emailAccountSchema = new mongoose.Schema(
  {
    host: {
      type: String,
      required: true,
    },
    otherHost: {
      type: String,
      required: function () {
        // Only required if host is 'other'
        return this.host === "other";
      },
    },
    feature: {
      type: String,
      required: true,
    },
    port: {
      type: Number,
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    toEmail: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          // Simple email validation regex
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: (props) => `${props.value} is not a valid email address!`,
      },
    },
    password: {
      type: String,
      required: true,
    },
    secure: {
      type: Boolean,
      default: false,
    },
    // label: { type: String }, // e.g., 'HR Bot', 'Invoice Sender'
    fromName: {
      type: String,
      required: true,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    isTest: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    icon: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

/**
 * One primary sender per feature, PER COMPANY.
 *
 * This was `{ feature, isPrimary }`, which is platform-wide: once any company
 * marked an "HR" sender primary, no other company could. `tenantId` is added by
 * the tenant plugin (see lib/tenantPlugin.js) and leads the key here, so each
 * company gets its own primary for each feature.
 *
 * Platform-level fallback senders have no tenantId; the partial filter keeps
 * them out of the constraint so several may exist.
 */
emailAccountSchema.index(
  { tenantId: 1, feature: 1, isPrimary: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isPrimary: true,
      tenantId: { $exists: true },
    },
  }
);

// Encrypt password before saving
emailAccountSchema.pre("save", function (next) {
  if (this.isModified("password")) {
    this.password = encrypt(this.password);
  }
  next();
});

// Add method to decrypt password on the instance
emailAccountSchema.methods.getDecryptedPassword = function () {
  return decrypt(this.password);
};

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(emailAccountSchema, "EmailAccount");

const EmailAccountModel =
  mongoose.models.EmailAccount ||
  mongoose.model("EmailAccount", emailAccountSchema);
export default EmailAccountModel;
