import mongoose from "mongoose";
const leaveSettingSchema = new mongoose.Schema(
  {
    // Later this will be real companyId (for now can be null or default)
    // companyId: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "Company",
    //   default: null,
    // },
    // 1 = January, 4 = April etc.
    leaveYearStartMonth: {
      type: Number,
      required: true,
      default: 4, // Current system = April
      min: 1,
      max: 12,
    },

    // Carry forward unused leaves to next year (future use)
    carryForwardEnabled: {
      type: Boolean,
      default: false,
    },

    carryForwardRules: [
      {
        leaveType: {
          type: String,
          required: true,
        },
        allowed: {
          type: Boolean,
          default: false,
        },
        maxDays: {
          type: Number,
          default: 0,
        },
        expireAfterMonths: {
          type: Number,
          default: 0,
        },
        proRated: {
          type: Boolean,
          default: false,
        },
      },
    ],
    accrualEnabled: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const LeaveSettingModel =
  mongoose.models.LeaveSetting ||
  mongoose.model("LeaveSetting", leaveSettingSchema);
export default LeaveSettingModel;
