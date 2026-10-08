import { differenceInCalendarDays } from "date-fns";

/**
 * How much annual leave somebody is entitled to, and for which twelve months.
 *
 * Pure: no database, no session. It exists as its own module because the answer
 * is now needed in three places that used to each have their own arithmetic —
 * generating a new starter's entitlement, rolling a whole company into a new
 * leave year, and showing a company what a bulk import is about to create — and
 * because entitlement is the kind of number that has to be explainable to the
 * person whose leave it is.
 *
 * WHY DAYS AND NOT MONTHS
 *
 * The previous version pro-rated by whole calendar months:
 * `differenceInCalendarMonths(leaveYearEnd, joinDate) + 1`, then a twelfth of
 * the full entitlement per month. That counts a month as worked however little
 * of it was worked, so on an April–March leave year somebody starting on the
 * 30th of June was credited the same nine months as somebody starting on the
 * 1st — about two and a half days of leave they had not accrued — while the
 * person starting on the 1st of July got nine months too and was correct. It
 * also meant the entitlement changed in steps on the 1st of each month rather
 * than accruing, which is not how anybody describes their own leave.
 *
 * Pro-rating by days is the ordinary UK practice and the one ACAS describes:
 * the share of the leave year the employee is actually employed for.
 */

/**
 * The UK statutory minimum: 5.6 weeks of paid holiday a year.
 *
 * Multiplied by the contracted days per week, which is what makes it work for
 * part-time staff — three days a week is 16.8 days, not three fifths of some
 * other number.
 *
 * Deliberately NOT capped at 28 days. Statute caps the *minimum* it can oblige
 * an employer to give at 28, so a six-day week is legally entitled to 28 rather
 * than 33.6 — but this app has always granted the full 5.6 × days figure, the
 * worked examples in server/leaveServer/countLeaveServer.js say 34 days for a
 * six-day week, and companies on that setting have been running on it. Capping
 * here would quietly take six days off those people.
 */
export const STATUTORY_WEEKS = 5.6;

/**
 * The twelve months a leave year covers, for the leave year containing `date`.
 *
 * `startMonth` is 1–12 as stored on LeaveSetting: 4 is the April–March year
 * most UK companies run, 1 is January–December.
 *
 * The end is the day before the next leave year begins, so the two never
 * overlap and never leave a day in neither — `new Date(year, month, 0)` is the
 * last day of the previous month, which is how that is expressed.
 *
 * @param {Date|string} date any day inside the leave year
 * @param {number} [startMonth] 1–12
 * @returns {{ start: Date, end: Date, days: number, label: string }}
 */
export function leaveYearBounds(date = new Date(), startMonth = 4) {
  const month = Number(startMonth);
  const jsStartMonth = (Number.isInteger(month) && month >= 1 && month <= 12
    ? month
    : 4) - 1;

  const on = new Date(date);
  const startYear =
    on.getMonth() >= jsStartMonth ? on.getFullYear() : on.getFullYear() - 1;

  const start = new Date(startYear, jsStartMonth, 1);
  const end = new Date(startYear + 1, jsStartMonth, 0);

  return {
    start,
    end,
    // 365, or 366 when the leave year spans a 29th of February.
    days: differenceInCalendarDays(end, start) + 1,
    label: `${startYear}-${String(startYear + 1).slice(-2)}`,
  };
}

/**
 * The same bounds, for a leave year named rather than dated.
 *
 * @param {string} leaveYear e.g. "2025-26"
 * @param {number} [startMonth] 1–12
 */
export function boundsForLeaveYear(leaveYear, startMonth = 4) {
  const startYear = parseInt(String(leaveYear).split("-")[0], 10);
  if (!Number.isFinite(startYear)) return leaveYearBounds(new Date(), startMonth);
  const month = Number(startMonth) >= 1 && Number(startMonth) <= 12 ? Number(startMonth) : 4;
  // Any day inside the year will do; the 1st of the starting month always is.
  return leaveYearBounds(new Date(startYear, month - 1, 1), startMonth);
}

/**
 * One employee's annual leave for one leave year.
 *
 * Three outcomes, and the reason for each:
 *
 *   employed for the whole year   the full 5.6 × days-per-week
 *   joined part way through       that share of it, by days
 *   joined after it ended         nothing — see below
 *
 * The last case is not hypothetical. A start date in a future leave year used to
 * produce a *negative* month count, a negative entitlement, and a stored record
 * saying the employee owed the company leave — `differenceInCalendarMonths`
 * happily returns a negative number and nothing downstream checked. It happens
 * whenever somebody is entered before they start, which is the normal way to
 * enter a new joiner.
 *
 * ROUNDING is up, always. Part days are rounded in the employee's favour
 * because the figure is a statutory minimum: rounding 25.2 down to 25 hands
 * somebody less holiday than the law gives them, and the difference is never
 * more than a day. It also agrees with every worked example this app shipped
 * with — 5.6 × 6 = 33.6 → 34, 5.6 × 3 = 16.8 → 17.
 *
 * @param {Object} input
 * @param {Date|string} input.joinDate
 * @param {number} input.dayPerWeek contracted days per week, 1–7
 * @param {Date} input.leaveYearStart
 * @param {Date} input.leaveYearEnd
 * @param {Date|string|null} [input.endDate] last working day, when known
 * @returns {number} whole days
 */
export function annualLeaveForYear({
  joinDate,
  dayPerWeek,
  leaveYearStart,
  leaveYearEnd,
  endDate = null,
}) {
  const days = Number(dayPerWeek);
  if (!joinDate || !Number.isFinite(days) || days <= 0) return 0;

  const joined = new Date(joinDate);
  if (Number.isNaN(joined.getTime())) return 0;

  const full = STATUTORY_WEEKS * days;

  // Started after this leave year finished: nothing accrues in a year they were
  // not employed for any of.
  if (differenceInCalendarDays(joined, leaveYearEnd) > 0) return 0;

  // The window they are actually employed for inside this leave year.
  const from = differenceInCalendarDays(joined, leaveYearStart) > 0 ? joined : leaveYearStart;

  let until = leaveYearEnd;
  if (endDate) {
    const left = new Date(endDate);
    if (!Number.isNaN(left.getTime())) {
      // A leaving date before the year even started means they were gone for
      // all of it. Anything inside it shortens the window.
      if (differenceInCalendarDays(left, leaveYearStart) < 0) return 0;
      if (differenceInCalendarDays(left, leaveYearEnd) < 0) until = left;
    }
  }

  const employedDays = differenceInCalendarDays(until, from) + 1;
  if (employedDays <= 0) return 0;

  const yearDays = differenceInCalendarDays(leaveYearEnd, leaveYearStart) + 1;
  if (employedDays >= yearDays) return Math.ceil(full);

  return Math.ceil((full * employedDays) / yearDays);
}

/**
 * The same answer, plus how it was arrived at.
 *
 * For screens that have to justify the number rather than just print it — the
 * import preview above all, where somebody is about to accept a few hundred of
 * these at once and the only way to trust them is to see one worked through.
 *
 * @returns {{
 *   days: number, full: number, proRated: boolean,
 *   employedDays: number, yearDays: number, explanation: string,
 * }}
 */
export function explainAnnualLeave({
  joinDate,
  dayPerWeek,
  leaveYearStart,
  leaveYearEnd,
  endDate = null,
}) {
  const perWeek = Number(dayPerWeek) || 0;
  const full = Math.ceil(STATUTORY_WEEKS * perWeek);
  const yearDays = differenceInCalendarDays(leaveYearEnd, leaveYearStart) + 1;
  const result = annualLeaveForYear({
    joinDate,
    dayPerWeek,
    leaveYearStart,
    leaveYearEnd,
    endDate,
  });

  const joined = joinDate ? new Date(joinDate) : null;
  const startsLate =
    joined && !Number.isNaN(joined.getTime())
      ? differenceInCalendarDays(joined, leaveYearStart) > 0
      : false;
  const startsAfter =
    joined && !Number.isNaN(joined.getTime())
      ? differenceInCalendarDays(joined, leaveYearEnd) > 0
      : false;

  const from = startsLate ? joined : leaveYearStart;
  let until = leaveYearEnd;
  if (endDate) {
    const left = new Date(endDate);
    if (!Number.isNaN(left.getTime()) && differenceInCalendarDays(left, leaveYearEnd) < 0) {
      until = left;
    }
  }
  const employedDays = Math.max(differenceInCalendarDays(until, from) + 1, 0);

  let explanation;
  if (!perWeek) {
    explanation = "No contracted days per week, so no entitlement can be worked out.";
  } else if (startsAfter) {
    explanation = "Starts after this leave year ends, so nothing accrues in it.";
  } else if (employedDays === 0) {
    explanation = "Not employed during this leave year.";
  } else if (employedDays >= yearDays) {
    explanation = `Employed all year: 5.6 weeks × ${perWeek} days a week = ${full} days.`;
  } else {
    explanation =
      `Employed ${employedDays} of ${yearDays} days: ` +
      `${full} × ${employedDays}/${yearDays} = ${result} days.`;
  }

  return {
    days: result,
    full,
    proRated: employedDays > 0 && employedDays < yearDays,
    employedDays,
    yearDays,
    explanation,
  };
}
