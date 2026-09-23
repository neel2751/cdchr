/**
 * Clock rule tests.
 *
 * Covers lib/clockTime.js and lib/clockRules.js — the arithmetic and the
 * decisions built on it. Both are pure, so this needs no database and no
 * session; run it directly:
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-clock-rules.mjs
 *
 * The case that matters most is the one at the bottom: every rule in the old
 * scanner was `(currentTime - record.clockIn) / (1000 * 60 * 60)` on two
 * "HH:mm" strings. That is NaN, and every `NaN < limit` is false, so the
 * minimum-break and minimum-shift rules passed unconditionally and had never
 * refused a scan in production. The regression test asserts the replacement
 * actually refuses.
 */
import assert from "node:assert";

import {
  diffMinutes,
  fromMinutes,
  isClockTime,
  toMinutes,
} from "@/lib/clockTime";
import {
  DEFAULT_CLOCK_RULES,
  checkClockAction,
  describeMinutes,
  resolveClockRules,
  resolveCutover,
  validateShift,
} from "@/lib/clockRules";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

const today = new Date(Date.UTC(2026, 8, 19));
const yesterday = new Date(Date.UTC(2026, 8, 18));
const tomorrow = new Date(Date.UTC(2026, 8, 20));

/* ---------------------------------------------------------------- arithmetic */

check("toMinutes parses a clock time", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("09:30"), 570);
  assert.equal(toMinutes("23:59"), 1439);
});

check("toMinutes rejects anything that is not one", () => {
  for (const bad of ["24:00", "9:30", "09:60", "", null, undefined, 570, "abc"]) {
    assert.equal(toMinutes(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

check("isClockTime matches the schema's own regex", () => {
  assert.equal(isClockTime("09:05"), true);
  assert.equal(isClockTime("9:05"), false);
  assert.equal(isClockTime("25:00"), false);
});

check("fromMinutes round-trips and wraps past midnight", () => {
  assert.equal(fromMinutes(570), "09:30");
  assert.equal(fromMinutes(0), "00:00");
  assert.equal(fromMinutes(1470), "00:30");
  assert.equal(toMinutes(fromMinutes(725)), 725);
});

check("diffMinutes measures a normal shift", () => {
  assert.equal(diffMinutes("09:00", "17:00"), 480);
  assert.equal(diffMinutes("09:00", "09:00"), 0);
});

check("diffMinutes treats a wrap as a night shift", () => {
  assert.equal(diffMinutes("22:00", "06:00"), 480);
  assert.equal(diffMinutes("23:30", "00:30"), 60);
});

check("diffMinutes is null when either side is unusable", () => {
  assert.equal(diffMinutes("09:00", null), null);
  assert.equal(diffMinutes("nope", "17:00"), null);
});

check("describeMinutes reads like a person wrote it", () => {
  assert.equal(describeMinutes(1), "1 minute");
  assert.equal(describeMinutes(30), "30 minutes");
  assert.equal(describeMinutes(60), "1 hour");
  assert.equal(describeMinutes(120), "2 hours");
  assert.equal(describeMinutes(90), "1h 30m");
});

/* ------------------------------------------------------------------ settings */

check("rules default to policy off, matching today's behaviour", () => {
  const r = resolveClockRules(null);
  assert.equal(r.minMinutesBeforeBreak, 0);
  assert.equal(r.minBreakMinutes, 0);
  assert.equal(r.minMinutesBeforeClockOut, 0);
  assert.equal(r.maxShiftHours, 16);
});

check("rules read from a settings document", () => {
  // Deliberately an exact-shape check: a rule added to the resolver but not to
  // the settings screen, or vice versa, should fail here rather than quietly
  // resolve to undefined on the scan path.
  const r = resolveClockRules({
    maxShiftHours: 12,
    minMinutesBeforeBreak: 120,
    minBreakMinutes: 30,
    minMinutesBeforeClockOut: 120,
    clockCutoverDate: "2026-09-23",
  });
  assert.deepEqual(r, {
    maxShiftHours: 12,
    minMinutesBeforeBreak: 120,
    minBreakMinutes: 30,
    minMinutesBeforeClockOut: 120,
    clockCutoverDate: new Date("2026-09-23T00:00:00.000Z"),
  });
});

check("a nonsense setting falls back rather than disabling the cap", () => {
  assert.equal(resolveClockRules({ maxShiftHours: 0 }).maxShiftHours, 16);
  assert.equal(resolveClockRules({ maxShiftHours: -5 }).maxShiftHours, 16);
  assert.equal(resolveClockRules({ minBreakMinutes: "x" }).minBreakMinutes, 0);
});

check("no cutover by default", () => {
  assert.equal(resolveClockRules(null).clockCutoverDate, null);
  assert.equal(resolveClockRules({}).clockCutoverDate, null);
});

check("a cutover is flattened to UTC midnight", () => {
  // Clock records are stored at UTC midnight. A cutover carrying a time of day
  // compares unevenly against them and drops the cutover day itself.
  const withTime = resolveCutover("2026-09-23T14:37:00.000Z");
  assert.equal(withTime.toISOString(), "2026-09-23T00:00:00.000Z");

  assert.equal(
    resolveCutover(new Date("2026-09-23T23:59:59.999Z")).toISOString(),
    "2026-09-23T00:00:00.000Z",
  );
  assert.equal(
    resolveCutover("2026-09-23").toISOString(),
    "2026-09-23T00:00:00.000Z",
  );
});

check("an unusable cutover means no floor, not an epoch date", () => {
  // Failing open flags more rather than fewer. Falling back to 1970 would look
  // like a floor and do nothing; falling back to today would silently hide
  // every real gap.
  assert.equal(resolveCutover("not a date"), null);
  assert.equal(resolveCutover(""), null);
  assert.equal(resolveCutover(undefined), null);
  assert.equal(resolveCutover(new Date("nonsense")), null);
  assert.equal(resolveClockRules({ clockCutoverDate: "x" }).clockCutoverDate, null);
});

/* ------------------------------------------------------------- validateShift */

const ctx = { date: today, today, now: "18:00" };
const ok = (shift, context = ctx, rules = DEFAULT_CLOCK_RULES) =>
  validateShift(shift, context, rules);

check("a normal day passes", () => {
  const r = ok({
    clockIn: "09:00",
    clockOut: "17:00",
    breaks: [{ breakIn: "12:00", breakOut: "12:30" }],
  });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

check("a night shift passes — it is not a backwards day", () => {
  const r = validateShift(
    { clockIn: "22:00", clockOut: "06:00", breaks: [{ breakIn: "01:00", breakOut: "01:30" }] },
    { date: yesterday, today, now: "18:00" },
  );
  assert.deepEqual(r.errors, []);
});

check("a mistyped clock out is caught by the length cap", () => {
  // 09:00 -> 08:00 wraps to 23 hours. Indistinguishable from a night shift by
  // ordering alone, which is exactly why the rule is on length.
  const r = ok({ clockIn: "09:00", clockOut: "08:00", breaks: [] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /longer than the 16-hour maximum/);
});

check("a same-minute shift is allowed, not rejected", () => {
  // Clock in and clock out inside one minute. Times are minute-granular, so
  // this is what a mis-click looks like — and refusing it left the person
  // stuck checked-in with no way to close the day from the quick actions.
  const r = ok({ clockIn: "09:00", clockOut: "09:00", breaks: [] });
  assert.deepEqual(r.errors, []);
});

check("a clock out with no clock in is rejected", () => {
  // The upsert path could create exactly this: a quick "clock out" on a day
  // with no record inserted a row with no clockIn at all.
  const r = ok({ clockOut: "17:00", breaks: [] });
  assert.match(r.errors.join(" "), /needs a clock in/);
});

check("a malformed time is rejected", () => {
  const r = ok({ clockIn: "9am", clockOut: "17:00", breaks: [] });
  assert.match(r.errors.join(" "), /must be a time like/);
});

check("a break ending before it starts is rejected", () => {
  const r = ok({
    clockIn: "09:00",
    clockOut: "17:00",
    breaks: [{ breakIn: "12:30", breakOut: "12:00" }],
  });
  assert.match(r.errors.join(" "), /Break 1: end cannot be before its start/);
});

check("a same-minute break is allowed", () => {
  // Same reasoning, and it is the one the admin quick actions actually hit:
  // Start break then End break in the same minute used to be refused, which
  // left the row reading On Break for ever.
  const r = ok({
    clockIn: "09:00",
    clockOut: "17:00",
    breaks: [{ breakIn: "12:00", breakOut: "12:00" }],
  });
  assert.deepEqual(r.errors, []);
});

check("a break outside the shift is rejected", () => {
  const r = ok({
    clockIn: "09:00",
    clockOut: "17:00",
    breaks: [{ breakIn: "18:00", breakOut: "18:30" }],
  });
  assert.match(r.errors.join(" "), /Break 1 falls outside the shift/);
});

check("a break inside a night shift is measured from clock in", () => {
  // 00:30 is 150 minutes into a shift that began at 22:00, not 1290 before it.
  const r = validateShift(
    { clockIn: "22:00", clockOut: "06:00", breaks: [{ breakIn: "00:30", breakOut: "01:00" }] },
    { date: yesterday, today, now: "18:00" },
  );
  assert.deepEqual(r.errors, []);
});

check("overlapping breaks are rejected", () => {
  const r = ok({
    clockIn: "09:00",
    clockOut: "17:00",
    breaks: [
      { breakIn: "12:00", breakOut: "12:45" },
      { breakIn: "12:30", breakOut: "13:00" },
    ],
  });
  assert.match(r.errors.join(" "), /Breaks 1 and 2 overlap/);
});

check("touching breaks do not count as overlapping", () => {
  const r = ok({
    clockIn: "09:00",
    clockOut: "17:00",
    breaks: [
      { breakIn: "12:00", breakOut: "12:30" },
      { breakIn: "12:30", breakOut: "13:00" },
    ],
  });
  assert.deepEqual(r.errors, []);
});

check("overlap is detected regardless of the order they are listed in", () => {
  const r = ok({
    clockIn: "09:00",
    clockOut: "17:00",
    breaks: [
      { breakIn: "14:00", breakOut: "14:30" },
      { breakIn: "13:45", breakOut: "14:15" },
    ],
  });
  assert.match(r.errors.join(" "), /overlap/);
});

check("a break end with no start is rejected", () => {
  const r = ok({ clockIn: "09:00", clockOut: "17:00", breaks: [{ breakOut: "12:30" }] });
  assert.match(r.errors.join(" "), /Break 1 has an end but no start/);
});

check("an open break is fine — that is mid-shift, not broken", () => {
  const r = ok({ clockIn: "09:00", breaks: [{ breakIn: "12:00" }] });
  assert.deepEqual(r.errors, []);
});

check("a future date is rejected", () => {
  const r = ok({ clockIn: "09:00", clockOut: "17:00", breaks: [] }, {
    date: tomorrow,
    today,
    now: "18:00",
  });
  assert.match(r.errors.join(" "), /future date/);
});

check("a clock in later than now is rejected on today's record", () => {
  const r = ok({ clockIn: "19:00", breaks: [] }, { date: today, today, now: "18:00" });
  assert.match(r.errors.join(" "), /later than the current time/);
});

check("a future clock in is still caught when a clock out is present", () => {
  // The check used to be skipped entirely once clockOut was set, so adding an
  // end time was enough to smuggle a future start past it.
  const r = ok({ clockIn: "19:00", clockOut: "20:00", breaks: [] }, {
    date: today,
    today,
    now: "18:00",
  });
  assert.match(r.errors.join(" "), /later than the current time/);
});

check("a finished night shift on today's record is not 'in the future'", () => {
  // Clocked in at 02:00, out at 06:00, now 18:00. The clock out reads as
  // earlier than now and must not be mistaken for a future time.
  const r = ok({ clockIn: "02:00", clockOut: "06:00", breaks: [] }, {
    date: today,
    today,
    now: "18:00",
  });
  assert.deepEqual(r.errors, []);
});

check("the same time on a past record is fine", () => {
  const r = ok({ clockIn: "19:00", clockOut: "23:00", breaks: [] }, {
    date: yesterday,
    today,
    now: "18:00",
  });
  assert.deepEqual(r.errors, []);
});

check("every problem is reported at once, not just the first", () => {
  const r = ok({
    clockIn: "09:00",
    clockOut: "17:00",
    breaks: [
      { breakIn: "12:30", breakOut: "12:00" },
      { breakIn: "18:00", breakOut: "18:30" },
    ],
  });
  assert.equal(r.errors.length, 2, `expected 2 errors, got ${r.errors.length}`);
});

/* ---------------------------------------------------------- checkClockAction */

const open = (over = {}) => ({ clockIn: "09:00", breaks: [], ...over });

check("clock in is allowed when there is no record", () => {
  assert.equal(checkClockAction(null, "clockIn", "09:00").ok, true);
});

check("clock in twice is refused", () => {
  const r = checkClockAction(open(), "clockIn", "09:05");
  assert.equal(r.ok, false);
  assert.match(r.message, /already clocked in/);
});

check("anything before clocking in is refused", () => {
  for (const action of ["breakIn", "breakOut", "clockOut"]) {
    const r = checkClockAction(null, action, "09:00");
    assert.equal(r.ok, false);
    assert.match(r.message, /must clock in first/);
  }
});

check("nothing is allowed after clocking out", () => {
  const done = open({ clockOut: "17:00" });
  for (const action of ["clockIn", "breakIn", "breakOut", "clockOut"]) {
    assert.equal(checkClockAction(done, action, "17:30").ok, false, action);
  }
});

check("break in twice is refused", () => {
  const r = checkClockAction(open({ breaks: [{ breakIn: "12:00" }] }), "breakIn", "12:05");
  assert.match(r.message, /must break out first/);
});

check("break out with no open break is refused", () => {
  const r = checkClockAction(open({ breaks: [{ breakIn: "12:00", breakOut: "12:30" }] }), "breakOut", "13:00");
  assert.match(r.message, /must break in first/);
});

check("break out after a break in is allowed", () => {
  assert.equal(
    checkClockAction(open({ breaks: [{ breakIn: "12:00" }] }), "breakOut", "12:30").ok,
    true,
  );
});

check("clocking out with a break still open is allowed", () => {
  // Deliberate: someone who forgot to break back in must still be able to go
  // home. The write closes the break at the same moment.
  assert.equal(
    checkClockAction(open({ breaks: [{ breakIn: "15:00" }] }), "clockOut", "17:00").ok,
    true,
  );
});

check("a shift past the cap is refused as a missed clock out", () => {
  const r = checkClockAction(open(), "clockOut", "08:00"); // 23 hours later
  assert.equal(r.ok, false);
  assert.match(r.message, /missed clock out/);
});

/* -------------------------------------------- policy rules: off, then on */

const strict = resolveClockRules({
  minMinutesBeforeBreak: 120,
  minBreakMinutes: 30,
  minMinutesBeforeClockOut: 120,
});

check("REGRESSION: with policy off, nothing is refused on timing", () => {
  // This is the behaviour every company has today, and it must not change for
  // anyone who does not opt in.
  assert.equal(checkClockAction(open(), "breakIn", "09:01").ok, true);
  assert.equal(
    checkClockAction(open({ breaks: [{ breakIn: "12:00" }] }), "breakOut", "12:01").ok,
    true,
  );
  assert.equal(checkClockAction(open(), "clockOut", "09:05").ok, true);
});

check("REGRESSION: the old string subtraction never refused anything", () => {
  // Proof the rules were dead rather than lenient: this is exactly what the
  // old code computed, on the tightest case it was meant to catch.
  const oldStyle = ("09:05" - "09:00") / (1000 * 60 * 60);
  assert.ok(Number.isNaN(oldStyle), "expected the old comparison to be NaN");
  assert.equal(oldStyle < 2, false, "NaN < 2 is false, so the guard passed");

  // The replacement, on the same input, refuses.
  const r = checkClockAction(open(), "clockOut", "09:05", strict);
  assert.equal(r.ok, false);
  assert.match(r.message, /at least 2 hours/);
});

check("with policy on, an early break is refused", () => {
  const r = checkClockAction(open(), "breakIn", "10:00", strict);
  assert.equal(r.ok, false);
  assert.match(r.message, /within 2 hours of clocking in/);
});

check("with policy on, a break at the limit is allowed", () => {
  assert.equal(checkClockAction(open(), "breakIn", "11:00", strict).ok, true);
});

check("with policy on, a short break is refused", () => {
  const r = checkClockAction(
    open({ breaks: [{ breakIn: "12:00" }] }),
    "breakOut",
    "12:15",
    strict,
  );
  assert.equal(r.ok, false);
  assert.match(r.message, /at least 30 minutes/);
});

check("with policy on, a break at exactly the minimum is allowed", () => {
  assert.equal(
    checkClockAction(open({ breaks: [{ breakIn: "12:00" }] }), "breakOut", "12:30", strict).ok,
    true,
  );
});

check("policy rules measure correctly across midnight", () => {
  const night = { clockIn: "23:00", breaks: [] };
  assert.equal(checkClockAction(night, "clockOut", "23:30", strict).ok, false);
  assert.equal(checkClockAction(night, "clockOut", "01:00", strict).ok, true);
});

/* ---------------------------------------------------------------- report */

const failed = results.filter(([s]) => s !== "pass");
for (const [status, name] of results) {
  if (status !== "pass") console.log(`  ${status}  ${name}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — ${failed.length} FAILED` : ""),
);
process.exitCode = failed.length ? 1 : 0;
