/**
 * Carry-forward: how many unused days follow somebody into the new leave year.
 *
 * Pure. Written because of a real report — an employee on a six-day week who
 * joined on 25 June 2025 showed **44** days of annual leave for 2026-27, where
 * 5.6 × 6 = 34 is the whole-year figure. The extra ten were carried over from
 * 2025-26, which is legitimate; what was not legitimate is that
 *
 *   · the preview screen reported zero carry-forward for everybody, because it
 *     tested `rule.enabled` and the schema field is `allowed`;
 *   · nothing on any screen showed that ten of the 44 were carried;
 *   · the carry was not capped by the leave type's own ceiling, so a big enough
 *     carry could store a total nobody could ever edit again;
 *   · a half-day balance carried as a half day, making the total fractional and
 *     the row equally uneditable.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-carry-forward.mjs
 */
import assert from "node:assert";

import {
  applyCarryForwardLapse,
  carriedState,
  carryForwardEligibility,
  carryForwardExpiry,
  overrideFor,
  proRateCarryCap,
  resolveCarryForward,
} from "@/lib/carryForward";
import { maxTotalFor } from "@/data/leaveTypes";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

/** The common shape: annual leave, a full year's entitlement already worked out. */
const annual = (overrides = {}) =>
  resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 10 },
    previousRemaining: 12,
    baseTotal: 34,
    leaveType: "Annual Leave",
    ...overrides,
  });

/* -------------------------------------------------------------------------- */
/* The reported case                                                           */
/* -------------------------------------------------------------------------- */

check("THE 44-DAY CASE IS CARRY-FORWARD, AND IT ADDS UP", () => {
  // Six-day week, joined before the leave year began, so a full 34 — plus a
  // rule allowing ten days, and more than ten left over.
  const carried = annual({ previousRemaining: 28, baseTotal: 34 });
  assert.equal(carried.days, 10);
  assert.equal(34 + carried.days, 44);
  assert.equal(carried.outcome, "capped-by-rule");
  assert.match(carried.explanation, /allows at most 10/);
});

check("the figure is explainable without reading the code", () => {
  const carried = annual({ previousRemaining: 28 });
  // Whatever a screen shows, it can show this sentence.
  assert.ok(carried.explanation.length > 20);
  assert.equal(carried.lost, 18);
});

/* -------------------------------------------------------------------------- */
/* The switches                                                                */
/* -------------------------------------------------------------------------- */

check("the company switch being off means nothing carries", () => {
  const carried = annual({ enabled: false });
  assert.equal(carried.days, 0);
  assert.equal(carried.outcome, "disabled");
});

check("A RULE MUST SAY 'allowed', NOT 'enabled'", () => {
  // The bug: the preview tested a field that does not exist on the schema, so it
  // was always undefined and always reported zero. Anything other than an
  // explicit `allowed: true` carries nothing.
  assert.equal(annual({ rule: { enabled: true, maxDays: 10 } }).days, 0);
  assert.equal(annual({ rule: { allowed: true, maxDays: 10 } }).days, 10);

  for (const rule of [
    undefined,
    null,
    {},
    { maxDays: 10 },
    { allowed: false, maxDays: 10 },
    { allowed: "yes", maxDays: 10 },
    { allowed: 1, maxDays: 10 },
  ]) {
    assert.equal(annual({ rule }).days, 0, `carried on ${JSON.stringify(rule)}`);
  }
});

check("a rule allowing zero days carries nothing", () => {
  const carried = annual({ rule: { allowed: true, maxDays: 0 } });
  assert.equal(carried.days, 0);
  assert.equal(carried.outcome, "no-rule");
});

check("nothing left over means nothing to carry", () => {
  for (const previousRemaining of [0, -3, null, undefined, ""]) {
    const carried = annual({ previousRemaining });
    assert.equal(carried.days, 0, `for ${previousRemaining}`);
  }
  assert.equal(annual({ previousRemaining: 0 }).outcome, "nothing-left");
});

/* -------------------------------------------------------------------------- */
/* The caps                                                                    */
/* -------------------------------------------------------------------------- */

check("less left than the rule allows carries all of it", () => {
  const carried = annual({ previousRemaining: 4, rule: { allowed: true, maxDays: 10 } });
  assert.equal(carried.days, 4);
  assert.equal(carried.lost, 0);
  assert.equal(carried.outcome, "full");
});

check("THE CARRY IS CAPPED BY THE LEAVE TYPE'S OWN CEILING", () => {
  // 34 fresh days plus 30 carried used to store a total of 64 — above the 60
  // data/leaveTypes.js allows anybody to set by hand, which left the row
  // permanently uneditable: every subsequent save was refused for exceeding it.
  const ceiling = maxTotalFor("Annual Leave", "days");
  assert.equal(ceiling, 60);

  const carried = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 30 },
    previousRemaining: 30,
    baseTotal: 34,
    leaveType: "Annual Leave",
  });
  assert.equal(carried.days, 26, "should stop at the ceiling");
  assert.equal(34 + carried.days, ceiling);
  assert.equal(carried.outcome, "capped-by-ceiling");
  assert.match(carried.explanation, /60 days limit|60 days/);
});

check("an entitlement already at the ceiling carries nothing more", () => {
  const carried = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 10 },
    previousRemaining: 10,
    baseTotal: 60,
    leaveType: "Annual Leave",
  });
  assert.equal(carried.days, 0);
  assert.equal(carried.outcome, "capped-by-ceiling");
});

check("a generous type is capped by the leave year, not by 40", () => {
  // A company sick-pay scheme's ceiling is a whole leave year, so a big carry is
  // fine there — the old flat limit of 40 would have clipped it.
  //
  // Deliberately NOT Unpaid Leave, which never carries at all: its `remaining`
  // is not maintained, so carrying it would compound. See the test below.
  const carried = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 50 },
    previousRemaining: 80,
    baseTotal: 100,
    leaveType: "Sick Leave",
  });
  assert.equal(carried.days, 50);
  assert.equal(maxTotalFor("Sick Leave", "days"), 366);
});

check("a weeks-based type is capped in weeks", () => {
  const carried = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 20 },
    previousRemaining: 20,
    baseTotal: 45,
    leaveType: "Maternity Leave",
    unit: "weeks",
  });
  // 52 is the ceiling in weeks, so only 7 fit.
  assert.equal(carried.days, 7);
});

/* -------------------------------------------------------------------------- */
/* Whole days                                                                  */
/* -------------------------------------------------------------------------- */

check("A HALF DAY DOES NOT CARRY, BECAUSE A HALF TOTAL CANNOT BE EDITED", () => {
  // The app books half days, so a balance really can be 2.5 — but a stored total
  // of 36.5 is refused by editCommonLeave, which takes integers only. The half
  // is left behind rather than rounded up into unaccrued entitlement.
  const carried = annual({ previousRemaining: 2.5, rule: { allowed: true, maxDays: 10 } });
  assert.equal(carried.days, 2);
  assert.ok(Number.isInteger(carried.days));
  assert.equal(carried.lost, 0.5);
});

check("the carried figure is always a whole number", () => {
  for (const previousRemaining of [0.5, 1.5, 9.99, 10.5, 33.3]) {
    const carried = annual({ previousRemaining });
    assert.ok(
      Number.isInteger(carried.days),
      `${previousRemaining} carried ${carried.days}`
    );
  }
});

check("what is carried plus what is lost is never more than what was left", () => {
  for (const previousRemaining of [0, 1, 2.5, 9, 10, 11, 28, 40]) {
    const carried = annual({ previousRemaining });
    assert.ok(
      carried.days + carried.lost <= previousRemaining + 1e-9,
      `${previousRemaining}: ${carried.days} + ${carried.lost}`
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Expiry                                                                      */
/* -------------------------------------------------------------------------- */

check("AN EXPIRY THE FORM DEMANDS IS NO LONGER DISCARDED", () => {
  // The settings form refuses to save a rule without `expireAfterMonths`, and
  // nothing read it — so "carried days expire after three months" meant they
  // lasted the whole year.
  const start = new Date(2026, 3, 1); // 1 April 2026
  const expiry = carryForwardExpiry({ expireAfterMonths: 3 }, start);
  assert.ok(expiry instanceof Date);
  assert.equal(expiry.getFullYear(), 2026);
  assert.equal(expiry.getMonth(), 6); // July
  assert.equal(expiry.getDate(), 1);
});

check("no expiry set means no expiry date", () => {
  const start = new Date(2026, 3, 1);
  for (const rule of [undefined, null, {}, { expireAfterMonths: 0 }]) {
    assert.equal(carryForwardExpiry(rule, start), null);
  }
  assert.equal(carryForwardExpiry({ expireAfterMonths: 3 }, null), null);
});

check("an expiry that crosses a year end lands in the next year", () => {
  const start = new Date(2026, 11, 1); // 1 December 2026
  const expiry = carryForwardExpiry({ expireAfterMonths: 4 }, start);
  assert.equal(expiry.getFullYear(), 2027);
  assert.equal(expiry.getMonth(), 3); // April
});

/* -------------------------------------------------------------------------- */
/* Who qualifies                                                               */
/* -------------------------------------------------------------------------- */

const YEAR_START = new Date(2026, 3, 1); // 1 April 2026
const DEPT_OPS = "650000000000000000000001";
const DEPT_SITE = "650000000000000000000002";

/** A full-timer in Operations who started five years ago, no exceptions. */
const staff = (overrides = {}) => ({
  employeType: "Full-Time",
  department: DEPT_OPS,
  joinDate: new Date(2021, 0, 1),
  dayPerWeek: 5,
  carryForwardOverrides: [],
  ...overrides,
});

/** An exception for one leave type, as the employee record stores it. */
const excepted = (leaveType, mode, overrides = {}) =>
  staff({ carryForwardOverrides: [{ leaveType, mode }], ...overrides });

const eligible = (rule, employee, leaveType = "Annual Leave") =>
  carryForwardEligibility({
    rule,
    employee,
    leaveType,
    leaveYearStart: YEAR_START,
    previousRemaining: 12,
  });

check("AN EMPTY RULE APPLIES TO EVERYONE", () => {
  // The default that matters: every rule written before these fields existed has
  // empty lists and zero thresholds, so a company already running carry-forward
  // keeps exactly what it had.
  for (const rule of [{}, { appliesTo: {} }, { appliesTo: { employeeTypes: [], departments: [] } }]) {
    const result = eligible(rule, staff());
    assert.equal(result.eligible, true, JSON.stringify(rule));
    assert.equal(result.via, "policy");
  }
  // Including for an employee with almost nothing on file.
  assert.equal(eligible({}, { carryForwardMode: "default" }).eligible, true);
});

check("employment type narrows it", () => {
  const fullTimeOnly = { appliesTo: { employeeTypes: ["Full-Time"] } };
  assert.equal(eligible(fullTimeOnly, staff()).eligible, true);

  const partTimer = eligible(fullTimeOnly, staff({ employeType: "Part-Time" }));
  assert.equal(partTimer.eligible, false);
  assert.match(partTimer.reason, /applies to Full-Time staff/);
  assert.match(partTimer.reason, /Part-Time/);
});

check("a missing employment type does not sneak past a type rule", () => {
  const rule = { appliesTo: { employeeTypes: ["Full-Time"] } };
  const result = eligible(rule, staff({ employeType: undefined }));
  assert.equal(result.eligible, false);
  assert.match(result.reason, /not set/);
});

check("department narrows it", () => {
  const opsOnly = { appliesTo: { departments: [DEPT_OPS] } };
  assert.equal(eligible(opsOnly, staff()).eligible, true);
  assert.equal(eligible(opsOnly, staff({ department: DEPT_SITE })).eligible, false);
  // ObjectIds arrive as objects from Mongo and as strings from a form, so the
  // comparison has to survive both.
  assert.equal(
    eligible({ appliesTo: { departments: [{ toString: () => DEPT_OPS }] } }, staff())
      .eligible,
    true
  );
});

check("the conditions are AND, not OR", () => {
  const both = {
    appliesTo: { employeeTypes: ["Full-Time"], departments: [DEPT_OPS] },
  };
  assert.equal(eligible(both, staff()).eligible, true);
  // Right department, wrong type.
  assert.equal(eligible(both, staff({ employeType: "Part-Time" })).eligible, false);
  // Right type, wrong department.
  assert.equal(eligible(both, staff({ department: DEPT_SITE })).eligible, false);
});

check("MINIMUM SERVICE IS MEASURED AT THE START OF THE LEAVE YEAR", () => {
  // "Nobody carries during probation." Measured to the start of the year they
  // would be carrying into, which is when the carry actually happens.
  const rule = { minMonthsService: 12 };

  // Started 1 Apr 2025 → exactly 12 months by 1 Apr 2026.
  assert.equal(eligible(rule, staff({ joinDate: new Date(2025, 3, 1) })).eligible, true);

  // Started 2 Apr 2025 → a day short of 12 months.
  const short = eligible(rule, staff({ joinDate: new Date(2025, 3, 2) }));
  assert.equal(short.eligible, false);
  assert.match(short.reason, /needs 12 months/);
  assert.match(short.reason, /had 11/);

  // Started after the leave year began — negative service reads as zero.
  const future = eligible(rule, staff({ joinDate: new Date(2026, 8, 1) }));
  assert.equal(future.eligible, false);
  assert.match(future.reason, /had 0/);
});

check("a service rule with no start date on file refuses rather than guesses", () => {
  const result = eligible({ minMonthsService: 12 }, staff({ joinDate: null }));
  assert.equal(result.eligible, false);
  assert.match(result.reason, /no start date/);
});

check("minimum days remaining narrows it", () => {
  const rule = { minDaysRemaining: 5 };
  const plenty = carryForwardEligibility({
    rule,
    employee: staff(),
    leaveYearStart: YEAR_START,
    previousRemaining: 5,
  });
  assert.equal(plenty.eligible, true);

  const scraps = carryForwardEligibility({
    rule,
    employee: staff(),
    leaveYearStart: YEAR_START,
    previousRemaining: 2,
  });
  assert.equal(scraps.eligible, false);
  assert.match(scraps.reason, /at least 5 days left over/);
  assert.match(scraps.reason, /had 2/);
});

check("THE PER-EMPLOYEE OVERRIDE IS THREE-STATE", () => {
  // The decision that makes the two halves work together. A boolean cannot say
  // "follow the policy": defaulting true would make the rule unable to exclude
  // anybody, defaulting false would make the rule pointless. An ABSENT entry is
  // the third state, which is why only exceptions are stored.
  const excludesEveryone = {
    appliesTo: { employeeTypes: ["Nobody"] },
    minMonthsService: 999,
  };

  // No entry follows the rule, and the rule says no.
  assert.equal(eligible(excludesEveryone, staff()).eligible, false);

  // "always" overrides every condition.
  const forced = eligible(
    excludesEveryone,
    excepted("Annual Leave", "always")
  );
  assert.equal(forced.eligible, true);
  assert.equal(forced.via, "override-always");

  // "never" overrides a rule that would have included them.
  const blocked = eligible({}, excepted("Annual Leave", "never"));
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.via, "override-never");
});

check("AN EXCEPTION APPLIES TO ITS OWN LEAVE TYPE AND NO OTHER", () => {
  // The whole reason this is per type: "never carries annual leave" says nothing
  // about the company sick days, which may carry under a different limit.
  const employee = excepted("Annual Leave", "never");

  assert.equal(eligible({}, employee, "Annual Leave").eligible, false);
  assert.equal(eligible({}, employee, "Sick Leave").eligible, true);
  assert.equal(eligible({}, employee, "Sick Leave").via, "policy");
});

check("one employee can hold opposite exceptions on two types", () => {
  const employee = staff({
    carryForwardOverrides: [
      { leaveType: "Annual Leave", mode: "never" },
      { leaveType: "Sick Leave", mode: "always" },
    ],
  });
  const excludesEveryone = { appliesTo: { employeeTypes: ["Nobody"] } };

  assert.equal(eligible({}, employee, "Annual Leave").eligible, false);
  assert.equal(eligible(excludesEveryone, employee, "Sick Leave").eligible, true);
  // And a third type they have no exception for follows the rule.
  assert.equal(eligible({}, employee, "Study Leave").eligible, true);
  assert.equal(eligible(excludesEveryone, employee, "Study Leave").eligible, false);
});

check("the explanation names the leave type it is about", () => {
  const blocked = eligible({}, excepted("Annual Leave", "never"), "Annual Leave");
  assert.match(blocked.reason, /Annual Leave is set not to carry forward/);

  const forced = eligible({}, excepted("Sick Leave", "always"), "Sick Leave");
  assert.match(forced.reason, /always carry Sick Leave forward/);
});

check("a malformed override is ignored rather than trusted", () => {
  for (const overrides of [
    null,
    "always",
    [{ leaveType: "Annual Leave" }],
    [{ mode: "never" }],
    [{ leaveType: "Annual Leave", mode: "sometimes" }],
    [{ leaveType: "Other Leave", mode: "never" }],
  ]) {
    const result = eligible({}, staff({ carryForwardOverrides: overrides }));
    assert.equal(result.eligible, true, JSON.stringify(overrides));
    assert.equal(result.via, "policy", JSON.stringify(overrides));
  }
});

check("THE REMOVED SINGLE FIELD IS NOT READ", () => {
  // `carryForwardMode` covered every leave type at once and is gone from the
  // schema. A value still sitting in a document must be ignored rather than
  // quietly overriding every type — scripts/migrate-carry-forward-mode.mjs is
  // what moves one onto the per-type array.
  const stale = staff({ carryForwardOverrides: [], carryForwardMode: "never" });
  assert.equal(overrideFor(stale, "Annual Leave"), "default");
  assert.equal(overrideFor(stale, "Sick Leave"), "default");
  assert.equal(eligible({}, stale, "Sick Leave").eligible, true);
});

check("no override is 'default', and so is asking without a leave type", () => {
  for (const employee of [undefined, {}, staff()]) {
    assert.equal(overrideFor(employee, "Annual Leave"), "default");
  }
  // An exception is about one leave type, so a caller that does not name one has
  // not asked a question that can be answered.
  assert.equal(overrideFor(staff(), undefined), "default");
  assert.equal(
    overrideFor(excepted("Annual Leave", "never"), undefined),
    "default"
  );
});

check("ELIGIBILITY IS CHECKED THROUGH resolveCarryForward, NOT ALONGSIDE IT", () => {
  // The whole point of the single shared function: eligibility arrives at every
  // call site — the generator and all three previews — without any of them
  // having to remember to ask.
  const ineligible = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 10, appliesTo: { employeeTypes: ["Part-Time"] } },
    previousRemaining: 28,
    baseTotal: 34,
    leaveType: "Annual Leave",
    employee: staff(),
    leaveYearStart: YEAR_START,
  });
  assert.equal(ineligible.days, 0);
  assert.equal(ineligible.outcome, "not-eligible");
  assert.match(ineligible.explanation, /Part-Time/);

  const forced = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 10, appliesTo: { employeeTypes: ["Part-Time"] } },
    previousRemaining: 28,
    baseTotal: 34,
    leaveType: "Annual Leave",
    employee: excepted("Annual Leave", "always"),
    leaveYearStart: YEAR_START,
  });
  assert.equal(forced.days, 10);
  assert.equal(forced.via, "override-always");
});

check("'ALWAYS' DOES NOT INVENT A RULE THE COMPANY HAS NOT WRITTEN", () => {
  // It overrides who qualifies, not whether the mechanism exists. The rule is
  // what says how many days may carry — without one there is no amount, so
  // there is nothing for an override to override.
  const noSwitch = resolveCarryForward({
    enabled: false,
    rule: { allowed: true, maxDays: 10 },
    previousRemaining: 28,
    baseTotal: 34,
    leaveType: "Annual Leave",
    employee: excepted("Annual Leave", "always"),
    leaveYearStart: YEAR_START,
  });
  assert.equal(noSwitch.days, 0);
  assert.equal(noSwitch.outcome, "disabled");

  const noRule = resolveCarryForward({
    enabled: true,
    rule: { allowed: false, maxDays: 10 },
    previousRemaining: 28,
    baseTotal: 34,
    leaveType: "Annual Leave",
    employee: excepted("Annual Leave", "always"),
    leaveYearStart: YEAR_START,
  });
  assert.equal(noRule.days, 0);
  assert.equal(noRule.outcome, "no-rule");
});

check("omitting the employee skips eligibility rather than refusing", () => {
  // For a caller that has already decided who qualifies.
  const carried = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 10, appliesTo: { employeeTypes: ["Part-Time"] } },
    previousRemaining: 28,
    baseTotal: 34,
    leaveType: "Annual Leave",
  });
  assert.equal(carried.days, 10);
});

/* -------------------------------------------------------------------------- */
/* Pro-rating the cap                                                          */
/* -------------------------------------------------------------------------- */

check("WHAT proRated MEANS: THE CAP IS A NUMBER OF WEEKS, NOT OF DAYS", () => {
  // A cap of ten days is two weeks for somebody on a five-day week. Two weeks
  // for somebody on three days is six days — so left unscaled, a part-timer
  // carries proportionally MORE holiday than a full-timer under the same policy.
  assert.deepEqual(proRateCarryCap(10, 5), { days: 10, scaled: false });
  assert.deepEqual(proRateCarryCap(10, 3), { days: 6, scaled: true });
  assert.deepEqual(proRateCarryCap(10, 4), { days: 8, scaled: true });
  assert.deepEqual(proRateCarryCap(10, 1), { days: 2, scaled: true });
});

check("it scales up as well as down, because symmetry is the point", () => {
  // Two weeks for a six-day week is twelve days. Anything else makes "two weeks"
  // mean something different depending on who you are.
  assert.deepEqual(proRateCarryCap(10, 6), { days: 12, scaled: true });
});

check("no contracted week on file leaves the cap exactly as written", () => {
  for (const perWeek of [0, null, undefined, "", NaN, -2]) {
    assert.deepEqual(
      proRateCarryCap(10, perWeek),
      { days: 10, scaled: false },
      `for ${perWeek}`
    );
  }
});

check("THE SWITCH WAS READ BY NOTHING, AND NOW DECIDES THE CAP", () => {
  // `proRated` was on the schema, rendered as a switch and saved — and consulted
  // nowhere, so a company could turn it on and every part-timer kept the
  // full-time cap.
  const partTimer = staff({ employeType: "Part-Time", dayPerWeek: 3 });

  const unscaled = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 10, proRated: false },
    previousRemaining: 20,
    baseTotal: 17,
    leaveType: "Annual Leave",
    employee: partTimer,
    leaveYearStart: YEAR_START,
  });
  assert.equal(unscaled.days, 10, "off should mean the cap as written");

  const scaled = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 10, proRated: true },
    previousRemaining: 20,
    baseTotal: 17,
    leaveType: "Annual Leave",
    employee: partTimer,
    leaveYearStart: YEAR_START,
  });
  assert.equal(scaled.days, 6, "on should scale 10 days to a three-day week");
  assert.match(scaled.explanation, /pro-rated from 10 for a 3-day week/);
});

check("pro-rating does not touch a full-timer's cap", () => {
  const carried = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 10, proRated: true },
    previousRemaining: 20,
    baseTotal: 28,
    leaveType: "Annual Leave",
    employee: staff({ dayPerWeek: 5 }),
    leaveYearStart: YEAR_START,
  });
  assert.equal(carried.days, 10);
  assert.match(carried.explanation, /allows at most 10\./);
});

check("a cap that pro-rates to nothing says so rather than carrying nothing silently", () => {
  const carried = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 2, proRated: true },
    previousRemaining: 5,
    baseTotal: 6,
    leaveType: "Annual Leave",
    employee: staff({ dayPerWeek: 1 }),
    leaveYearStart: YEAR_START,
  });
  // 2 x 1/5 = 0.4 -> 0
  assert.equal(carried.days, 0);
  assert.match(carried.explanation, /comes to nothing/);
});

check("the pro-rated cap is still bounded by the leave type's ceiling", () => {
  // Both caps apply; the tighter one wins.
  const carried = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 40, proRated: true },
    previousRemaining: 40,
    baseTotal: 34,
    leaveType: "Annual Leave",
    employee: staff({ dayPerWeek: 6 }),
    leaveYearStart: YEAR_START,
  });
  // 40 x 6/5 = 48, but 34 + 48 would be 82 and the ceiling is 60.
  assert.equal(carried.days, 26);
  assert.equal(carried.outcome, "capped-by-ceiling");
});

/* -------------------------------------------------------------------------- */
/* Which bucket a booking came out of                                          */
/* -------------------------------------------------------------------------- */

const EXPIRY = new Date(2026, 6, 1); // 1 July 2026
const BEFORE = new Date(2026, 5, 1); // 1 June
const AFTER = new Date(2026, 7, 1); // 1 August

/** A row as the generator writes it: 34 for the year plus 10 carried. */
const row = (overrides = {}) => ({
  leaveType: "Annual Leave",
  type: "days",
  total: 44,
  used: 0,
  remaining: 44,
  carryForwarded: 10,
  baseTotal: 34,
  carryForwardExpiresAt: EXPIRY,
  ...overrides,
});

check("CARRIED DAYS ARE SPENT BEFORE THE YEAR'S OWN", () => {
  // There is one `remaining` number, so which bucket a booking came from has to
  // be decided by a rule. Spending the expiring ones first is what stops
  // somebody losing days they could have taken.
  const fresh = carriedState(row(), BEFORE);
  assert.equal(fresh.carriedUsed, 0);
  assert.equal(fresh.carriedRemaining, 10);

  const used4 = carriedState(row({ used: 4, remaining: 40 }), BEFORE);
  assert.equal(used4.carriedUsed, 4);
  assert.equal(used4.carriedRemaining, 6);

  const used12 = carriedState(row({ used: 12, remaining: 32 }), BEFORE);
  assert.equal(used12.carriedUsed, 10, "the carried bucket empties first");
  assert.equal(used12.carriedRemaining, 0);
});

check("before the expiry, the whole balance is bookable", () => {
  const state = carriedState(row(), BEFORE);
  assert.equal(state.hasExpired, false);
  assert.equal(state.lapsed, 0);
  assert.equal(state.usable, 44);
});

check("AFTER THE EXPIRY, UNUSED CARRIED DAYS ARE NOT BOOKABLE", () => {
  // The enforcement that was missing entirely: `expireAfterMonths` was required
  // by the settings form and read by nothing, so these ten days stayed spendable
  // for the rest of the year.
  const state = carriedState(row(), AFTER);
  assert.equal(state.hasExpired, true);
  assert.equal(state.lapsed, 10);
  assert.equal(state.usable, 34, "only the year's own entitlement is left");
});

check("carried days already taken do not lapse — they are gone", () => {
  // Four of the ten were used before the expiry, so six lapse and the balance
  // drops to the 34 of fresh entitlement.
  const state = carriedState(row({ used: 4, remaining: 40 }), AFTER);
  assert.equal(state.carriedUsed, 4);
  assert.equal(state.lapsed, 6);
  assert.equal(state.usable, 34);
});

check("all the carried days taken means nothing lapses", () => {
  const state = carriedState(row({ used: 10, remaining: 34 }), AFTER);
  assert.equal(state.lapsed, 0);
  assert.equal(state.usable, 34);
});

check("no expiry on the rule means carried days never lapse", () => {
  const state = carriedState(row({ carryForwardExpiresAt: null }), AFTER);
  assert.equal(state.hasExpired, false);
  assert.equal(state.lapsed, 0);
  assert.equal(state.usable, 44);
});

check("a row that never carried anything is unaffected", () => {
  const plain = { leaveType: "Annual Leave", total: 28, used: 3, remaining: 25 };
  const state = carriedState(plain, AFTER);
  assert.equal(state.carried, 0);
  assert.equal(state.lapsed, 0);
  assert.equal(state.usable, 25);
});

check("a lapse can never exceed what is left on the balance", () => {
  // Defensive: if `remaining` has drifted below the carried figure, the lapse
  // must not push it negative.
  const state = carriedState(row({ used: 0, remaining: 3 }), AFTER);
  assert.equal(state.lapsed, 3);
  assert.equal(state.usable, 0);
});

check("rubbish on the row reads as nothing rather than NaN", () => {
  for (const bad of [
    { carryForwarded: null },
    { carryForwarded: "abc" },
    { used: undefined },
    { remaining: null },
    { carryForwardExpiresAt: "not a date" },
  ]) {
    const state = carriedState(row(bad), AFTER);
    assert.ok(Number.isFinite(state.usable), JSON.stringify(bad));
    assert.ok(Number.isFinite(state.lapsed), JSON.stringify(bad));
  }
});

/* -------------------------------------------------------------------------- */
/* Writing the lapse down                                                      */
/* -------------------------------------------------------------------------- */

check("nothing to lapse means nothing to write", () => {
  assert.equal(applyCarryForwardLapse(row(), BEFORE), null);
  assert.equal(applyCarryForwardLapse(row({ used: 10, remaining: 34 }), AFTER), null);
  assert.equal(applyCarryForwardLapse({ total: 28, used: 0, remaining: 28 }, AFTER), null);
});

check("the lapse comes off both the total and the balance", () => {
  const lapse = applyCarryForwardLapse(row(), AFTER);
  assert.equal(lapse.lapsed, 10);
  assert.equal(lapse.total, 34);
  assert.equal(lapse.remaining, 34);
  // total - used === remaining still holds, which every other screen relies on.
  assert.equal(lapse.total - 0, lapse.remaining);
});

check("THE LAPSE IS IDEMPOTENT, SO A DOUBLE RUN COSTS NOTHING", () => {
  // `carryForwarded` drops to the carried days actually taken, so a second pass
  // sees nothing left to expire. A missed night or an accidental re-run is safe.
  const first = applyCarryForwardLapse(row({ used: 4, remaining: 40 }), AFTER);
  assert.equal(first.lapsed, 6);
  assert.equal(first.carryForwarded, 4, "only the taken days stay carried");

  const after = row({
    used: 4,
    total: first.total,
    remaining: first.remaining,
    carryForwarded: first.carryForwarded,
  });
  assert.equal(applyCarryForwardLapse(after, AFTER), null);
  assert.equal(carriedState(after, AFTER).lapsed, 0);
  assert.equal(carriedState(after, AFTER).usable, after.remaining);
});

check("the invariant survives a lapse on a partly-used balance", () => {
  const used = 4;
  const lapse = applyCarryForwardLapse(row({ used, remaining: 40 }), AFTER);
  assert.equal(lapse.total - used, lapse.remaining);
  assert.equal(lapse.total, 38); // 34 of the year's own + the 4 carried and taken
  assert.equal(lapse.remaining, 34);
});

/* -------------------------------------------------------------------------- */
/* Unpaid leave                                                                */
/* -------------------------------------------------------------------------- */

check("UNPAID LEAVE NEVER CARRIES, WHATEVER THE RULE SAYS", () => {
  // Its `remaining` is never decremented by the booking path — the allowance is
  // there to be recorded, not rationed — so a carry-forward rule on it would
  // roll the whole figure over every year and compound: 100, 200, 300.
  const carried = resolveCarryForward({
    enabled: true,
    rule: { allowed: true, maxDays: 50 },
    previousRemaining: 100,
    baseTotal: 100,
    leaveType: "Unpaid Leave",
  });
  assert.equal(carried.days, 0);
  assert.equal(carried.outcome, "never-carries");
  assert.match(carried.explanation, /not rationed/);
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
