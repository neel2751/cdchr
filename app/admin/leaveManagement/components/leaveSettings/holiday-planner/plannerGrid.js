/**
 * The month grid, and the keys its cells are looked up by.
 *
 * Extracted from the planner component so the week maths can be tested. The
 * Monday offset and the "always six rows" rule are the two things this rewrite
 * actually asserts, and both are the kind of arithmetic that is wrong by one for
 * a single month of the year and right for the other eleven.
 */

/**
 * The key a day's leave is stored under.
 *
 * Leave dates are stored at UTC midnight and the server keys them by their UTC
 * calendar date. Building a key with `new Date(y, m, d).toISOString()` would
 * convert local midnight to UTC first, which shifts the date back a day for
 * every month in British Summer Time — leave then renders on the wrong cell.
 * Formatting the calendar components directly keeps the two in step.
 */
export function toDateKey(year, month, day) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** The same, from a Date. */
export function dateKeyOf(date) {
  return toDateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Monday first, because that is where a working week starts. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Columns 5 and 6 of a Monday-first week. */
export const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

/**
 * The six weeks a month grid shows, Monday-first.
 *
 * ALWAYS SIX ROWS, including the tail of the previous month and the head of the
 * next. A grid sized to the month is between four and six rows tall depending on
 * where the 1st falls, so it resized as you moved through the year — a calendar
 * that changes height under the cursor is hard to scan and harder to click. The
 * overflow days are rendered, greyed, rather than left as empty divs, so a leave
 * that started last month is visible on the 1st.
 *
 * @param {number} year
 * @param {number} month 0-11
 * @returns {Date[][]} six weeks of seven days
 */
export function buildWeeks(year, month) {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-based (0 = Sunday); shifting by 6 makes Monday 0.
  const offset = (first.getDay() + 6) % 7;

  const weeks = [];
  for (let week = 0; week < 6; week++) {
    const days = [];
    for (let day = 0; day < 7; day++) {
      // Built from the 1st rather than by mutating a cursor, so a month
      // boundary or a clock change cannot carry a drifted value forward.
      days.push(new Date(year, month, 1 - offset + week * 7 + day));
    }
    weeks.push(days);
  }
  return weeks;
}
