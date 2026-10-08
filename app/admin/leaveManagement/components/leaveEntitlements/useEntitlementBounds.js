"use client";

import { hasStatutoryFloor, maxTotalFor } from "@/data/leaveTypes";
import { annualLeaveForYear, boundsForLeaveYear } from "@/lib/leaveEntitlement";
import { useLeaveYear } from "@/hooks/useLeaveYear";

/**
 * The range one entitlement may be set to, and what it means to leave it.
 *
 * Shared by the stepper and the save dialog so the two cannot disagree about
 * what is allowed — the stepper refusing to go somewhere the dialog would have
 * accepted, or worse the other way round.
 *
 * `statutory` is computed in the browser from the *same pure function the server
 * uses* (annualLeaveForYear), fed the same three facts off the employee record:
 * start date, contracted week, and leaving date. That is deliberate and it is
 * not duplication — it means the warning can appear as somebody steps across the
 * line rather than arriving as a surprise after they press Save. The server
 * still re-derives it and still refuses; this is the half that makes it humane.
 *
 * No `useMemo`: the work is two date subtractions and a table lookup, and the
 * React Compiler memoizes the result on its own. A hand-written dependency list
 * here could not be kept honest anyway — the compiler infers `employee.joinDate`
 * where the list would say `employee?.joinDate`, and it skips optimizing the
 * whole hook rather than trust the mismatch.
 *
 * @param {Object} input
 * @param {Object} input.entitlement one row of `leaveData`
 * @param {Object} input.employee the table row: joinDate, dayPerWeek, endDate
 * @param {string} input.leaveYear e.g. "2026-27"
 */
export function useEntitlementBounds({ entitlement, employee, leaveYear }) {
  const { startMonth } = useLeaveYear();

  // "weeks" only for maternity and paternity; the stored row says which.
  const unit = entitlement?.type === "weeks" ? "weeks" : "days";
  const used = Number(entitlement?.used) || 0;
  const current = Number(entitlement?.total) || 0;
  const max = maxTotalFor(entitlement?.leaveType, unit);

  // Never below what has already been taken — those are bookings that exist,
  // and the server refuses it too. Zero is otherwise a real value, meaning
  // "no allowance".
  const min = used;

  let statutory = null;
  if (
    hasStatutoryFloor(entitlement?.leaveType) &&
    employee?.joinDate &&
    employee?.dayPerWeek &&
    leaveYear
  ) {
    const { start, end } = boundsForLeaveYear(leaveYear, startMonth);
    statutory = annualLeaveForYear({
      joinDate: employee.joinDate,
      dayPerWeek: employee.dayPerWeek,
      leaveYearStart: start,
      leaveYearEnd: end,
      endDate: employee.endDate || null,
    });
  }

  return {
    unit,
    used,
    current,
    min,
    max,
    // null when there is no floor to derive — an ordinary leave type, or an
    // employee with no start date or contracted week on file. No floor is not a
    // floor of zero: there is simply nothing to measure against.
    statutory,
  };
}

/**
 * Whether a proposed figure goes under what the employee is owed.
 *
 * A plain function rather than something the hook returns: a closure handed back
 * out of a hook is memoization the React Compiler cannot verify, and it flags it.
 * Nothing is lost — the comparison is one line and the caller holds both halves.
 *
 * `null` means there is no floor to be under, which is not a floor of zero.
 */
export function isBelowStatutory(value, statutory) {
  if (statutory === null || statutory === undefined) return false;
  return Number(value) < statutory;
}

export default useEntitlementBounds;
