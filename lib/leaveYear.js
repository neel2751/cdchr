import LeaveSettingModel from "@/models/leaveSettingModel";
import {
  getLeaveYearString,
  leaveYearStartYear,
} from "@/helper/getLeaveYearString";

/**
 * Which twelve months the leave module is talking about, read from the company.
 *
 * WHY THIS EXISTS
 *
 * There were two functions called `getLeaveYearString`, in two files, with
 * incompatible second parameters:
 *
 *   helper/getLeaveYearString.js   (date, startMonth = 4)   tenant-aware
 *   lib/getLeaveYear.js            (date, short = true)     April, hard-coded
 *
 * Five live call sites imported the second one. Most simply got April; one —
 * `fetchCommonLeave`, the Entitlements table itself — passed the company's start
 * month into the `short` slot, where it was read as a truthy boolean and
 * discarded. So for any company whose leave year does not start in April:
 *
 *   · the Entitlements table looked up the wrong leave year, and every employee
 *     appeared to have no entitlement at all;
 *   · the leave-type dropdown an employee books from came back EMPTY, so they
 *     could not request leave;
 *   · editing a leave category propagated the new figure to a leave year that
 *     did not exist, silently changing nothing.
 *
 * None of that was visible on an April company, which is every company that has
 * been tested. The fix is not to be more careful at eight call sites: it is for
 * there to be one function that cannot be called without the company's month,
 * because it fetches it. `lib/getLeaveYear.js` is gone.
 *
 * Deliberately NOT a "use server" module — same reasoning as lib/requireFeature.js
 * and lib/tenantFeatures.js. Every export of a "use server" file is a separately
 * addressable endpoint, and "what is the current leave year" does not need to be
 * one; the actions that use it are already endpoints and already guarded.
 *
 * Reads the setting directly rather than through getLeaveSettings(), for two
 * reasons: that function CREATES the document when none exists, which a read has
 * no business doing, and it returns `{ success, data }` — the wrapper that caused
 * this whole class of bug.
 */

/** Fall back to April when nothing has been chosen, as the schema default does. */
const DEFAULT_START_MONTH = 4;

/**
 * The month this company's leave year starts, 1–12.
 *
 * Never throws: a leave screen that cannot read the setting should show April's
 * answer rather than an error, which is what every call site did by hand before.
 */
export async function leaveYearStartMonth() {
  try {
    const settings = await LeaveSettingModel.findOne()
      .select("leaveYearStartMonth")
      .lean();
    const month = Number(settings?.leaveYearStartMonth);
    return Number.isInteger(month) && month >= 1 && month <= 12
      ? month
      : DEFAULT_START_MONTH;
  } catch (error) {
    console.log("leaveYearStartMonth failed:", error?.message);
    return DEFAULT_START_MONTH;
  }
}

/**
 * This company's current leave year, as the string CommonLeave is keyed by.
 *
 * @param {Date} [on] any day; defaults to today
 * @returns {Promise<string>} e.g. "2026-27"
 */
export async function currentLeaveYear(on = new Date()) {
  return getLeaveYearString(on, await leaveYearStartMonth());
}

/**
 * A leave year the caller may or may not have been given.
 *
 * The shape half the leave actions need: a screen passes the year it is showing,
 * and when it passes nothing the answer is "this one". Written once here because
 * `leaveYear || getLeaveYearString(new Date())` was repeated at each call site
 * and each repetition was where the April default crept back in.
 *
 * @param {string} [leaveYear] e.g. "2026-27"
 */
export async function resolveLeaveYear(leaveYear) {
  const given = typeof leaveYear === "string" ? leaveYear.trim() : "";
  // Shape-checked rather than trusted: these come in from query strings, and a
  // year that does not look like one would match no documents and read as
  // "this employee has no entitlement".
  if (/^\d{4}-\d{2}$/.test(given)) return given;
  return currentLeaveYear();
}

/**
 * The calendar year a leave year starts in, for building a list of years.
 *
 * @returns {Promise<number>} e.g. 2026 for "2026-27"
 */
export async function currentLeaveYearStartYear(on = new Date()) {
  return leaveYearStartYear(on, await leaveYearStartMonth());
}
