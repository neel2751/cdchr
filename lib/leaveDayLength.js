/**
 * Full days or half days, for a leave booking.
 *
 * A half day is not a leave type (see HALF_DAY_EXPLANATION in
 * data/leaveTypes.js): it is half a day of whichever type was booked. The forms
 * offer it as a choice beside the dates, and the server reads it back through
 * readDayLength() — the one place that decides what a submission meant.
 *
 * Plain module, not "use server": the forms import the options too.
 */

export const HALF_DAY_TYPES = ["First Half", "Second Half"];

/** The form's choice. "full" is the default; the half-day values are stored as-is. */
export const DAY_LENGTH_OPTIONS = [
  { label: "Full day", value: "full" },
  { label: "Morning (half day)", value: "First Half" },
  { label: "Afternoon (half day)", value: "Second Half" },
];

/** What a stored request shows as in the form when it is edited. */
export function dayLengthOf(request) {
  if (!request?.isHalfDay) return "full";
  return HALF_DAY_TYPES.includes(request.halfDayType) ? request.halfDayType : "First Half";
}

/** How many days a booking takes off the balance, for the form's own checks. */
export function daysCharged(dateCount, dayLength) {
  return HALF_DAY_TYPES.includes(dayLength) ? dateCount * 0.5 : dateCount;
}

/**
 * What a submission asked for: which leave type, and whether each date is a
 * full day or one half of it.
 *
 * Accepts the form's `dayLength`, an explicit `isHalfDay` + `halfDayType`, and
 * the old way of asking — a leave type named "Half Day", which the setup no
 * longer creates and which always meant half a day of annual leave.
 *
 * @returns {{ok: true, leaveType: string, isHalfDay: boolean, halfDayType: string|null}
 *   | {ok: false, message: string}}
 */
export function readDayLength(data = {}) {
  const legacy = data.leaveType === "Half Day";
  const leaveType = legacy ? "Annual Leave" : data.leaveType;

  // The form's own answer wins: "Full day" on an edited half-day request
  // turns it back into full days, whatever the request said before.
  const fromForm = data.dayLength !== undefined && data.dayLength !== null;
  const chosen =
    fromForm && !(legacy && HALF_DAY_TYPES.includes(data.halfDayType))
      ? data.dayLength
      : data.halfDayType;
  const isHalfDay =
    legacy || (fromForm ? data.dayLength !== "full" : data.isHalfDay === true);

  if (!isHalfDay) {
    return { ok: true, leaveType, isHalfDay: false, halfDayType: null };
  }
  if (!HALF_DAY_TYPES.includes(chosen)) {
    return { ok: false, message: "Choose morning or afternoon for a half day." };
  }
  return { ok: true, leaveType, isHalfDay: true, halfDayType: chosen };
}
