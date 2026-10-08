/**
 * The leave types a new company is offered when it sets leave up.
 *
 * A company that has just registered has no LeaveCategory rows at all, and
 * without them the leave module is a set of empty screens: the entitlement
 * generator falls back to a hard-coded safety net inside
 * server/leaveServer/countLeaveServer.js, so employees get numbers, but nothing
 * is listed on the Category screen, nothing can be edited, and
 * `addOneCommonLeaveToOneEmployee` refuses every request with "Leave Category
 * not find on admin category". The types existed in code and not in the company.
 *
 * This is the list that fixes that, and it is a *starting point* rather than a
 * policy: everything here can be edited or removed afterwards on the Category
 * screen, and a company can add its own.
 *
 * FIELDS
 *   key        stable identifier, used by the setup screen. Not stored.
 *   leaveType  the name stored on LeaveCategory and on every entitlement row.
 *              Changing one of these strings orphans existing data — the leave
 *              types on an employee's record are matched to categories by name,
 *              not by id — so they are fixed.
 *   required   the module does not work without it, so the setup screen offers
 *              it ticked and does not let it be unticked. See below.
 *   total      starting days. Ignored for the four `computed` types, whose
 *              figures come from the employee's own contract or from statute.
 *   computed   the entitlement is worked out per employee rather than being a
 *              flat number: annual leave from the contracted week and the join
 *              date, the other three from statutory minimums.
 *   isPaid     whether time off under it is paid.
 *   isHidden   kept off the employee's own summary until it applies to them —
 *              maternity and paternity are not something to show everybody a
 *              running balance of.
 *   note       what the company sees next to it, and what is stored on the
 *              category so the reasoning survives.
 *   unit       what `total` counts. Only maternity and paternity are stored in
 *              weeks; everything else is days. See generateDefaultLeaves().
 *   maxTotal   the largest allowance an admin may set for this type by hand.
 *              See MAX_TOTAL_BY_UNIT below for why most of these are a whole
 *              leave year and annual leave is not.
 */

export const LEAVE_TYPE_CATALOGUE = [
  {
    key: "annual",
    leaveType: "Annual Leave",
    required: true,
    computed: true,
    total: 0,
    unit: "days",
    // Its floor is not a number, it is a calculation — see hasStatutoryFloor().
    statutoryFloor: true,
    // Statutory is 28 days on a five-day week and 34 on a six-day one.
    // Add bank holidays on top and a carry-forward allowance and the most
    // generous real figure is around 52, so 60 permits everything genuine and
    // still catches the typo this cap exists for — a stray digit turning 28
    // into 280.
    maxTotal: 60,
    isPaid: true,
    isHidden: false,
    label: "Annual leave",
    note:
      "Worked out per employee: 5.6 weeks × their contracted days a week, " +
      "pro-rated by days if they joined part way through the leave year.",
  },
  {
    key: "sick",
    leaveType: "Sick Leave",
    required: true,
    computed: true,
    total: 7,
    unit: "days",
    // Company sick pay, on top of the 28 weeks of SSP tracked separately.
    // Some employers give six months, so this is not a number to pin down.
    maxTotal: 366,
    isPaid: true,
    isHidden: false,
    label: "Sick leave",
    note: "Seven company sick days, plus the 28 weeks of Statutory Sick Pay.",
  },
  {
    key: "unpaid",
    leaveType: "Unpaid Leave",
    required: true,
    computed: false,
    total: 100,
    unit: "days",
    // Deliberately unrationed — see the note above. Bounded only by the
    // length of a leave year.
    maxTotal: 366,
    isPaid: false,
    isHidden: false,
    label: "Unpaid leave",
    note:
      "Time off with no pay. The allowance is deliberately high — it is there " +
      "to be recorded, not rationed.",
  },
  {
    key: "maternity",
    leaveType: "Maternity Leave",
    required: true,
    computed: true,
    total: 52,
    unit: "weeks",
    // 52 weeks is the statutory maximum, and a leave year is 52 weeks.
    maxTotal: 52,
    isPaid: true,
    isHidden: true,
    label: "Maternity leave",
    note: "52 weeks, of which 39 are paid. A statutory right, so it is always available.",
  },
  {
    key: "paternity",
    leaveType: "Paternity Leave",
    required: true,
    computed: true,
    total: 2,
    unit: "weeks",
    // Statutory is two weeks; enhanced schemes vary widely, so the ceiling
    // is the leave year rather than a policy.
    maxTotal: 52,
    isPaid: true,
    isHidden: true,
    label: "Paternity leave",
    note: "Two paid weeks. A statutory right, so it is always available.",
  },
  {
    key: "bereavement",
    leaveType: "Bereavement Leave",
    required: false,
    computed: false,
    total: 5,
    unit: "days",
    maxTotal: 366,
    isPaid: true,
    isHidden: false,
    label: "Bereavement leave",
    note: "Paid time off after a death. Five days is the common starting point.",
  },
  {
    key: "compassionate",
    leaveType: "Compassionate Leave",
    required: false,
    computed: false,
    total: 3,
    unit: "days",
    maxTotal: 366,
    isPaid: true,
    isHidden: false,
    label: "Compassionate leave",
    note: "For a family emergency that is not a bereavement.",
  },
  {
    key: "parental",
    leaveType: "Parental Leave",
    required: false,
    computed: false,
    total: 18,
    unit: "days",
    maxTotal: 366,
    isPaid: false,
    isHidden: false,
    label: "Unpaid parental leave",
    note: "Up to 18 weeks per child, unpaid. A statutory right you may want recorded.",
  },
  {
    key: "adoption",
    leaveType: "Adoption Leave",
    required: false,
    computed: false,
    total: 52,
    unit: "days",
    maxTotal: 366,
    isPaid: true,
    isHidden: true,
    label: "Adoption leave",
    note: "Mirrors maternity leave: 52 weeks, 39 of them paid.",
  },
  {
    key: "jury",
    leaveType: "Jury Service",
    required: false,
    computed: false,
    total: 10,
    unit: "days",
    // Jury service can run for months and is not the employer's choice.
    maxTotal: 366,
    isPaid: true,
    isHidden: false,
    label: "Jury service",
    note: "Time off for jury duty, kept separate so it does not eat annual leave.",
  },
  {
    key: "study",
    leaveType: "Study Leave",
    required: false,
    computed: false,
    total: 5,
    unit: "days",
    maxTotal: 366,
    isPaid: true,
    isHidden: false,
    label: "Study leave",
    note: "Paid time off for training, exams or professional qualifications.",
  },
];

/** The ones the setup screen ticks and will not let you untick. */
export const REQUIRED_LEAVE_KEYS = LEAVE_TYPE_CATALOGUE.filter(
  (type) => type.required
).map((type) => type.key);

/** Look one up by the key the setup screen sends back. */
export function leaveTypeByKey(key) {
  return LEAVE_TYPE_CATALOGUE.find((type) => type.key === key) || null;
}

/** Look one up by the name stored on the category and on every entitlement. */
export function leaveTypeByName(leaveType) {
  return (
    LEAVE_TYPE_CATALOGUE.find((type) => type.leaveType === leaveType) || null
  );
}

/**
 * The ceiling for a leave type this catalogue has never heard of.
 *
 * A company can create its own types, so there always has to be a fallback, and
 * the only limit that holds for every one of them is the length of the period
 * being allocated: you cannot be given more than a leave year of time off inside
 * a leave year. 366 covers a leap one.
 *
 * This is the reason the per-type numbers above mostly say 366 rather than
 * something tighter. A cap is worth having where the real range is well known
 * and a typo would quietly grant holiday — annual leave, and only annual leave.
 * Everywhere else a tight cap is an invented policy that blocks a legitimate
 * figure: `editCommonLeave` used to refuse anything over 40, which meant Unpaid
 * Leave could never be edited at all (it starts at 100), a company sick-pay
 * scheme of six months was impossible, and maternity leave — 52 weeks by law —
 * was 12 over the limit.
 */
export const MAX_TOTAL_BY_UNIT = {
  days: 366,
  weeks: 52,
};

/**
 * The largest allowance somebody may set by hand for one leave type.
 *
 * `unit` comes from the stored entitlement row (`leaveData[].type`), because that
 * is what the number on it actually counts — only maternity and paternity are
 * kept in weeks. It is passed in rather than read from the catalogue so a type
 * the catalogue does not know still gets the right ceiling.
 *
 * @param {string} leaveType e.g. "Annual Leave"
 * @param {string} [unit] "days" or "weeks", from the entitlement row
 * @returns {number} whole units
 */
export function maxTotalFor(leaveType, unit = "days") {
  const known = leaveTypeByName(leaveType);
  if (known?.maxTotal) return known.maxTotal;
  return MAX_TOTAL_BY_UNIT[unit] ?? MAX_TOTAL_BY_UNIT.days;
}

/**
 * Whether this leave type has a floor the law sets, rather than one we invent.
 *
 * Only annual leave does, and the point of saying so here is that its floor
 * cannot be written down as a number. 5.6 weeks × the contracted week, pro-rated
 * by the days actually employed, is a different figure for every employee and
 * every leave year — and it is legitimately **zero** for somebody who has not
 * started yet, and one day for somebody who joined on the last day of the year.
 * A constant `minTotal: 1` would be wrong in both directions: it would block the
 * value the entitlement generator itself produces for a future starter, while
 * happily allowing 1 day for a full-time employee who is owed 28.
 *
 * So the floor is computed per employee at the moment of the edit, from
 * annualLeaveForYear() in lib/leaveEntitlement.js — the same function that
 * produced the figure in the first place. Going below it is allowed, because
 * there are real reasons to (a leaver's accrual, correcting an over-grant), but
 * it needs saying out loud: see the confirmation flow in editCommonLeave.
 *
 * Every other type is a company allowance, not a right, so zero is an ordinary
 * thing to set and needs no ceremony.
 */
export function hasStatutoryFloor(leaveType) {
  return leaveTypeByName(leaveType)?.statutoryFloor === true;
}

/**
 * Half days are not on this list, on purpose.
 *
 * A half day is not a kind of leave, it is half a day of some other kind —
 * LeaveRequest carries `isHalfDay` and `halfDayType` alongside whichever leave
 * type was booked (models/leaveRequestModel.js). Adding a "Half Day" category
 * would give it an allowance of its own, and a morning off would then be
 * deducted from that instead of from annual leave, which is the opposite of what
 * anybody wants. The setup screen says so, because it is a reasonable thing to
 * go looking for.
 */
export const HALF_DAY_EXPLANATION =
  "Half days are not a leave type. Any leave can be booked as a half day — " +
  "the request carries it, and half a day is deducted from that type's balance.";

/** The leave year start months, for the setup screen. */
export const LEAVE_YEAR_MONTHS = [
  { value: 1, label: "January", hint: "Calendar year" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April", hint: "UK tax year — most common" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];
