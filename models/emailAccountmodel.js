import { decrypt, encrypt } from "@/lib/algo";
import mongoose from "mongoose";

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

emailAccountSchema.index(
  { feature: 1, isPrimary: 1 },
  { unique: true, partialFilterExpression: { isPrimary: true } }
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

const EmailAccountModel =
  mongoose.models.EmailAccount ||
  mongoose.model("EmailAccount", emailAccountSchema);
export default EmailAccountModel;
