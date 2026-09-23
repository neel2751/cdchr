// Sick note (fit note) rules.
//
// Shared by the leave forms and by the server-side leave engine so the browser
// and the database agree on exactly when the evidence becomes mandatory. Kept
// free of any database or React import for that reason.

export const SICK_LEAVE_TYPE = "Sick Leave";

// A sick absence running this many consecutive calendar days — or longer —
// cannot be submitted without a sick note.
export const SICK_NOTE_MIN_CONSECUTIVE_DAYS = 4;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Midnight-UTC timestamp for a leave date.
 *
 * Leave dates travel as "yyyy-MM-dd" from the date picker and come back from
 * Mongo as Date objects at UTC midnight. Reading the UTC components of both
 * keeps a British Summer Time browser from shifting a day.
 */
function toUtcDayStamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

/**
 * Longest run of back-to-back calendar days in a list of leave dates.
 * Duplicates and out-of-order dates are tolerated.
 */
export function maxConsecutiveDays(leaveDates = []) {
  const stamps = [
    ...new Set(
      (leaveDates || []).map(toUtcDayStamp).filter((stamp) => stamp !== null)
    ),
  ].sort((a, b) => a - b);

  if (stamps.length === 0) return 0;

  let longest = 1;
  let run = 1;

  for (let i = 1; i < stamps.length; i++) {
    run = stamps[i] - stamps[i - 1] === MS_PER_DAY ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  return longest;
}

export function isSickLeave(leaveType) {
  return (leaveType || "").trim().toLowerCase() === "sick leave";
}

/** True when this request must carry a sick note before it can be submitted. */
export function needsSickNote(leaveType, leaveDates) {
  if (!isSickLeave(leaveType)) return false;
  return maxConsecutiveDays(leaveDates) >= SICK_NOTE_MIN_CONSECUTIVE_DAYS;
}

/** True once the form/request carries a usable uploaded file reference. */
export function hasSickNote(sickNote) {
  if (!sickNote) return false;
  const note = Array.isArray(sickNote) ? sickNote[0] : sickNote;
  return Boolean(note?.key);
}

export const SICK_NOTE_REQUIRED_MESSAGE = `A sick note is required for ${SICK_NOTE_MIN_CONSECUTIVE_DAYS} or more days of sick leave in a row.`;
