/**
 * The holiday planner's month grid.
 *
 * Pure. Two claims are being made by the rewrite and both are the kind of
 * arithmetic that is wrong for one month of the year and right for the other
 * eleven:
 *
 *   · the week starts on MONDAY, like the rest of this app and like a UK working
 *     week — the planner used to start on Sunday and split the weekend across
 *     both ends of every row;
 *   · the grid is ALWAYS six rows, so it does not change height as somebody
 *     moves through the year.
 *
 * Also covers the date key, which is deliberately built from calendar
 * components rather than `toISOString()`: converting local midnight to UTC
 * shifts the date back a day through British Summer Time, and the whole feature
 * is about which calendar day it is.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-holiday-planner.mjs
 */
import assert from "node:assert";

import {
  MONTHS,
  WEEKDAYS,
  buildWeeks,
  dateKeyOf,
  isWeekend,
  toDateKey,
} from "@/app/admin/leaveManagement/components/leaveSettings/holiday-planner/plannerGrid";
import { leaveTone } from "@/app/admin/leaveManagement/components/leaveSettings/holiday-planner/leaveTone";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

/* -------------------------------------------------------------------------- */
/* The week starts on Monday                                                   */
/* -------------------------------------------------------------------------- */

check("THE HEADER ROW STARTS ON MONDAY AND ENDS ON SUNDAY", () => {
  // The planner shipped with ["Sun", "Mon", …], which put Saturday and Sunday at
  // opposite ends of the row so a working week was never one block.
  assert.deepEqual(WEEKDAYS, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
});

check("EVERY WEEK IN THE GRID BEGINS ON A MONDAY", () => {
  // Checked across two whole years, because the offset is only wrong for the
  // months whose 1st falls on particular weekdays.
  for (let year = 2025; year <= 2026; year++) {
    for (let month = 0; month < 12; month++) {
      for (const week of buildWeeks(year, month)) {
        assert.equal(
          week[0].getDay(),
          1,
          `${MONTHS[month]} ${year}: week starts on day ${week[0].getDay()}`
        );
        assert.equal(week[6].getDay(), 0, `${MONTHS[month]} ${year}: not Sunday`);
      }
    }
  }
});

check("the weekend is the last two columns", () => {
  const weeks = buildWeeks(2026, 5); // June 2026
  for (const week of weeks) {
    assert.equal(isWeekend(week[0]), false, "Monday is not a weekend");
    assert.equal(isWeekend(week[4]), false, "Friday is not a weekend");
    assert.equal(isWeekend(week[5]), true, "Saturday is");
    assert.equal(isWeekend(week[6]), true, "Sunday is");
  }
});

/* -------------------------------------------------------------------------- */
/* Always six rows                                                             */
/* -------------------------------------------------------------------------- */

check("THE GRID IS ALWAYS SIX WEEKS OF SEVEN DAYS", () => {
  // A grid sized to the month is four to six rows tall depending on where the
  // 1st falls, so it resized as you moved through the year.
  for (let year = 2024; year <= 2027; year++) {
    for (let month = 0; month < 12; month++) {
      const weeks = buildWeeks(year, month);
      assert.equal(weeks.length, 6, `${MONTHS[month]} ${year}`);
      for (const week of weeks) assert.equal(week.length, 7);
    }
  }
});

check("the grid always contains the whole month", () => {
  for (let year = 2025; year <= 2026; year++) {
    for (let month = 0; month < 12; month++) {
      const days = buildWeeks(year, month).flat();
      const lastDay = new Date(year, month + 1, 0).getDate();
      const keys = new Set(days.map(dateKeyOf));
      for (let day = 1; day <= lastDay; day++) {
        assert.ok(
          keys.has(toDateKey(year, month, day)),
          `${MONTHS[month]} ${year} is missing day ${day}`
        );
      }
    }
  }
});

check("the days run consecutively, with no gap or repeat", () => {
  const days = buildWeeks(2026, 1).flat(); // February 2026
  assert.equal(days.length, 42);
  const DAY = 24 * 60 * 60 * 1000;
  for (let i = 1; i < days.length; i++) {
    // Compared as calendar days, so a clock change does not read as a gap.
    const previous = Date.UTC(
      days[i - 1].getFullYear(),
      days[i - 1].getMonth(),
      days[i - 1].getDate()
    );
    const current = Date.UTC(
      days[i].getFullYear(),
      days[i].getMonth(),
      days[i].getDate()
    );
    assert.equal(current - previous, DAY, `gap before index ${i}`);
  }
});

check("A MONTH STARTING ON A SUNDAY IS NOT SHIFTED A WEEK", () => {
  // The case a naive `getDay()` offset gets wrong: Sunday is 0, so without the
  // +6 shift the 1st lands in the first column instead of the last.
  const first = new Date(2026, 2, 1); // 1 March 2026 is a Sunday
  assert.equal(first.getDay(), 0);

  const weeks = buildWeeks(2026, 2);
  const firstOfMonth = weeks
    .flat()
    .find((date) => date.getDate() === 1 && date.getMonth() === 2);
  const row = weeks.findIndex((week) => week.includes(firstOfMonth));
  const column = weeks[row].indexOf(firstOfMonth);

  assert.equal(column, 6, "1 March should sit in the Sunday column");
  assert.equal(row, 0, "and in the first row");
});

check("a month starting on a Monday starts in the first cell", () => {
  const first = new Date(2026, 5, 1); // 1 June 2026 is a Monday
  assert.equal(first.getDay(), 1);
  const weeks = buildWeeks(2026, 5);
  assert.equal(dateKeyOf(weeks[0][0]), "2026-06-01");
});

check("the overflow days really are the neighbouring months", () => {
  const weeks = buildWeeks(2026, 0); // January 2026, 1st is a Thursday
  assert.equal(dateKeyOf(weeks[0][0]), "2025-12-29", "should open in December");
  const last = weeks[5][6];
  assert.equal(last.getMonth(), 1, "and close in February");
});

/* -------------------------------------------------------------------------- */
/* Date keys                                                                   */
/* -------------------------------------------------------------------------- */

check("THE DATE KEY IS NOT SHIFTED BY BRITISH SUMMER TIME", () => {
  // The bug the comment in the planner has always warned about, and the one the
  // abandoned second planner actually had: `new Date(2026, 5, 15).toISOString()`
  // is the 14th in any timezone east of UTC, and the leave then renders on the
  // wrong cell.
  const midsummer = new Date(2026, 5, 15);
  assert.equal(dateKeyOf(midsummer), "2026-06-15");
  assert.equal(toDateKey(2026, 5, 15), "2026-06-15");
});

check("months and days are zero-padded", () => {
  assert.equal(toDateKey(2026, 0, 1), "2026-01-01");
  assert.equal(toDateKey(2026, 8, 9), "2026-09-09");
  assert.equal(toDateKey(2026, 11, 31), "2026-12-31");
});

check("a leap day keys correctly", () => {
  assert.equal(dateKeyOf(new Date(2028, 1, 29)), "2028-02-29");
  const keys = buildWeeks(2028, 1).flat().map(dateKeyOf);
  assert.ok(keys.includes("2028-02-29"));
});

/* -------------------------------------------------------------------------- */
/* Leave type colours                                                          */
/* -------------------------------------------------------------------------- */

check("EVERY LEAVE TYPE GETS A COLOUR, NOT JUST THREE", () => {
  // The planner had three cases: Annual green, Unpaid amber, everything else
  // purple — so sick, maternity, bereavement and jury service were all one
  // colour and a day with four kinds of absence read as one kind.
  const types = [
    "Annual Leave",
    "Unpaid Leave",
    "Sick Leave",
    "Maternity Leave",
    "Bereavement Leave",
    "Jury Service",
    "Study Leave",
  ];
  const dots = types.map((type) => leaveTone(type).dot);
  assert.equal(
    new Set(dots).size,
    dots.length,
    `colours collide: ${dots.join(", ")}`
  );
});

check("a company's own leave type gets a stable colour", () => {
  // Derived from the name rather than from position, so it does not change
  // between months or between sessions depending on what order the day's leave
  // came back in.
  const first = leaveTone(`Duvet Day`);
  const again = leaveTone(`Duvet Day`);
  assert.deepEqual(first, again);
  assert.ok(first.dot.startsWith("bg-"));
  assert.ok(first.chip.includes("border-"));
});

check("an unknown or empty type still gets usable classes", () => {
  for (const type of [undefined, null, "", 0]) {
    const tone = leaveTone(type);
    assert.ok(tone.dot && tone.chip, `no tone for ${JSON.stringify(type)}`);
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
