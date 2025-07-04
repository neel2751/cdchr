import { getLeaveYearString } from "@/lib/getLeaveYear";
import { isValidObjectId, createObjectId } from "@/lib/mongodb";
import CommonLeaveModel from "@/models/commonLeaveModel";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { daysToWeeks, weeksToDays } from "date-fns";

export async function validateLeaveData({
  employeeId,
  leaveYear,
  leaveType,
  session,
  adminId = null,
}) {
  const commonLeave = await CommonLeaveModel.findOne({
    employeeId: createObjectId(employeeId),
    leaveYear,
  }).session(session);

  if (!commonLeave) throw new Error("Leave balance not found");

  const leaveData = commonLeave.leaveData.find(
    (l) => l.leaveType === leaveType
  );

  if (!adminId) {
    if (!leaveData || leaveData.isHide) {
      throw new Error(`${leaveType} 🤔. Please contact the HR`);
    }
  }

  return { commonLeave, leaveData };
}

async function isLeaveOverlapping({
  employeeId,
  leaveStartDate,
  leaveEndDate,
  leaveYear,
  excludeId = null,
}) {
  const filter = {
    employeeId: createObjectId(employeeId),
    leaveStatus: { $in: ["Pending", "Approved"] },
    leaveStartDate: { $lte: new Date(leaveEndDate) },
    leaveEndDate: { $gte: new Date(leaveStartDate) },
    leaveYear,
  };
  if (excludeId) {
    if (!isValidObjectId(excludeId)) return true;
    filter._id = { $ne: createObjectId(excludeId) };
  }
  try {
    const overLappingRequests = await LeaveRequestModel.find(filter);
    return overLappingRequests.length > 0;
  } catch (error) {
    return true;
  }
}

export async function validateOverlap(entries, excludeId) {
  for (const entry of entries) {
    const overlap = await isLeaveOverlapping({
      ...entry,
      ...(excludeId ? { excludeId } : {}),
    });
    if (overlap) throw new Error("Overlapping dates found.");
  }
}

export function updateLeaveUsage(leaveData, rollbackDays, newDays) {
  leaveData.used -= rollbackDays;
  leaveData.remaining += rollbackDays;

  if (leaveData.remaining < newDays) {
    throw new Error(
      `Insufficient balance: only ${leaveData.remaining} days left`
    );
  }

  leaveData.used += newDays;
  leaveData.remaining -= newDays;
}

export async function splitLeaveWithYearRules(
  leaveDays,
  currentYearRemaining,
  leaveStartDate,
  employeeId,
  selectedLeaveType, // e.g. "Annual Leave", "Sick Leave", etc.
  leaveStatus,
  adminId = null,
  nextYearRemaining = 28
) {
  const entries = [];
  let currentDate = new Date(leaveStartDate);

  const currentLeaveYear = getLeaveYearString(new Date());

  let remainingCurrent = currentYearRemaining;
  let remainingNext = nextYearRemaining;

  for (let i = 0; i < leaveDays; i++) {
    const leaveYear = getLeaveYearString(currentDate);

    let leaveType = "Unpaid Leave";

    // 📌 If leave is Annual — allow crossing into next year
    if (selectedLeaveType === "Annual Leave") {
      if (leaveYear === currentLeaveYear && remainingCurrent > 0) {
        leaveType = "Annual Leave";
        remainingCurrent--;
      } else if (leaveYear === currentLeaveYear && remainingCurrent === 0) {
        leaveType = "Unpaid Leave";
      } else if (leaveYear !== currentLeaveYear && remainingNext > 0) {
        leaveType = "Annual Leave";
        remainingNext--;
      } else if (leaveYear !== currentLeaveYear && remainingNext === 0) {
        leaveType = "Unpaid Leave";
      }
    }

    // ❌ Other types like Sick/Study — skip days if not in current leave year
    else if (leaveYear !== currentLeaveYear) {
      break;
    } else {
      if (remainingCurrent > 0) {
        leaveType = selectedLeaveType;
        remainingCurrent--;
      } else {
        leaveType = "Unpaid Leave";
      }
    }

    // 🧠 Grouping same leaveType + year
    const lastEntry = entries[entries.length - 1];
    if (
      lastEntry &&
      lastEntry.leaveType === leaveType &&
      lastEntry.leaveYear === leaveYear
    ) {
      lastEntry.leaveEndDate = new Date(currentDate);
      lastEntry.leaveDays += 1;
    } else {
      entries.push({
        employeeId,
        leaveYear,
        leaveType,
        leaveStatus,
        leaveStartDate: new Date(currentDate),
        leaveEndDate: new Date(currentDate),
        leaveDays: 1,
        submitedBy: adminId ? adminId : employeeId || employeeId,
      });
    }

    // 🔁 Move to next day (clear time edge cases)
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    currentDate.setUTCHours(0, 0, 0, 0);
  }

  return entries;
}

export function splitHalfDayLeaveIntoAnnualOrUnpaid({
  halfDaysRequested,
  annualLeaveRemaining,
}) {
  const fullDays = Math.floor(halfDaysRequested / 2);
  const hasExtraHalf = halfDaysRequested % 2 === 1;

  const result = [];

  let annualUsed = 0;
  let unpaidUsed = 0;

  // Handle full days
  for (let i = 0; i < fullDays; i++) {
    if (annualLeaveRemaining > 0) {
      annualUsed++;
      annualLeaveRemaining--;
      result.push({ type: "Half Day", days: 1 });
    } else {
      unpaidUsed++;
      result.push({ type: "Unpaid Leave", days: 1 });
    }
  }

  // Handle extra half-day if present
  if (hasExtraHalf) {
    if (annualLeaveRemaining >= 0.5) {
      annualUsed += 0.5;
      annualLeaveRemaining -= 0.5;
      result.push({ type: "Annual Leave", days: 0.5 });
    } else {
      unpaidUsed += 0.5;
      result.push({ type: "Unpaid Leave", days: 0.5 });
    }
  }

  return {
    breakdown: result, // e.g. [{type: 'Annual Leave', days: 1}, {type: 'Unpaid Leave', days: 0.5}]
    annualUsed,
    unpaidUsed,
  };
}

export function splitHalfDayLeaveWithYearRules({
  breakdown,
  startDate,
  employeeId,
  adminId,
}) {
  const entries = [];
  let currentDate = new Date(startDate);

  for (const item of breakdown) {
    const { type, days } = item;
    let remaining = days;

    while (remaining > 0) {
      const leaveYear = getLeaveYearString(currentDate);
      const leaveDays = Math.min(1, remaining); // Only 0.5 or 1 max
      entries.push({
        leaveYear,
        leaveType: type,
        leaveDays,
        leaveStartDate: new Date(currentDate),
        leaveEndDate: new Date(currentDate),
        employeeId,
        leaveStatus: adminId ? "Approved" : "Pending",
        adminId: adminId || null,
        isHalfDay: leaveDays === 0.5,
      });

      remaining -= leaveDays;

      // only increment day if leaveDays was a full day
      if (leaveDays === 1) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
  }

  return entries;
}

export async function checkEligibility(leaveData, countDays) {
  if (countDays > leaveData?.total)
    return { success: false, message: `${leaveData?.leaveType} days exceeded` };
  if (countDays > leaveData?.remaining)
    return {
      success: false,
      message: `under ${leaveData?.leaveType} ${leaveData?.remaining} days remaining`,
    };
  return { success: true, message: "Ok!" };
}

/**
 * Checks if there's enough leave balance before deduction
 * @param {number} remaining - Current balance
 * @param {number} rawDays - Number of leave days requested
 * @param {string} unit - Unit: "days", "weeks", "hours", "half-days"
 * @returns {{ success: boolean, required: number, remaining: number, message?: string }}
 */

export function hasSufficientLeaveBalance(
  available,
  requestedRaw,
  unit = "days",
  exact
) {
  let availableInDays;

  switch (unit) {
    case "weeks":
      availableInDays = weeksToDays(available); // Convert available weeks to days
      break;
    case "hours":
      availableInDays = available / 8; // 8 hours = 1 day
      break;
    case "half-days":
      availableInDays = available / 2; // 2 half-days = 1 day
      break;
    default:
      availableInDays = available; // already in days
  }

  const availableRounded = parseFloat(availableInDays.toFixed(2));
  const requestedRounded = parseFloat(requestedRaw.toFixed(2));
  console.log(availableRounded, requestedRounded);

  if (exact) {
    if (requestedRounded !== availableRounded) {
      return {
        success: false,
        message: `Exact leave match required. Requested: ${requestedRounded} day(s), Available: ${availableRounded} day(s) [Unit: ${unit}]`,
      };
    }
  } else {
    if (requestedRounded > availableRounded) {
      return {
        success: false,
        message: `Insufficient leave balance. Requested: ${requestedRounded} day(s), Available: ${availableRounded} day(s) [Unit: ${unit}]`,
      };
    }
  }

  return {
    success: true,
    required: requestedRounded,
    available: availableRounded,
  };
}

/**
 * Adjusts leave data item with unit-aware logic
 *
 * @param {Object} leaveDataItem - The specific leaveData object from CommonLeave
 * @param {Number} rawDays - The leave days to adjust (in days)
 * @param {String} unit - "days" | "weeks" | "hours" | "half-days"
 *
 * @returns {Array} - Array of modified fields to markModified
 */
export function adjustLeaveData(leaveDataItem, rawDays, unit = "days") {
  let adjustedDays = rawDays;
  if (unit === "weeks") {
    adjustedDays = daysToWeeks(rawDays); // Convert weeks to days
  } else if (unit === "hours") {
    adjustedDays = rawDays / 8; // Convert hours to days
  } else if (unit === "half-days") {
    adjustedDays = rawDays / 2; // Convert half-days to days
  } else {
    adjustedDays = rawDays; // Already in days
  }

  leaveDataItem.used += adjustedDays;
  leaveDataItem.remaining -= adjustedDays;
  leaveDataItem.isLock = unit !== "days"; // Lock only if not full-day leave

  return ["leaveData"]; // For nested arrays, better to mark the whole field
}
