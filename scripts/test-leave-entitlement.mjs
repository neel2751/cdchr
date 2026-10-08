/**
 * Annual leave entitlement: the leave year, and the share of it somebody works.
 *
 * Pure. Worth being exact about for the same reason the money tests are: every
 * one of these failing is a day of somebody's holiday, and they will notice.
 *
 * The last section covers the per-leave-type ceiling on a hand-set allowance,
 * which lives in data/leaveTypes.js alongside the types themselves.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-leave-entitlement.mjs
 */
import assert from "node:assert";

import {
  STATUTORY_WEEKS,
  annualLeaveForYear,
  boundsForLeaveYear,
  explainAnnualLeave,
  leaveYearBounds,
} from "@/lib/leaveEntitlement";
import {
  LEAVE_TYPE_CATALOGUE,
  MAX_TOTAL_BY_UNIT,
  maxTotalFor,
} from "@/data/leaveTypes";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

/** A local-midnight date, which is what the app's date pickers produce. */
const d = (text) => {
  const [y, m, day] = text.split("-").map(Number);
  return new Date(y, m - 1, day);
};

/* -------------------------------------------------------------------------- */
/* Leave year bounds                                                           */
/* -------------------------------------------------------------------------- */

check("an April leave year runs April to March", () => {
  const year = leaveYearBounds(d("2025-06-15"), 4);
  assert.equal(iso(year.start), "2025-04-01");
  assert.equal(iso(year.end), "2026-03-31");
  assert.equal(year.label, "2025-26");
  assert.equal(year.days, 365);
});

check("a date before the start month belongs to the previous leave year", () => {
  const year = leaveYearBounds(d("2026-02-10"), 4);
  assert.equal(year.label, "2025-26");
  assert.equal(iso(year.start), "2025-04-01");
});

check("a January leave year is the calendar year", () => {
  const year = leaveYearBounds(d("2026-02-10"), 1);
  assert.equal(iso(year.start), "2026-01-01");
  assert.equal(iso(year.end), "2026-12-31");
  assert.equal(year.label, "2026-27");
});

check("a leave year spanning 29 February is 366 days", () => {
  // 2023-24 on an April year covers Feb 2024, which is a leap February.
  assert.equal(leaveYearBounds(d("2023-05-01"), 4).days, 366);
  assert.equal(leaveYearBounds(d("2024-05-01"), 4).days, 365);
});

check("a December leave year does not fall off the end of the year", () => {
  const year = leaveYearBounds(d("2026-12-15"), 12);
  assert.equal(iso(year.start), "2026-12-01");
  assert.equal(iso(year.end), "2027-11-30");
});

check("a rubbish start month falls back to April rather than breaking", () => {
  for (const bad of [0, 13, null, undefined, "April", NaN]) {
    const year = leaveYearBounds(d("2025-06-15"), bad);
    assert.equal(iso(year.start), "2025-04-01", `for ${bad}`);
  }
});

check("a leave year can be found by name as well as by date", () => {
  const byName = boundsForLeaveYear("2025-26", 4);
  const byDate = leaveYearBounds(d("2025-09-01"), 4);
  assert.equal(iso(byName.start), iso(byDate.start));
  assert.equal(iso(byName.end), iso(byDate.end));
});

/* -------------------------------------------------------------------------- */
/* A full year                                                                 */
/* -------------------------------------------------------------------------- */

const YEAR = leaveYearBounds(d("2025-06-01"), 4); // 2025-04-01 → 2026-03-31

const forYear = (joinDate, dayPerWeek, endDate = null) =>
  annualLeaveForYear({
    joinDate: d(joinDate),
    dayPerWeek,
    leaveYearStart: YEAR.start,
    leaveYearEnd: YEAR.end,
    endDate: endDate ? d(endDate) : null,
  });

check("5.6 weeks is the statutory multiplier", () => {
  assert.equal(STATUTORY_WEEKS, 5.6);
});

check("THE SHIPPED WORKED EXAMPLES STILL HOLD", () => {
  // These three are the examples documented in countLeaveServer.js and are what
  // every existing company's entitlements were built from.
  assert.equal(forYear("2020-01-01", 5), 28); // 5.6 × 5
  assert.equal(forYear("2020-01-01", 6), 34); // 5.6 × 6 = 33.6
  assert.equal(forYear("2020-01-01", 3), 17); // 5.6 × 3 = 16.8
});

check("joining on the first day of the leave year is a full year", () => {
  assert.equal(forYear("2025-04-01", 5), 28);
});

check("joining before the leave year is a full year", () => {
  assert.equal(forYear("2019-07-15", 5), 28);
});

check("a part-time week gets a part-time entitlement, not a fraction of five", () => {
  assert.equal(forYear("2020-01-01", 1), 6); // 5.6 → 6
  assert.equal(forYear("2020-01-01", 2), 12); // 11.2 → 12
  assert.equal(forYear("2020-01-01", 4), 23); // 22.4 → 23
});

/* -------------------------------------------------------------------------- */
/* Pro-rata                                                                    */
/* -------------------------------------------------------------------------- */

check("joining half way through gives about half", () => {
  // 1 Oct 2025 → 31 Mar 2026 is 182 of 365 days. 28 × 182/365 = 13.96.
  assert.equal(forYear("2025-10-01", 5), 14);
});

check("PRO-RATA IS BY DAYS, NOT BY WHOLE MONTHS", () => {
  // The bug this replaced: the old code counted a calendar month as worked
  // however little of it was, so these two were given the same entitlement —
  // the 30 June joiner got a whole extra month they had not worked.
  const first = forYear("2025-06-01", 5);
  const last = forYear("2025-06-30", 5);
  assert.ok(first > last, `1 June (${first}) should beat 30 June (${last})`);
  assert.equal(first - last, 2, "a month's difference should be about 2 days");
});

check("each day later is never MORE leave", () => {
  let previous = Infinity;
  for (let day = 1; day <= 28; day++) {
    const days = forYear(`2025-09-${String(day).padStart(2, "0")}`, 5);
    assert.ok(days <= previous, `day ${day} went up`);
    previous = days;
  }
});

check("part days round UP, in the employee's favour", () => {
  // 1 Jul 2025 → 31 Mar 2026 is 274 days. 28 × 274/365 = 21.02 → 22.
  // Never less than the exact share, because the figure is a statutory minimum.
  const exact = (28 * 274) / 365;
  const given = forYear("2025-07-01", 5);
  assert.ok(given >= exact, `${given} is less than the exact ${exact}`);
  assert.ok(given - exact < 1);
});

check("joining on the last day of the leave year still gives a day", () => {
  // Arithmetically 28/365 = 0.08 of a day. Rounding down would be nothing at
  // all for somebody who did work for the company that year.
  assert.equal(forYear("2026-03-31", 5), 1);
});

/* -------------------------------------------------------------------------- */
/* The edges that used to produce nonsense                                     */
/* -------------------------------------------------------------------------- */

check("A FUTURE START DATE IS ZERO, NOT NEGATIVE", () => {
  // The old month arithmetic returned a negative month count for a start date
  // in a later leave year, and stored a negative entitlement — a record saying
  // the employee owed the company leave. Entering somebody before they start is
  // the normal way to enter a new joiner.
  assert.equal(forYear("2026-04-01", 5), 0);
  assert.equal(forYear("2027-01-01", 5), 0);
  assert.equal(forYear("2030-06-15", 6), 0);
});

check("no contracted week means no entitlement can be worked out", () => {
  assert.equal(forYear("2025-04-01", 0), 0);
  assert.equal(forYear("2025-04-01", null), 0);
  assert.equal(forYear("2025-04-01", undefined), 0);
  assert.equal(forYear("2025-04-01", -3), 0);
});

check("a missing or unreadable start date is zero, not NaN", () => {
  const base = {
    dayPerWeek: 5,
    leaveYearStart: YEAR.start,
    leaveYearEnd: YEAR.end,
  };
  assert.equal(annualLeaveForYear({ ...base, joinDate: null }), 0);
  assert.equal(annualLeaveForYear({ ...base, joinDate: "" }), 0);
  assert.equal(annualLeaveForYear({ ...base, joinDate: "not a date" }), 0);
});

check("a leaver gets the part of the year they were employed for", () => {
  // Employed all year but leaving 30 Sep 2025: 1 Apr → 30 Sep is 183 days.
  // 28 × 183/365 = 14.04 → 15.
  assert.equal(forYear("2020-01-01", 5, "2025-09-30"), 15);
});

check("somebody who left before the leave year began gets nothing", () => {
  assert.equal(forYear("2019-01-01", 5, "2024-12-31"), 0);
});

check("a leaving date after the leave year ends does not reduce anything", () => {
  assert.equal(forYear("2020-01-01", 5, "2030-01-01"), 28);
});

check("joining and leaving inside the same leave year is that window", () => {
  // 1 Jul 2025 → 30 Sep 2025 is 92 days. 28 × 92/365 = 7.06 → 8.
  assert.equal(forYear("2025-07-01", 5, "2025-09-30"), 8);
});

/* -------------------------------------------------------------------------- */
/* The explanation                                                             */
/* -------------------------------------------------------------------------- */

const explainFor = (joinDate, dayPerWeek) =>
  explainAnnualLeave({
    joinDate: d(joinDate),
    dayPerWeek,
    leaveYearStart: YEAR.start,
    leaveYearEnd: YEAR.end,
  });

check("the explanation agrees with the number it explains", () => {
  for (const [joinDate, perWeek] of [
    ["2020-01-01", 5],
    ["2025-10-01", 5],
    ["2025-06-30", 3],
    ["2026-04-01", 5],
  ]) {
    const explained = explainFor(joinDate, perWeek);
    assert.equal(
      explained.days,
      forYear(joinDate, perWeek),
      `${joinDate} @ ${perWeek}/week`
    );
  }
});

check("a full year says so; a part year shows the fraction", () => {
  const full = explainFor("2020-01-01", 5);
  assert.equal(full.proRated, false);
  assert.match(full.explanation, /all year/);

  const part = explainFor("2025-10-01", 5);
  assert.equal(part.proRated, true);
  assert.equal(part.employedDays, 182);
  assert.equal(part.yearDays, 365);
  assert.match(part.explanation, /182 of 365/);
});

check("a future starter is told why they get nothing", () => {
  const future = explainFor("2026-06-01", 5);
  assert.equal(future.days, 0);
  assert.match(future.explanation, /after this leave year ends/);
});

check("no contracted week is explained rather than shown as zero days", () => {
  const none = explainFor("2025-04-01", 0);
  assert.equal(none.days, 0);
  assert.match(none.explanation, /contracted days/);
});

/* -------------------------------------------------------------------------- */
/* A January company                                                           */
/* -------------------------------------------------------------------------- */

check("a January leave year pro-rates against ITS twelve months", () => {
  const jan = leaveYearBounds(d("2026-06-01"), 1); // 2026-01-01 → 2026-12-31
  // Joining 1 July 2026 is 184 of 365 days: 28 × 184/365 = 14.1 → 15.
  const days = annualLeaveForYear({
    joinDate: d("2026-07-01"),
    dayPerWeek: 5,
    leaveYearStart: jan.start,
    leaveYearEnd: jan.end,
  });
  assert.equal(days, 15);

  // The same start date on an April company is a different answer, which is the
  // whole reason the start month has to be a real setting and not a default.
  const apr = leaveYearBounds(d("2026-07-01"), 4); // 2026-04-01 → 2027-03-31
  const aprDays = annualLeaveForYear({
    joinDate: d("2026-07-01"),
    dayPerWeek: 5,
    leaveYearStart: apr.start,
    leaveYearEnd: apr.end,
  });
  assert.equal(aprDays, 22);
  assert.notEqual(days, aprDays);
});

/* -------------------------------------------------------------------------- */
/* The per-type ceiling                                                        */
/* -------------------------------------------------------------------------- */

check("ANNUAL LEAVE IS THE ONLY TYPE WITH A TIGHT CEILING", () => {
  // The one type with a well-known real range, and the one where a stray digit
  // quietly hands somebody a year of holiday. 60 clears every genuine figure:
  // 34 for a six-day week, plus bank holidays, plus a carry-forward allowance.
  assert.equal(maxTotalFor("Annual Leave", "days"), 60);
  assert.ok(maxTotalFor("Annual Leave", "days") > 34 + 8 + 10);
});

check("the types a tight cap used to break are bounded by the leave year", () => {
  // A flat cap of 40 meant Unpaid Leave (which starts at 100) could never be
  // edited at all, and a six-month company sick-pay scheme was impossible.
  assert.equal(maxTotalFor("Unpaid Leave", "days"), 366);
  assert.equal(maxTotalFor("Sick Leave", "days"), 366);
  assert.ok(maxTotalFor("Unpaid Leave", "days") > 100);
});

check("A WEEKS-BASED TYPE IS CAPPED IN WEEKS, NOT DAYS", () => {
  // Maternity is 52 *weeks* by law and was 12 over a flat cap of 40.
  assert.equal(maxTotalFor("Maternity Leave", "weeks"), 52);
  assert.equal(maxTotalFor("Paternity Leave", "weeks"), 52);
});

check("a leave type the catalogue has never heard of still gets a ceiling", () => {
  // Companies create their own, so there always has to be a fallback — and the
  // only limit true of all of them is the length of the period being allocated.
  assert.equal(maxTotalFor("Sabbatical", "days"), MAX_TOTAL_BY_UNIT.days);
  assert.equal(maxTotalFor("Sabbatical", "weeks"), MAX_TOTAL_BY_UNIT.weeks);
  // A missing or nonsense unit falls back to days rather than to nothing.
  assert.equal(maxTotalFor("Sabbatical"), MAX_TOTAL_BY_UNIT.days);
  assert.equal(maxTotalFor("Sabbatical", "fortnights"), MAX_TOTAL_BY_UNIT.days);
  assert.equal(maxTotalFor(undefined), MAX_TOTAL_BY_UNIT.days);
});

check("every catalogue type's starting figure is inside its own ceiling", () => {
  // A type that shipped with a `total` above its own `maxTotal` would be
  // uneditable from the moment it was created — which is exactly the bug the
  // flat cap of 40 caused for Unpaid Leave.
  for (const type of LEAVE_TYPE_CATALOGUE) {
    assert.ok(
      type.total <= type.maxTotal,
      `${type.leaveType}: starts at ${type.total}, capped at ${type.maxTotal}`
    );
    assert.ok(
      ["days", "weeks"].includes(type.unit),
      `${type.leaveType}: unit is ${type.unit}`
    );
  }
});

/* -------------------------------------------------------------------------- */

let failures = 0;
for (const [status, name] of results) {
  if (status === "FAIL") failures++;
  console.log(`${status === "pass" ? "✓" : "✗"} ${name}`);
}
console.log(
  `\n${results.length - failures}/${results.length} passed${failures ? ` — ${failures} FAILED` : ""}`
);
process.exitCode = failures ? 1 : 0;
