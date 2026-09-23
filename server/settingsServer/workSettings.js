"use server";

import { connect } from "@/db/db";
import { withAudit, recordAudit } from "@/lib/audit";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import {
  DEFAULT_DAYS_PER_WEEK,
  DEFAULT_FIXED_WEEKLY_HOURS,
} from "@/lib/workHours";
import WorkSettingModel from "@/models/workSettingModel";
import { BANK_HOLIDAY_REGIONS } from "@/data/bankHolidayRegions";
import {
  DEFAULT_MAX_SHIFT_HOURS,
  describeMinutes,
  resolveClockRules,
  resolveCutover,
} from "@/lib/clockRules";
import { getServerSideProps } from "../session/session";

/** The enforced policy in one phrase, for the audit log. */
function describeClockPolicy(rules) {
  const on = [];
  if (rules.minMinutesBeforeBreak > 0)
    on.push(`no break within ${describeMinutes(rules.minMinutesBeforeBreak)}`);
  if (rules.minBreakMinutes > 0)
    on.push(`breaks at least ${describeMinutes(rules.minBreakMinutes)}`);
  if (rules.minMinutesBeforeClockOut > 0)
    on.push(
      `clock out after ${describeMinutes(rules.minMinutesBeforeClockOut)}`,
    );
  return on.length ? on.join(", ") : "off";
}

/**
 * The company-wide working-time defaults, creating the single settings
 * document on first read so callers never have to handle its absence.
 *
 * Readable by any signed-in admin — the figure drives numbers shown on the
 * attendance screens — but only a super admin can change it.
 */
export async function getWorkSettings() {
  try {
    await connect();
    let settings = await WorkSettingModel.findOne();
    if (!settings) {
      settings = await WorkSettingModel.create({
        fixedWeeklyHours: DEFAULT_FIXED_WEEKLY_HOURS,
        defaultDaysPerWeek: DEFAULT_DAYS_PER_WEEK,
      });
    }
    return { success: true, data: JSON.stringify(settings) };
  } catch (error) {
    console.log("Error fetching work settings:", error);
    return {
      success: false,
      message: "Failed to load working-time settings",
      data: JSON.stringify({
        fixedWeeklyHours: DEFAULT_FIXED_WEEKLY_HOURS,
        defaultDaysPerWeek: DEFAULT_DAYS_PER_WEEK,
      }),
    };
  }
}

/**
 * Just the clock rules, resolved and ready to enforce.
 *
 * A plain read with defaults rather than `getWorkSettings`, because this sits
 * on the scan path: a company that has never opened the settings screen should
 * not have a document written for them every time someone clocks in, and a
 * settings read that fails should fall back to the defaults rather than stop
 * the scanner.
 */
export async function getClockRules() {
  try {
    await connect();
    const settings = await WorkSettingModel.findOne()
      .select(
        "maxShiftHours minMinutesBeforeBreak minBreakMinutes minMinutesBeforeClockOut clockCutoverDate",
      )
      .lean();
    return resolveClockRules(settings);
  } catch (error) {
    console.log("Error loading clock rules, using defaults:", error);
    return resolveClockRules(null);
  }
}

/**
 * Change the company-wide defaults. Super admin only: the fixed figure values
 * the paid leave of everyone who is not on custom hours, so it moves numbers
 * across the whole organisation at once.
 */
export const updateWorkSettings = withAudit(
  "WorkSetting.update",
  async function ({
    fixedWeeklyHours,
    defaultDaysPerWeek,
    observesBankHolidays,
    bankHolidayRegion,
    maxShiftHours,
    minMinutesBeforeBreak,
    minBreakMinutes,
    minMinutesBeforeClockOut,
    clockCutoverDate,
  } = {}) {
    try {
      const { props } = await getServerSideProps();
      const user = props?.session?.user;
      if (user?.role !== "superAdmin") {
        return { success: false, message: "Not authorized" };
      }

      const hours = Number(fixedWeeklyHours);
      const days = Number(defaultDaysPerWeek);
      if (!Number.isFinite(hours) || hours < 1 || hours > 80) {
        return {
          success: false,
          message: "Weekly hours must be between 1 and 80",
        };
      }
      if (!Number.isFinite(days) || days < 1 || days > 7) {
        return {
          success: false,
          message: "Days per week must be between 1 and 7",
        };
      }

      await connect();
      const before = await WorkSettingModel.findOne().lean();
      // Left alone when the caller does not mention it, so a save from the
      // working-hours form cannot silently flip a company's bank holiday rule.
      const observes =
        observesBankHolidays === undefined
          ? before?.observesBankHolidays ?? false
          : !!observesBankHolidays;

      // An unknown region is rejected rather than silently defaulted: saving a
      // company onto the wrong list would give them the wrong days off.
      const region =
        bankHolidayRegion === undefined
          ? before?.bankHolidayRegion ?? "england-and-wales"
          : bankHolidayRegion;
      if (!BANK_HOLIDAY_REGIONS.some((r) => r.value === region)) {
        return { success: false, message: "Unknown bank holiday region" };
      }

      // Clock rules. Each is left at its saved value when the caller does not
      // mention it, for the same reason the bank holiday rule is: a save from
      // one form must not reset a setting another form owns.
      const keepOrSet = (incoming, saved, fallback) =>
        incoming === undefined ? saved ?? fallback : Number(incoming);

      const clockRules = {
        maxShiftHours: keepOrSet(
          maxShiftHours,
          before?.maxShiftHours,
          DEFAULT_MAX_SHIFT_HOURS,
        ),
        minMinutesBeforeBreak: keepOrSet(
          minMinutesBeforeBreak,
          before?.minMinutesBeforeBreak,
          0,
        ),
        minBreakMinutes: keepOrSet(
          minBreakMinutes,
          before?.minBreakMinutes,
          0,
        ),
        minMinutesBeforeClockOut: keepOrSet(
          minMinutesBeforeClockOut,
          before?.minMinutesBeforeClockOut,
          0,
        ),
      };

      // The cutover is a date, not a number, so it sits outside keepOrSet and
      // the numeric bounds below. Three cases, all meaningful:
      //   undefined -> not mentioned, keep what is saved
      //   null / "" -> explicitly cleared, meaning flag all history
      //   a date    -> the floor
      let cutover = before?.clockCutoverDate ?? null;
      if (clockCutoverDate !== undefined) {
        if (clockCutoverDate === null || clockCutoverDate === "") {
          cutover = null;
        } else {
          const parsed = resolveCutover(clockCutoverDate);
          if (!parsed) {
            return { success: false, message: "Invalid clock cutover date" };
          }
          // A future cutover would silently switch the auto-closer off for
          // everything up to it — including shifts not yet worked. That is
          // never what someone means, and it fails silently, so it is refused.
          if (parsed.getTime() > Date.now()) {
            return {
              success: false,
              message: "The clock cutover date cannot be in the future",
            };
          }
          cutover = parsed;
        }
      }

      const bounds = {
        maxShiftHours: [1, 24, "Maximum shift length must be between 1 and 24 hours"],
        minMinutesBeforeBreak: [0, 720, "Minimum time before a break must be between 0 and 720 minutes"],
        minBreakMinutes: [0, 720, "Minimum break length must be between 0 and 720 minutes"],
        minMinutesBeforeClockOut: [0, 1440, "Minimum time before clocking out must be between 0 and 1440 minutes"],
      };
      for (const [key, [min, max, message]] of Object.entries(bounds)) {
        const value = clockRules[key];
        if (!Number.isFinite(value) || value < min || value > max) {
          return { success: false, message };
        }
      }

      const after = await WorkSettingModel.findOneAndUpdate(
        {},
        {
          fixedWeeklyHours: hours,
          defaultDaysPerWeek: days,
          observesBankHolidays: observes,
          bankHolidayRegion: region,
          ...clockRules,
          clockCutoverDate: cutover,
          updatedBy:
            user?._id && isValidObjectId(user._id)
              ? createObjectId(user._id)
              : undefined,
          updatedByName: user?.name,
        },
        { new: true, upsert: true }
      ).lean();

      recordAudit({
        entityId: after?._id?.toString(),
        before: before
          ? {
              fixedWeeklyHours: before.fixedWeeklyHours,
              defaultDaysPerWeek: before.defaultDaysPerWeek,
              observesBankHolidays: before.observesBankHolidays ?? false,
              bankHolidayRegion: before.bankHolidayRegion ?? "england-and-wales",
              ...resolveClockRules(before),
            }
          : undefined,
        after: {
          fixedWeeklyHours: after?.fixedWeeklyHours,
          defaultDaysPerWeek: after?.defaultDaysPerWeek,
          observesBankHolidays: after?.observesBankHolidays ?? false,
          bankHolidayRegion: after?.bankHolidayRegion ?? "england-and-wales",
          ...resolveClockRules(after),
        },
        description:
          `Company working time set to ${hours}h/week over ${days} days; ` +
          `bank holidays ${observes ? `observed (${region}, not deducted from leave)` : "treated as working days"}; ` +
          `shifts capped at ${clockRules.maxShiftHours}h; ` +
          `clock rules ${describeClockPolicy(clockRules)}; ` +
          (cutover
            ? `open shifts reviewed from ${cutover.toISOString().slice(0, 10)}`
            : "open shifts reviewed across all history"),
      });

      return {
        success: true,
        message: "Working-time settings saved",
        data: JSON.stringify(after),
      };
    } catch (error) {
      console.log("Error updating work settings:", error);
      return { success: false, message: "Failed to save settings" };
    }
  },
  { module: "Settings" }
);
