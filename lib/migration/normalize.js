/**
 * Turning what another HR system exported into what this one stores.
 *
 * The whole import stands on two of these: `emailKey` and `phoneKey`. They
 * decide whether two rows — or a row and a record already in the database — are
 * the same person. Get them wrong in the loose direction and the import creates
 * a second account for somebody who already has one, which in this app means a
 * second thing their email can sign into (see findAccountsByEmail in
 * server/authServer/authServer.js). Get them wrong in the strict direction and
 * a legitimate row is refused. So they live here, alone, rather than being
 * re-derived at each call site.
 *
 * Deliberately dependency-free and side-effect-free: the client builds the
 * template and the preview from this module, and the server validates with the
 * same functions, so the two cannot disagree about what a phone number is.
 */

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Trim, and collapse the runs of whitespace that copy-paste leaves behind.
 * Non-breaking spaces included — they arrive from spreadsheets constantly and
 * are invisible, so "John  Smith" and "John Smith" would otherwise be two
 * different names that look identical on screen.
 */
export function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** Whether a cell is worth reading at all. */
export function isBlank(value) {
  const text = cleanText(value);
  if (!text) return true;
  // Things exports put in a cell to mean "nothing".
  return ["-", "--", "n/a", "na", "null", "nil", "none"].includes(
    text.toLowerCase()
  );
}

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

// Deliberately the same expression the office and site employee forms validate
// with (data/fields/fields.js), so the import cannot accept an address the form
// would reject and leave a record nobody can subsequently edit.
const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/**
 * The form an email is stored and compared in: trimmed and lower-cased.
 *
 * Case matters here because the two collections disagree about it. Office
 * employees have been lower-cased on write since handleOfficeEmployee was
 * written; site employees never have. So "J.Smith@acme.co.uk" in the file and
 * "j.smith@acme.co.uk" in the database are the same login and must compare
 * equal — the database lookups pair this with a case-insensitive collation for
 * the same reason.
 *
 * Also strips the angle brackets and display name that a "Name <a@b.com>"
 * export leaves in the cell.
 */
export function emailKey(value) {
  let text = cleanText(value).toLowerCase();
  const angled = text.match(/<([^>]+)>/);
  if (angled) text = angled[1].trim();
  return text;
}

export function isValidEmail(value) {
  const email = emailKey(value);
  return Boolean(email) && EMAIL_PATTERN.test(email);
}

/* -------------------------------------------------------------------------- */
/* Phone                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A UK phone number reduced to the digits that identify it.
 *
 * Both employee schemas store the phone as a **Number**, which silently drops
 * the leading zero — so 07700 900123 is already on file as 7700900123. Matching
 * has to be done in that same form or every existing record would look like a
 * different person from the row describing them.
 *
 * The international prefixes are handled because they are what an export from a
 * payroll system tends to carry: +44, 0044 and a bare 44 all mean the same
 * eleven digits with the trunk zero removed.
 *
 * Returns "" for a cell with no digits in it, which callers read as "not given"
 * rather than as a number to match on — important, because two blanks must
 * never be judged the same person.
 *
 * @returns {string} national digits, no leading zero
 */
export function phoneKey(value) {
  if (isBlank(value)) return "";
  let digits = String(value).replace(/[^\d]/g, "");
  if (!digits) return "";

  // Spreadsheets love turning a phone number into 7.7009e+9.
  if (/e\+?\d+$/i.test(cleanText(value))) {
    const asNumber = Number(cleanText(value));
    if (Number.isFinite(asNumber)) digits = String(Math.round(asNumber));
  }

  if (digits.startsWith("0044")) digits = digits.slice(4);
  else if (digits.length > 11 && digits.startsWith("44")) digits = digits.slice(2);
  else if (digits.length === 12 && digits.startsWith("44")) digits = digits.slice(2);

  // The trunk zero. Stripped rather than kept because that is the form already
  // on disk, not because it is the nicer way to write a phone number.
  digits = digits.replace(/^0+/, "");

  return digits;
}

/** The phone as the schemas want it: a Number, or undefined when not given. */
export function phoneNumberValue(value) {
  const key = phoneKey(value);
  if (!key) return undefined;
  const asNumber = Number(key);
  return Number.isFinite(asNumber) ? asNumber : undefined;
}

/** A UK national number is 9–10 digits once the trunk zero is off. */
export function isPlausiblePhone(value) {
  const key = phoneKey(value);
  return key.length >= 9 && key.length <= 11;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/** Midnight UTC, so a date never drifts a day when rendered in another zone. */
const utcDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month, day));
  // Rejects 31 February rather than rolling it into March.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

/**
 * Two digits into a year.
 *
 * Dates of birth and start dates both come through here, and they pull in
 * opposite directions — "65" is a year of birth, "24" is a start date. Anything
 * more than ten years ahead of now is read as last century, which puts the
 * boundary where it does least harm: a birth year is never in the future, and a
 * start date more than a decade out is a typo either way.
 */
function expandYear(value) {
  if (value >= 100) return value;
  const thisYear = new Date().getUTCFullYear();
  const century = Math.floor(thisYear / 100) * 100;
  const candidate = century + value;
  return candidate > thisYear + 10 ? candidate - 100 : candidate;
}

/**
 * A date cell, in whatever the exporting system felt like writing.
 *
 * `order` settles the one thing that cannot be inferred: 03/04/2024 is the 3rd
 * of April to a British payroll system and the 4th of March to an American one,
 * and no amount of looking at the file tells you which. The import screen asks
 * the person, defaulting to day-first because this app is UK-facing throughout
 * (postcodes, National Insurance, CIS). A file whose dates are unambiguous —
 * ISO, or a day above 12 — is read correctly under either setting.
 *
 * @param {string|number|Date} value
 * @param {"DMY"|"MDY"} [order]
 * @returns {Date|null}
 */
export function parseFlexibleDate(value, order = "DMY") {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (isBlank(value)) return null;

  const text = cleanText(value);

  // An Excel serial date, which is what you get when a column was formatted as
  // a date and exported as a number. Day 1 is 1900-01-01, offset by the leap
  // year Excel believes 1900 to have been.
  if (/^\d{1,5}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial >= 1 && serial <= 60000) {
      const epoch = Date.UTC(1899, 11, 30);
      const date = new Date(epoch + Math.round(serial) * 86400000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  // ISO, with or without a time on the end. Unambiguous, so it ignores `order`.
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (iso) {
    return utcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  // 1 Jan 2024 / 1-Jan-24 / January 1, 2024
  const named = text.match(
    /^(\d{1,2})[\s\-./]*([A-Za-z]{3,9})[\s\-./,]*(\d{2,4})$/
  );
  if (named && MONTHS[named[2].toLowerCase()] !== undefined) {
    return utcDate(
      expandYear(Number(named[3])),
      MONTHS[named[2].toLowerCase()],
      Number(named[1])
    );
  }
  const namedFirst = text.match(
    /^([A-Za-z]{3,9})[\s\-./]*(\d{1,2})[\s\-./,]*(\d{2,4})$/
  );
  if (namedFirst && MONTHS[namedFirst[1].toLowerCase()] !== undefined) {
    return utcDate(
      expandYear(Number(namedFirst[3])),
      MONTHS[namedFirst[1].toLowerCase()],
      Number(namedFirst[2])
    );
  }

  // Three numbers with any of the usual separators.
  const numeric = text.match(/^(\d{1,4})[\s\-./](\d{1,2})[\s\-./](\d{1,4})$/);
  if (numeric) {
    let [, a, b, c] = numeric.map(Number);

    // A four-digit first part can only be a year.
    if (String(numeric[1]).length === 4) return utcDate(a, b - 1, c);

    let day = order === "MDY" ? b : a;
    let month = order === "MDY" ? a : b;

    // The file wins over the setting when only one reading is possible: a "13"
    // in the month position is a day, whatever the dropdown says.
    if (month > 12 && day <= 12) {
      const swap = day;
      day = month;
      month = swap;
    }

    return utcDate(expandYear(c), month - 1, day);
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Numbers and choices                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A number from a cell, with the currency symbols, thousands separators and
 * percent signs a payroll export decorates them with removed.
 */
export function parseNumber(value) {
  if (isBlank(value)) return null;
  const text = cleanText(value)
    .replace(/[£$€,%\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1"); // (12.50) is how accountants write -12.50
  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  const asNumber = Number(text);
  return Number.isFinite(asNumber) ? asNumber : null;
}

/** For comparing a written-down choice with the ones we accept. */
const slug = (value) => cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Match a cell against a fixed list of allowed values.
 *
 * Forgiving about punctuation and case only — "full time", "Full-Time" and
 * "FULLTIME" are the same answer. Not forgiving about meaning: a value that is
 * not on the list is rejected rather than guessed at, because these drive pay
 * and immigration status.
 *
 * @param {string} value
 * @param {Array<string|{value: string, aliases?: string[]}>} options
 * @returns {string|null} the canonical value
 */
export function parseChoice(value, options) {
  if (isBlank(value)) return null;
  const wanted = slug(value);
  for (const option of options) {
    const canonical = typeof option === "string" ? option : option.value;
    if (slug(canonical) === wanted) return canonical;
    const aliases = typeof option === "string" ? [] : option.aliases || [];
    if (aliases.some((alias) => slug(alias) === wanted)) return canonical;
  }
  return null;
}

/** Yes / no / true / 1 — the many ways a spreadsheet writes a boolean. */
export function parseBoolean(value) {
  if (isBlank(value)) return null;
  const text = slug(value);
  if (["yes", "y", "true", "1", "on"].includes(text)) return true;
  if (["no", "n", "false", "0", "off"].includes(text)) return false;
  return null;
}

export { slug as slugify };
