import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

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
        // Which office this screen physically stands in.
        //
        // A reception screen is a fixed object in a fixed room, so the screen
        // is what should answer "which office is this?" — not the person
        // signing in, who may work at either, and not the browser, which was
        // where the answer lived before: a dropdown remembered in
        // localStorage, chosen by whoever was standing there, lost on a cache
        // clear, and silently wrong if mis-picked. Attendance then landed at
        // the other office with nothing looking broken.
        //
        // Null means unenrolled, and the screen falls back to asking. See
        // CLOCK_LOCATION_PLAN.md §10.4.
        locationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ClockLocation",
          default: null,
        },
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

    // This account exists to run a reception desk, rather than belonging to a
    // member of office staff.
    //
    // The distinction had no field behind it: getReceptionUsers filtered on
    // `delete: false` alone, so the Reception screen listed every office
    // employee in the company, and updateReceptionUserPassword guarded on
    // `user.isReception` — which nothing set and the session never carried, so
    // that action could never authorise anybody at all.
    isReception: { type: Boolean, default: false },

    // The office this desk stands in.
    //
    // A screen registered under authorizedDevices wins over this, because the
    // screen is the thing that is physically in a room. This is the fallback
    // for a desk signing in on a device nobody has enrolled yet — without it
    // the screen falls all the way back to asking the person standing at it,
    // whose answer lives in that browser only.
    clockLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClockLocation",
      default: null,
    },
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

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(officeUserSchema, "OfficeUser");

const OfficeUserModel =
  mongoose.models.OfficeUser || mongoose.model("OfficeUser", officeUserSchema);
export default OfficeUserModel;
