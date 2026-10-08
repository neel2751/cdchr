/**
 * The naming convention for a leave year, in one place.
 *
 * "<starting calendar year>-<last two digits of the next>" — so an April 2026
 * leave year and a January 2026 one are both called "2026-27". That collision is
 * harmless, because a company's start month never changes under it, but it does
 * mean the label is not what distinguishes them: the start month is.
 *
 * @param {number} startYear the calendar year the leave year begins in
 */
export function leaveYearLabel(startYear) {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/**
 * The calendar year a leave year begins in, for the date given.
 *
 * Exported because building a list of selectable leave years needs the number,
 * not the label — and because doing it by hand is where `lib/getLeaveYear.js`'s
 * April-only `getCurrentLeaveYearStart()` came from.
 *
 * @param {Date} date
 * @param {number} [startMonth] 1–12
 */
export function leaveYearStartYear(date = new Date(), startMonth = 4) {
  const month = Number(startMonth);
  const jsStartMonth =
    (Number.isInteger(month) && month >= 1 && month <= 12 ? month : 4) - 1;
  return date.getMonth() >= jsStartMonth
    ? date.getFullYear()
    : date.getFullYear() - 1;
}

export function getLeaveYearString(date = new Date(), startMonth = 4) {
  // startMonth is 1–12 (Jan = 1, April = 4)
  const jsStartMonth = startMonth - 1; // convert to JS 0–11

  const year = date.getFullYear();
  const month = date.getMonth(); // 0–11

  let startYear;
  let endYear;

  if (month >= jsStartMonth) {
    startYear = year;
    endYear = year + 1;
  } else {
    startYear = year - 1;
    endYear = year;
  }

  return `${startYear}-${String(endYear).slice(-2)}`;
}

/**
 * The leave year before this one.
 *
 * Both years step back by one, whatever month the leave year starts in. A
 * `startMonth > 1` branch used to leave them untouched for a January start, so
 * "the previous year" of 2026-27 came back as 2026-27 — the same year. Anything
 * reading last year's balance (carry-forward above all) was therefore reading
 * this year's, for every company on a Jan–Dec leave year.
 *
 * The start month does not enter into it: a leave year is twelve months long
 * wherever it begins, so the one before it is always twelve months earlier. The
 * parameter is kept for call-site compatibility.
 */
export function getPreviousLeaveYearString(targetLeaveYear, startMonth = 4) {
  // targetLeaveYear is in format "2025-26"
  const [startYearStr, endYearStr] = targetLeaveYear.split("-");
  const startYear = parseInt(startYearStr, 10);
  const endYear = parseInt(`20${endYearStr}`, 10);

  return `${startYear - 1}-${String(endYear - 1).slice(-2)}`;
}

export function getNextLeaveYearString(targetLeaveYear, startMonth = 4) {
  // targetLeaveYear is in format "2025-26"
  const [startYearStr, endYearStr] = targetLeaveYear.split("-");
  const startYear = parseInt(startYearStr, 10);
  const endYear = parseInt(`20${endYearStr}`, 10);

  let nextStartYear;
  let nextEndYear;

  if (startMonth > 1) {
    nextStartYear = startYear + 1;
    nextEndYear = endYear + 1;
  } else {
    nextStartYear = startYear;
    nextEndYear = endYear;
  }

  return `${nextStartYear}-${String(nextEndYear).slice(-2)}`;
}

// const previousLeaveYearString = (({ leaveYearString }) => {
//   const [startYearStr, endYearStr] = leaveYearString.split("-");
//   const startYear = parseInt(startYearStr, 10);
//   const endYear = parseInt(`20${endYearStr}`, 10);

//   const prevStartYear = startYear - 1;
//   const prevEndYear = endYear - 1;

//   return `${prevStartYear}-${String(prevEndYear).slice(-2)}`;
// })();
