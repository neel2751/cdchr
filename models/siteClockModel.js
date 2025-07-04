import mongoose from "mongoose";

const siteClockSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
    },
    clockIn: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/, // optional: validate "HH:mm" format
    },
    clockOut: {
      type: String,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
    breakIn: {
      type: String,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
    breakOut: {
      type: String,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
    clockInLocation: {
      type: String,
    },
    clockInStatus: {
      type: Boolean,
      default: true,
    },
    clockBy: {
      type: String,
    },
    status: {
      type: String,
    },
    date: {
      type: Date,
      required: true,
    },
    actions: [
      {
        action: String,
        time: Date,
        source: String,
      },
    ],
    isLocked: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const SiteClockModel =
  mongoose.models.SiteClock || mongoose.model("SiteClock", siteClockSchema);
export default SiteClockModel;
