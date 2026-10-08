import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";
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

        // WHO this rule applies to.
        //
        // Empty means everybody, which is what every existing rule has — so
        // adding these fields changes nothing until somebody narrows one. Same
        // default-permissive reasoning as data/features.js: nobody loses a
        // setting they were relying on because a new field appeared.
        //
        // A company allowing carry-forward for some staff and not others is the
        // normal case rather than the exception, and writing it as a rule rather
        // than a flag per person means a new joiner is covered the day they are
        // entered. Individual exceptions go on the employee record instead —
        // `carryForwardOverrides` on OfficeEmploye, one entry per leave type.
        appliesTo: {
          // Values from the employee's `employeType` ("Full-Time"/"Part-Time").
          employeeTypes: { type: [String], default: [] },
          // RoleType ids, matching the employee's `department`.
          departments: {
            type: [mongoose.Schema.Types.ObjectId],
            ref: "RoleType",
            default: [],
          },
        },

        // "Only after a year's service." A condition rather than a group, and a
        // common one — carry-forward during probation is unusual. Measured from
        // the employee's join date to the start of the leave year they would be
        // carrying into. 0 means no requirement.
        minMonthsService: {
          type: Number,
          default: 0,
          min: 0,
        },

        // "Only carry if at least this much is left." Stops a long tail of
        // single-day carries cluttering every balance. 0 means no requirement.
        minDaysRemaining: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],
    accrualEnabled: {
      type: Boolean,
      default: false,
    },

    // When a human actually chose these settings, as opposed to this document
    // having been conjured with April defaults by the first read of it —
    // getLeaveSettings() creates one if none exists, so the presence of the
    // document says nothing about whether anybody decided anything.
    //
    // The distinction matters because the leave year start month is not a
    // preference, it is the date every entitlement and every booking is
    // measured from. A company on a January–December year that never saw the
    // question gets April silently, and finds out when the balances are wrong.
    // Null here is what sends a new company to the setup screen.
    configuredAt: {
      type: Date,
      required: false,
    },
    configuredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfficeEmploye",
      required: false,
    },
  },
  { timestamps: true }
);

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(leaveSettingSchema, "LeaveSetting");

const LeaveSettingModel =
  mongoose.models.LeaveSetting ||
  mongoose.model("LeaveSetting", leaveSettingSchema);
export default LeaveSettingModel;
