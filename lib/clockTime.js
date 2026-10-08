/**
 * One definition of "which day is this shift on" and "what time is it".
 *
 * The clock system had two. The QR scanner derived its date by building a
 * Date from UK wall-clock parts and calling `.toISOString()` — which parses
 * those parts in the *server's* timezone, so on a UTC server a clock-in at
 * 00:30 UK time during BST was written to the previous day. Everything else
 * used `normalizeDateToUTC(new Date())`, which reads the server's local
 * calendar day. The two agreed only when the server happened to be on UTC and
 * nobody clocked in around midnight.
 *
 * When they disagreed the record was written to one day and looked for on
 * another: the scanner would offer "Clock In" to someone already clocked in,
 * and the admin table showed them as absent.
 *
 * A working day here is a calendar day in UK time, stored as UTC midnight of
 * that day — the same shape `normalizeDateToUTC` produced, so existing records
 * and queries are unaffected. Only the way the day is *chosen* changes.
 */

const UK_TIME_ZONE = "Europe/London";

// h23 rather than hour12:false: en-GB renders midnight as "24" under some ICU
// versions, which would make the hour of a 00:15 clock-in read as "24:15".
const UK_PARTS_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The UK wall-clock reading of an instant, as zero-padded string parts. */
function ukParts(instant = new Date()) {
  return Object.fromEntries(
    UK_PARTS_FORMAT.formatToParts(instant).map((p) => [p.type, p.value]),
  );
}

/**
 * The working day an instant falls on: UTC midnight of the UK calendar day.
 *
 * This is the value to store in, and query by, a clock record's `date`.
 */
export function getWorkingDate(instant = new Date()) {
  const { year, month, day } = ukParts(instant);
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/** The same day as "YYYY-MM-DD" — for display, keys and query strings. */
export function getWorkingDateKey(instant = new Date()) {
  const { year, month, day } = ukParts(instant);
  return `${year}-${month}-${day}`;
}

/** The current UK wall-clock time as "HH:mm" — how clock times are stored. */
export function getClockTime(instant = new Date()) {
  const { hour, minute } = ukParts(instant);
  return `${hour}:${minute}`;
}

/**
 * Coerce a caller-supplied date to a working day.
 *
 * Two shapes arrive here and they need opposite treatment:
 *
 *   "2026-09-19" — already a calendar day. Read literally. `new Date()` would
 *   parse it as UTC midnight and `normalizeDateToUTC` would then apply the
 *   server's local getters to it, moving it back a day west of Greenwich.
 *
 *   A Date (a picker's value crossing a server action as an ISO string) — an
 *   *instant*, so ask which UK day it lands on. A UK user picking 19 Sep during
 *   BST sends 2026-09-18T23:00:00Z; the answer is still the 19th.
 *
 * Returns null for anything unparseable, so a caller can fall back to today
 * rather than writing an Invalid Date.
 */
export function toWorkingDate(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const calendarDay = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (calendarDay) {
      const [, year, month, day] = calendarDay;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    }
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return getWorkingDate(parsed);
}

/* ------------------------------------------------------------------------ *
 * Clock arithmetic
 *
 * Clock times are stored as "HH:mm" strings. Every rule in the system that
 * compared them did it by subtracting the strings —
 *
 *     (currentTime - existingRecord.clockIn) / (1000 * 60 * 60)
 *
 * which is NaN, and `NaN < 2` is false, so every minimum-break and
 * minimum-shift check passed unconditionally. They had never once fired. The
 * helpers below are what those comparisons should have been going through.
 * ------------------------------------------------------------------------ */

/** A stored clock time: 24-hour, zero-padded. Matches the schema's own regex. */
export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(value) {
  return typeof value === "string" && CLOCK_TIME_PATTERN.test(value);
}

/** "09:30" -> 570. null for anything that is not a clock time. */
export function toMinutes(value) {
  if (!isClockTime(value)) return null;
  const [hours, minutes] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** 570 -> "09:30". Wraps, so 1470 is "00:30" the next day. */
export function fromMinutes(total) {
  if (!Number.isFinite(total)) return null;
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  const hours = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const minutes = String(wrapped % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Minutes from one clock time to another.
 *
 * An end before the start is read as crossing midnight, which is how
 * `calculateDuration` and `calculateDurationNew` have always treated it — a
 * night shift clocking in at 22:00 and out at 06:00 worked eight hours, not
 * minus sixteen. That makes a typo indistinguishable from a night shift on its
 * own, which is why the caller is expected to reject implausibly long results
 * rather than implausibly ordered ones. See maxShiftHours in lib/clockRules.js.
 *
 * Returns null if either side is not a clock time.
 */
export function diffMinutes(start, end) {
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null) return null;
  return to >= from ? to - from : 1440 - from + to;
}
