import { maxTotalFor } from "@/data/leaveTypes";

/**
 * How many unused days follow an employee into the next leave year.
 *
 * WHY THIS IS ONE FUNCTION NOW. The same decision was implemented four separate
 * times — once where it actually writes (generateLeaveForNewYear) and three times
 * in screens that claim to preview it — and they had drifted:
 *
 *   generateLeaveForNewYear      rule.allowed   ← the one that writes
 *   previewCarryForwardForCompany rule.enabled  ← a field that does not exist
 *   previewCarryForwardPerCompany rule.allowed
 *   previewCarryForward           rule.allowed
 *
 * `enabled` is not on the schema (models/leaveSettingModel.js calls it
 * `allowed`), so that preview reported "nothing will carry forward" for every
 * employee while the generator quietly carried days for all of them. An admin
 * could check the preview, see zeroes, roll the leave year over, and then find
 * somebody holding 44 days of annual leave with no explanation on screen — which
 * is exactly what happened.
 *
 * So the rule lives here, pure, and every caller asks this instead of
 * re-deriving it.
 */

/**
 * The contracted week a carry-forward cap is written for.
 *
 * `maxDays: 10` on a rule means "ten days, as for somebody on a normal week".
 * Five days is the standard UK full-time week and the figure every HR policy is
 * phrased against, so it is the reference the pro-rata scales from. Not a
 * setting: making it one would mean asking every company to answer a question
 * whose answer is five.
 */
const FULL_TIME_DAYS_PER_WEEK = 5;

/**
 * Scale a carry-forward cap to one employee's contracted week.
 *
 * WHAT `proRated` MEANS. A cap of ten days is two weeks of holiday for somebody
 * on a five-day week — and two weeks for somebody on three days is six days, not
 * ten. Left unscaled, a part-timer carries proportionally *more* holiday than a
 * full-timer under the same policy, which is the opposite of what a flat cap
 * looks like it is doing.
 *
 * It is the same arithmetic as the entitlement itself: 5.6 weeks × days per week
 * is how this app has always pro-rated annual leave, so the carry-forward cap
 * following the same rule is the consistent answer rather than a new idea.
 *
 * Scales UP as well as down, deliberately: two weeks for a six-day week is
 * twelve days. Symmetry is the point — "two weeks" has to mean two weeks for
 * everybody, or the setting is just a different kind of unfair.
 *
 * Off by default, because a company may genuinely mean "ten days, nobody gets
 * more, whatever their pattern" — which is why this is a switch and not simply
 * how the cap works.
 *
 * @param {number} maxDays the cap as written on the rule
 * @param {number} [dayPerWeek] the employee's contracted days
 * @returns {{days: number, scaled: boolean}}
 */
export function proRateCarryCap(maxDays, dayPerWeek) {
  const perWeek = Number(dayPerWeek) || 0;
  // No contracted week on file means nothing to scale by. Leaving the cap alone
  // is the safe reading: it is what the rule literally says.
  if (perWeek <= 0) return { days: maxDays, scaled: false };
  if (perWeek === FULL_TIME_DAYS_PER_WEEK) {
    return { days: maxDays, scaled: false };
  }
  return {
    days: Math.round((maxDays * perWeek) / FULL_TIME_DAYS_PER_WEEK),
    scaled: true,
  };
}

/** Whole months between two dates, rounded down. */
function monthsBetween(from, to) {
  if (!from || !to) return null;
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  // Not a whole month until the day of the month has come round.
  if (end.getDate() < start.getDate()) months -= 1;
  return months;
}

/**
 * This employee's exception for one leave type, or "default".
 *
 * Exceptions are stored per leave type, because the rules are: a company can
 * carry annual leave and company sick days under different limits, and "never
 * carries annual leave" says nothing about sick days.
 *
 * There is no leave-type-agnostic answer: an exception is about one type, so a
 * caller that does not name one gets "default". The single `carryForwardMode`
 * field this replaced is gone — scripts/migrate-carry-forward-mode.mjs moved any
 * value it held onto this array.
 *
 * @param {Object} [employee]
 * @param {string} [leaveType]
 * @returns {"default"|"always"|"never"}
 */
export function overrideFor(employee, leaveType) {
  if (!leaveType) return "default";

  const overrides = employee?.carryForwardOverrides;
  if (!Array.isArray(overrides)) return "default";

  const match = overrides.find((row) => row?.leaveType === leaveType);
  if (match?.mode === "always" || match?.mode === "never") return match.mode;

  return "default";
}

/**
 * Whether this employee qualifies for this leave type's carry-forward.
 *
 * A company letting some staff carry days and not others is the normal case, not
 * the exception — so eligibility is written as a *rule* (who, by default) with a
 * per-employee override for the exceptions. A flag per person alone would have to
 * be maintained for every new joiner forever and could not express a policy; a
 * rule alone cannot express "she negotiated it in her contract".
 *
 * THE OVERRIDE IS THREE-STATE. "default" has to be sayable, or the two halves
 * fight: a boolean defaulting to true makes the rule unable to exclude anybody,
 * and one defaulting to false makes the rule pointless.
 *
 * WHAT "always" DOES NOT DO. It overrides the eligibility conditions below and
 * nothing else. It does not invent a carry-forward rule where the company has
 * none — the rule is what says how many days may carry, and without one there is
 * no amount. Checked by resolveCarryForward() before this is consulted.
 *
 * EMPTY CONDITIONS MEAN EVERYONE. Every rule that existed before these fields
 * did has empty lists and zero thresholds, so nothing changes for an existing
 * company until somebody deliberately narrows a rule.
 *
 * @param {Object} input
 * @param {Object} [input.rule] the leave type's carry-forward rule
 * @param {Object} [input.employee] employeType, department, joinDate,
 *   carryForwardOverrides
 * @param {string} [input.leaveType] which type's exception to look for
 * @param {Date} [input.leaveYearStart] start of the year being carried INTO
 * @param {number} [input.previousRemaining] what is left to carry
 * @returns {{eligible: boolean, via: string, reason: string}}
 */
export function carryForwardEligibility({
  rule,
  employee,
  leaveType,
  leaveYearStart,
  previousRemaining,
} = {}) {
  const mode = overrideFor(employee, leaveType);
  const named = leaveType || "this leave type";

  if (mode === "never") {
    return {
      eligible: false,
      via: "override-never",
      reason: `${named} is set not to carry forward for this employee specifically.`,
    };
  }

  if (mode === "always") {
    return {
      eligible: true,
      via: "override-always",
      reason:
        `This employee is set to always carry ${named} forward, whatever the ` +
        "company rule says.",
    };
  }

  const appliesTo = rule?.appliesTo || {};

  const types = (appliesTo.employeeTypes || []).filter(Boolean);
  if (types.length && !types.includes(employee?.employeType)) {
    return {
      eligible: false,
      via: "policy",
      reason:
        `Carry-forward applies to ${types.join(" and ")} staff; this employee is ` +
        `${employee?.employeType || "not set"}.`,
    };
  }

  const departments = (appliesTo.departments || []).map(String).filter(Boolean);
  if (departments.length && !departments.includes(String(employee?.department))) {
    return {
      eligible: false,
      via: "policy",
      reason: "Carry-forward does not apply to this employee's department.",
    };
  }

  const minMonths = Math.max(Number(rule?.minMonthsService) || 0, 0);
  if (minMonths > 0) {
    const served = monthsBetween(employee?.joinDate, leaveYearStart);
    if (served === null) {
      return {
        eligible: false,
        via: "policy",
        reason:
          `Carry-forward needs ${minMonths} months' service and this employee ` +
          "has no start date on file.",
      };
    }
    if (served < minMonths) {
      return {
        eligible: false,
        via: "policy",
        reason:
          `Carry-forward needs ${minMonths} months' service; this employee had ` +
          `${Math.max(served, 0)} at the start of the leave year.`,
      };
    }
  }

  const minDays = Math.max(Number(rule?.minDaysRemaining) || 0, 0);
  if (minDays > 0) {
    const left = Math.max(Number(previousRemaining) || 0, 0);
    if (left < minDays) {
      return {
        eligible: false,
        via: "policy",
        reason:
          `Carry-forward needs at least ${minDays} days left over; this ` +
          `employee had ${left}.`,
      };
    }
  }

  return {
    eligible: true,
    via: "policy",
    reason: "This employee qualifies under the company's carry-forward rule.",
  };
}

/**
 * @typedef {Object} CarryForwardOutcome
 * @property {number} days whole days that carry into the new year
 * @property {number} lost days that do not, because the rule caps them
 * @property {"disabled"|"never-carries"|"no-rule"|"nothing-left"|"not-eligible"|"capped-by-rule"|"capped-by-ceiling"|"full"} outcome
 * @property {"policy"|"override-always"|"override-never"} via what decided it
 * @property {string} explanation one sentence, for a screen to show as-is
 */

/**
 * Work out one leave type's carry-forward for one employee.
 *
 * WHOLE DAYS ONLY. A balance can hold a half day — the app books them — but a
 * carry-forward policy is written in whole days, and a fractional `total` would
 * make the row impossible to edit afterwards: editCommonLeave accepts integers,
 * so a stored 36.5 is refused on every subsequent save. The half day is left
 * behind rather than silently rounded up into entitlement the employee had not
 * accrued.
 *
 * CAPPED BY THE TYPE'S CEILING, TOO. Nothing used to stop 34 days of fresh
 * annual leave plus 30 carried from landing as a total of 64 — above the 60 that
 * data/leaveTypes.js allows anybody to set by hand, which would leave the row
 * permanently uneditable for the same reason Unpaid Leave used to be.
 *
 * @param {Object} input
 * @param {boolean} input.enabled the company-wide switch
 * @param {Object} [input.rule] this type's rule, including who it applies to
 * @param {number} input.previousRemaining what was left at the end of last year
 * @param {number} input.baseTotal the new year's entitlement before carrying
 * @param {string} input.leaveType
 * @param {string} [input.unit] "days" or "weeks", from the stored row
 * @param {Object} [input.employee] employeType, department, joinDate, dayPerWeek,
 *   carryForwardOverrides — who is being asked about. Omitted means "do not
 *   check eligibility", which is only right for a caller that has already
 *   checked it.
 * @param {Date} [input.leaveYearStart] start of the year being carried into,
 *   for the service-length condition
 * @returns {CarryForwardOutcome}
 */
export function resolveCarryForward({
  enabled,
  rule,
  previousRemaining,
  baseTotal,
  leaveType,
  unit = "days",
  employee,
  leaveYearStart,
}) {
  const left = Math.max(Number(previousRemaining) || 0, 0);
  const base = Math.max(Number(baseTotal) || 0, 0);

  // `via` on every return, so a caller can always say *what decided this* —
  // the company rule, or this employee's own override.
  let via = "policy";
  const none = (outcome, explanation) => ({
    days: 0,
    lost: left,
    outcome,
    via,
    explanation,
  });

  if (!enabled) {
    return none("disabled", "Carry-forward is switched off for the company.");
  }
  if (NEVER_CARRIES.has(leaveType)) {
    return none(
      "never-carries",
      `${leaveType} is not rationed, so there is no unused balance to carry.`
    );
  }
  if (!rule || rule.allowed !== true) {
    return none(
      "no-rule",
      `${leaveType} is not set to carry forward, so unused days do not roll over.`
    );
  }
  if (left <= 0) {
    return none("nothing-left", "Nothing was left unused, so nothing carries.");
  }

  const maxDays = Math.max(Number(rule.maxDays) || 0, 0);
  if (maxDays <= 0) {
    return none(
      "no-rule",
      `${leaveType} carries forward, but the limit is set to zero days.`
    );
  }

  // WHO, now that we know there is something to carry and a limit to carry it
  // by. Deliberately after the checks above: "always carry" is an override of
  // the eligibility conditions, not a way to conjure a rule the company has not
  // written — without a rule there is no number of days to carry.
  //
  // Skipped entirely when no employee was supplied, which keeps the function
  // usable by a caller that has already decided eligibility itself.
  if (employee) {
    const eligibility = carryForwardEligibility({
      rule,
      employee,
      leaveType,
      leaveYearStart,
      previousRemaining: left,
    });
    via = eligibility.via;
    if (!eligibility.eligible) {
      return {
        days: 0,
        lost: left,
        outcome: "not-eligible",
        via,
        explanation: eligibility.reason,
      };
    }
  }

  // The cap, scaled to this employee's week when the rule says to pro-rate.
  //
  // `proRated` was on the schema, rendered as a switch and saved — and read by
  // nothing at all, so a company could turn it on and every part-timer kept the
  // full-time cap. This is the half that was missing.
  const capped = rule.proRated
    ? proRateCarryCap(maxDays, employee?.dayPerWeek)
    : { days: maxDays, scaled: false };

  if (capped.days <= 0) {
    return none(
      "capped-by-rule",
      `Pro-rated against a ${employee?.dayPerWeek}-day week, the ${maxDays}-day ` +
        `carry-forward limit for ${leaveType} comes to nothing.`
    );
  }

  // Whole days, and never more than the rule allows.
  const wanted = Math.floor(Math.min(left, capped.days));

  // Never past the point where the resulting total could not be edited again.
  const ceiling = maxTotalFor(leaveType, unit);
  const headroom = Math.max(ceiling - base, 0);
  const days = Math.min(wanted, headroom);

  if (days <= 0) {
    return none(
      "capped-by-ceiling",
      `${base} ${unit} already reaches the ${ceiling} ${unit} limit for ` +
        `${leaveType}, so nothing more can be carried.`
    );
  }

  let outcome = "full";
  if (days < wanted) outcome = "capped-by-ceiling";
  else if (left > capped.days) outcome = "capped-by-rule";
  else if (days < left) outcome = "capped-by-rule"; // a part day left behind

  const explanation =
    outcome === "full"
      ? `All ${days} unused ${unit} carry forward.`
      : outcome === "capped-by-ceiling"
        ? `${days} of ${Math.floor(left)} unused ${unit} carry forward — the rest ` +
          `would take ${leaveType} past its ${ceiling} ${unit} limit.`
        : `${days} of ${Math.floor(left)} unused ${unit} carry forward — the rule ` +
          `allows at most ${capped.days}` +
          (capped.scaled
            ? `, pro-rated from ${maxDays} for a ${employee?.dayPerWeek}-day week.`
            : ".");

  return { days, lost: Math.max(left - days, 0), outcome, via, explanation };
}

/**
 * Leave types that never carry forward, whatever the rules say.
 *
 * Unpaid Leave has no balance in the ordinary sense: the booking path increments
 * `used` on it and deliberately does NOT decrement `remaining`, because the
 * allowance exists to be recorded rather than rationed. So its `remaining`
 * never falls, and a carry-forward rule on it would roll the full allowance over
 * every single year and compound — 100, then 200, then 300 — for an allowance
 * that was never a limit in the first place.
 */
const NEVER_CARRIES = new Set(["Unpaid Leave"]);

/**
 * How much of a carried-over balance is left, and whether it has lapsed.
 *
 * CARRIED DAYS ARE SPENT FIRST. There is one `remaining` number on the row, so
 * which bucket a booking came out of has to be decided by a rule rather than
 * read back. Spending the carried days first is both the convention and the only
 * humane reading: they are the ones with an expiry on them, so using them before
 * the fresh allowance is what stops somebody losing days they could have taken.
 *
 * That makes the split derivable rather than stored, which matters — a second
 * counter kept alongside `used` would be one more thing to drift.
 *
 * @param {Object} entitlement one row of `leaveData`
 * @param {Date} [on] the moment to judge expiry at; defaults to now
 * @returns {{
 *   carried: number, carriedUsed: number, carriedRemaining: number,
 *   expiresAt: Date|null, hasExpired: boolean, lapsed: number,
 *   usable: number,
 * }}
 */
export function carriedState(entitlement, on = new Date()) {
  const carried = Math.max(Number(entitlement?.carryForwarded) || 0, 0);
  const used = Math.max(Number(entitlement?.used) || 0, 0);
  const remaining = Math.max(Number(entitlement?.remaining) || 0, 0);

  // Carried first, so what has been spent eats into the carried bucket before
  // it touches the year's own entitlement.
  const carriedUsed = Math.min(used, carried);
  const carriedRemaining = Math.max(carried - carriedUsed, 0);

  const raw = entitlement?.carryForwardExpiresAt;
  const expiresAt = raw ? new Date(raw) : null;
  const valid = expiresAt && !Number.isNaN(expiresAt.getTime());
  const hasExpired = Boolean(valid && on > expiresAt);

  // What is actually bookable: the balance, less any carried days that have
  // passed their expiry without being taken.
  const lapsed = hasExpired ? Math.min(carriedRemaining, remaining) : 0;

  return {
    carried,
    carriedUsed,
    carriedRemaining,
    expiresAt: valid ? expiresAt : null,
    hasExpired,
    lapsed,
    usable: Math.max(remaining - lapsed, 0),
  };
}

/**
 * How a lapse is written onto the row.
 *
 * Returned as plain numbers rather than applied, so the booking path can respect
 * a lapse without writing, and the job that materialises it writes exactly what
 * the booking path was already enforcing.
 *
 * IDEMPOTENT BY CONSTRUCTION. `carryForwarded` is reduced to the number of
 * carried days that were actually taken, so a second run sees
 * `carriedRemaining: 0` and finds nothing to lapse. That also keeps the row
 * honest: `total - used === remaining` still holds afterwards, and
 * `carryForwarded` still answers "how many of the days they took came from
 * carry-over".
 *
 * @param {Object} entitlement
 * @param {Date} [on]
 * @returns {{lapsed: number, total: number, remaining: number, carryForwarded: number}|null}
 *   null when there is nothing to do.
 */
export function applyCarryForwardLapse(entitlement, on = new Date()) {
  const state = carriedState(entitlement, on);
  if (state.lapsed <= 0) return null;

  const total = Math.max(Number(entitlement?.total) || 0, 0);
  const remaining = Math.max(Number(entitlement?.remaining) || 0, 0);

  return {
    lapsed: state.lapsed,
    total: Math.max(total - state.lapsed, 0),
    remaining: Math.max(remaining - state.lapsed, 0),
    // Only the carried days that were spent stay on the record as carried.
    carryForwarded: state.carriedUsed,
  };
}

/**
 * When carried days stop being usable, if the rule says they should.
 *
 * `expireAfterMonths` is required by the settings form and, until this was
 * written, read by nothing at all: a company could set "carried days expire
 * after three months" and they would last the whole year.
 *
 * This records the date on the entitlement so it is at least stored, shown, and
 * reportable. NOTE it is not yet deducted automatically when it passes — the
 * booking path does not consult it. That is a deliberately separate change; what
 * matters here is that the setting stops being silently discarded.
 *
 * @param {{expireAfterMonths?: number}} [rule]
 * @param {Date} leaveYearStart when the new leave year begins
 * @returns {Date|null}
 */
export function carryForwardExpiry(rule, leaveYearStart) {
  const months = Number(rule?.expireAfterMonths) || 0;
  if (months <= 0 || !leaveYearStart) return null;
  const expiry = new Date(leaveYearStart);
  expiry.setMonth(expiry.getMonth() + months);
  return expiry;
}
