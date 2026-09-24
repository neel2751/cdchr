import mongoose from "mongoose";

/**
 * Our own details, as the sender. One document, not one per tenant.
 *
 * Exists because a dispatch label needs a return address, and there was
 * nowhere to put one: every settings model in this codebase is a customer's
 * settings. Platform-level and listed in GLOBAL_MODELS for the same reason
 * TagProduct is — these are the details of the company doing the shipping, not
 * of anyone receiving.
 *
 * Deliberately small. This is not a general platform-configuration store; it
 * is the handful of fields that have to appear on a printed label, and it
 * should stay that.
 */
const platformSettingSchema = new mongoose.Schema(
  {
    // The `singleton: "only"` trick: a unique index on a field with exactly
    // one legal value means a second document cannot be created, so "the
    // settings" is never ambiguous the way a findOne() with no filter is.
    singleton: {
      type: String,
      default: "only",
      enum: ["only"],
      unique: true,
    },

    dispatchFromName: { type: String, default: "" },
    // Free text, printed as typed with line breaks kept. Not structured,
    // because a label is read by a human and a postal address that has been
    // forced into fields is a postal address with a wrong field.
    dispatchFromAddress: { type: String, default: "" },
    dispatchContact: { type: String, default: "" },
    // Printed under "if undelivered, return to" — the thing that gets a lost
    // box back rather than binned.
    dispatchReturnNote: { type: String, default: "" },
  },
  { timestamps: true },
);

// Deliberately NOT tenant-scoped. See the note above.
const PlatformSettingModel =
  mongoose.models.PlatformSetting ||
  mongoose.model("PlatformSetting", platformSettingSchema);

export default PlatformSettingModel;
