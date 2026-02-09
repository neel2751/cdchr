import mongoose from "mongoose";

// create a schema for the office user model
const officeUserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    authorizedDevices: [
      {
        deviceId: String, // The Hardware Fingerprint
        deviceName: String, // e.g., "Main Reception PC"
        addedAt: { type: Date, default: Date.now },
      },
    ],
    restrictedIPAddresses: [
      {
        ipAddress: String,
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    enforceDeviceLock: { type: Boolean, default: true },
    isActive: {
      type: Boolean,
      default: true,
    },
    delete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const OfficeUserModel =
  mongoose.models.OfficeUser || mongoose.model("OfficeUser", officeUserSchema);
export default OfficeUserModel;
