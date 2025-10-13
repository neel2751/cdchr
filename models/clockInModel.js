import mongoose from "mongoose";
const Schema = mongoose.Schema;

const clockInSchema = new Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "employeeType",
    },
    employeeType: {
      type: String,
      required: true,
      enum: ["Employee", "OfficeEmployee"],
    },
    locationType: {
      type: String,
      enum: ["site", "office"],
      default: "site",
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
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
    breaks: [
      {
        breakIn: {
          type: String,
          match: /^([01]\d|2[0-3]):([0-5]\d)$/,
        },
        breakOut: {
          type: String,
          match: /^([01]\d|2[0-3]):([0-5]\d)$/,
        },
        _id: false,
      },
    ],
    overtime: {
      type: Number,
      default: 0,
    },
    clockInLocation: String,
    clockBy: String,
    status: String,
    date: {
      type: Date,
      required: true,
    },
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

const ClockRecordModel =
  mongoose.models.ClockRecord || mongoose.model("ClockRecord", clockInSchema);
export default ClockRecordModel;
