import mongoose from "mongoose";

/**
 * Company-wide working-time defaults. A single document — there is one set of
 * defaults for the organisation, the same way LeaveSetting holds one leave
 * year.
 *
 * `fixedWeeklyHours` is the figure every employee on the "fixed" weekly-hour
 * type inherits, so changing it here re-values their paid leave without
 * touching each record. Anyone on "custom" carries their own hours and is
 * unaffected.
 */
const workSettingSchema = new mongoose.Schema(
  {
    fixedWeeklyHours: {
      type: Number,
      required: true,
      default: 40,
      min: 1,
      max: 80,
    },
    // Fallback when an employee has no dayPerWeek recorded, used as the
    // divisor that turns weekly hours into a single day's hours.
    defaultDaysPerWeek: {
      type: Number,
      required: true,
      default: 5,
      min: 1,
      max: 7,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    updatedByName: String,
  },
  { timestamps: true }
);

const WorkSettingModel =
  mongoose.models.WorkSetting ||
  mongoose.model("WorkSetting", workSettingSchema);

export default WorkSettingModel;
