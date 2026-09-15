/**
 * Turning a contract into the value of one day.
 *
 * Paid leave has no clock record, so its hours have to be derived. The rule is
 * the employee's contracted week divided by the days they actually work:
 *
 *     weekly hours / days per week = one day's hours
 *
 * Someone on 20 hours over 3 days is owed 6h40 for a day off, not the 4 hours
 * a flat five-day week would imply — which is why the divisor is the
 * employee's own `dayPerWeek` rather than a constant.
 *
 * A half day is worth half of that.
 */

export const DEFAULT_FIXED_WEEKLY_HOURS = 40;
export const DEFAULT_DAYS_PER_WEEK = 5;

/**
 * The weekly hours an employee is actually on: their own figure when they are
 * set to "custom", otherwise the company-wide default.
 */
export function effectiveWeeklyHours(employee, settings) {
  const fixed = Number(settings?.fixedWeeklyHours) || DEFAULT_FIXED_WEEKLY_HOURS;
  if (employee?.weeklyHourType !== "custom") return fixed;
  const own = Number(employee?.weeklyHours);
  // A "custom" employee with nothing entered falls back to the company figure
  // rather than valuing their leave at zero.
  return Number.isFinite(own) && own > 0 ? own : fixed;
}

/** The days-per-week divisor for this employee. */
export function effectiveDaysPerWeek(employee, settings) {
  const own = Number(employee?.dayPerWeek);
  if (Number.isFinite(own) && own > 0) return own;
  return Number(settings?.defaultDaysPerWeek) || DEFAULT_DAYS_PER_WEEK;
}

/** Minutes one full working day is worth for this employee. */
export function minutesPerWorkingDay(employee, settings) {
  const hours = effectiveWeeklyHours(employee, settings);
  const days = effectiveDaysPerWeek(employee, settings);
  if (!days) return 0;
  return Math.round((hours / days) * 60);
}

/**
 * Minutes a single leave day is worth.
 * @param {boolean} isHalfDay halve the day's value
 */
export function leaveDayMinutes(employee, settings, isHalfDay = false) {
  const full = minutesPerWorkingDay(employee, settings);
  return isHalfDay ? Math.round(full / 2) : full;
}

/** Human-readable summary of an employee's contract, for forms and tables. */
export function describeContract(employee, settings) {
  const hours = effectiveWeeklyHours(employee, settings);
  const days = effectiveDaysPerWeek(employee, settings);
  const perDay = days ? hours / days : 0;
  return `${hours}h/week over ${days} day${days === 1 ? "" : "s"} · ${perDay.toFixed(2)}h/day`;
}
