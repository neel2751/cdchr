// Bank holiday rules.
//
// Whether a company closes on UK bank holidays is one setting
// (`WorkSetting.observesBankHolidays`) with two consequences that must agree:
// the date picker stops offering those days, and the leave engine refuses to
// deduct them. Both read the rules below, for the same reason lib/sickNote.js
// exists — the browser and the database have to reach the same answer, and a
// check that lives in only one of them is a check that can be walked around.
//
// Deliberately free of any database, React or date-library import. The gov.uk
// list is passed in rather than fetched here so this stays pure: the caller
// decides where the list comes from (useBankHoliday in the browser,
// getBankHolidays on the server) and these functions stay testable without a
// network.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Midnight-UTC timestamp for a date, or null if it is not one.
 *
 * Leave dates travel as "yyyy-MM-dd" from the picker and come back from Mongo
 * as Date objects at UTC midnight; gov.uk publishes "yyyy-MM-dd". Reading UTC
 * components of all three keeps a British Summer Time browser from shifting a
 * day — which, for a feature about which calendar day it is, would be the whole
 * bug.
 *
 * Same keying as lib/sickNote.js, on purpose.
 */
export function toDayKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The gov.uk payload as a Set of day keys, for O(1) lookups.
 *
 * Accepts either the raw events (`[{ date, title }]`) or a plain list of dates,
 * so callers are not forced to reshape it first.
 */
export function toHolidaySet(holidays) {
  const set = new Set();
  for (const entry of holidays || []) {
    const key = toDayKey(entry?.date ?? entry);
    if (key !== null) set.add(key);
  }
  return set;
}

/** Is this date a bank holiday? `holidays` may be the raw list or a Set. */
export function isBankHoliday(date, holidays) {
  const key = toDayKey(date);
  if (key === null) return false;
  const set = holidays instanceof Set ? holidays : toHolidaySet(holidays);
  return set.has(key);
}

/** The gov.uk entry for a date, so a message can name the day. */
export function holidayTitleFor(date, holidays) {
  const key = toDayKey(date);
  if (key === null) return null;
  for (const entry of holidays || []) {
    if (toDayKey(entry?.date ?? entry) === key) return entry?.title || null;
  }
  return null;
}

/**
 * Split leave dates into the ones that cost a day and the ones that do not.
 *
 * Returns `{ kept, removed }` rather than just the filtered list: the caller
 * needs the removed days to tell the user *why* their five-day request cost
 * three. Order is preserved, and when the company does not observe bank
 * holidays nothing is removed at all — the list passes straight through.
 *
 * @param {Array<Date|string>} dates
 * @param {{ observes?: boolean, holidays?: Array }} options
 */
export function excludeBankHolidays(dates, { observes, holidays } = {}) {
  const list = Array.isArray(dates) ? dates : [];
  if (!observes) return { kept: list, removed: [] };

  const set = toHolidaySet(holidays);
  if (set.size === 0) {
    // No list available (gov.uk unreachable, say). Deducting the day is the
    // status quo and the recoverable mistake; silently refunding days because a
    // fetch failed is not.
    return { kept: list, removed: [] };
  }

  const kept = [];
  const removed = [];
  for (const date of list) {
    const key = toDayKey(date);
    if (key !== null && set.has(key)) removed.push(date);
    else kept.push(date);
  }
  return { kept, removed };
}

/**
 * A sentence naming what was not deducted, or null when nothing was.
 *
 * Shown after booking. "3 days booked" on its own reads like the request was
 * wrong; saying which days were free and why makes it obviously right.
 */
export function describeExclusion(removed, holidays) {
  if (!removed?.length) return null;

  const named = removed
    .map((date) => {
      const title = holidayTitleFor(date, holidays);
      const key = toDayKey(date);
      const label =
        key === null
          ? null
          : new Date(key).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            });
      if (!label) return null;
      return title ? `${label} (${title})` : label;
    })
    .filter(Boolean);

  if (!named.length) return null;
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `${list} ${named.length === 1 ? "is a bank holiday" : "are bank holidays"} and ${
    named.length === 1 ? "was" : "were"
  } not deducted from your allowance.`;
}
