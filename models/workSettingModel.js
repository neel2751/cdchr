import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

/**
 * Company-wide working-time defaults. One document *per company* — there is one
 * set of defaults for the organisation, the same way LeaveSetting holds one
 * leave year.
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
    // Does this company close on UK bank holidays?
    //
    // Off — the default, and what every company did before this existed — means
    // a bank holiday is an ordinary working day: booking it off spends a day of
    // annual leave like any other. On means the office is shut, so those days
    // are removed from a leave request rather than deducted.
    //
    // Default false deliberately: it is exactly the current behaviour, so
    // enabling this feature moves nobody's balance. A company that does close
    // turns it on for itself.
    observesBankHolidays: {
      type: Boolean,
      default: false,
    },
    // Which of gov.uk's three published lists this company follows. They are
    // genuinely different: Scotland has 2 January and St Andrew's Day and does
    // not take Easter Monday; Northern Ireland adds St Patrick's Day and the
    // Twelfth. A Scottish company on the England list is told to work 2 January
    // and to take a day it does not get.
    //
    // Defaults to england-and-wales, which is the list the app fetched
    // unconditionally before this existed.
    bankHolidayRegion: {
      type: String,
      enum: ["england-and-wales", "scotland", "northern-ireland"],
      default: "england-and-wales",
    },
    // ---- Clock in/out rules -------------------------------------------
    //
    // The longest a single shift may be. Not really a policy so much as the
    // line between a night shift and a typo: a clock out earlier than the
    // clock in wraps past midnight either way, and only the resulting length
    // tells 22:00–06:00 apart from a mistyped 09:00–08:00.
    maxShiftHours: {
      type: Number,
      default: 16,
      min: 1,
      max: 24,
    },
    // The three below are genuine policy, and all default to 0 — meaning off.
    //
    // Each one already existed in the scanner as a hard-coded constant (no
    // break in the first 2 hours, 30-minute minimum break, 2 hours before
    // clocking out), but the check behind it subtracted two "HH:mm" strings
    // and compared the NaN, so not one of them has ever refused a scan. Turning
    // them on by default would therefore start rejecting scans that have always
    // been accepted. Off is the honest default: it is what every company has
    // today, and a company that wants the rule enables it.
    minMinutesBeforeBreak: {
      type: Number,
      default: 0,
      min: 0,
      max: 720,
    },
    minBreakMinutes: {
      type: Number,
      default: 0,
      min: 0,
      max: 720,
    },
    minMinutesBeforeClockOut: {
      type: Number,
      default: 0,
      min: 0,
      max: 1440,
    },
    // The day this company's clock data starts being answerable.
    //
    // The auto-closer flags a shift nobody clocked out of, so an admin can go
    // and settle it. Run against migrated history that has never been reviewed,
    // it opens the queue with months of holes that nobody can answer — one
    // company's first run would have flagged 24, the oldest sixteen months old.
    // A queue full of unanswerable items is a queue people stop reading, which
    // costs more than the rows it found.
    //
    // So: nothing dated before this is flagged, and nothing before it is priced
    // for overtime either — writing a pay figure onto a record from before the
    // system was authoritative is the same retroactive change, and a quieter
    // one, because it lands in a report rather than a queue.
    //
    // null — the default — means no floor, which is right for a company with no
    // legacy data: there is no unreviewed history to hide, and a floor would
    // only mask real gaps. It is set at migration time by
    // scripts/set-clock-cutover.mjs, and is editable on the clock rules screen.
    clockCutoverDate: {
      type: Date,
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
    },
    updatedByName: String,
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is compiled,
// or the hooks and tenantId field are not attached.
//
// Not optional here: the reads below are `findOne()` with no filter, written for
// a single-tenant deployment where exactly one document exists. Unscoped, every
// company would share one row — so one super admin raising their fixed weekly
// hours would silently re-value paid leave for every other company on the
// platform. LeaveSetting, which this model is modelled on, is scoped for the
// same reason.
applyTenantScope(workSettingSchema, "WorkSetting");

const WorkSettingModel =
  mongoose.models.WorkSetting ||
  mongoose.model("WorkSetting", workSettingSchema);

export default WorkSettingModel;
