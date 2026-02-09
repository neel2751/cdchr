import { getLeaveYearString } from "@/helper/getLeaveYearString";
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

async function isLeaveOverlappingold({
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

export async function validateOverlapold(entries, excludeId) {
  for (const entry of entries) {
    const overlap = await isLeaveOverlapping({
      ...entry,
      ...(excludeId ? { excludeId } : {}),
    });
    if (overlap) throw new Error("Overlapping dates found.");
  }
}

async function isLeaveOverlapping({
  employeeId,
  leaveDates, // <-- now array of dates
  leaveYear,
  excludeId = null,
}) {
  const filter = {
    employeeId: createObjectId(employeeId),
    leaveStatus: { $in: ["Pending", "Approved"] },
    leaveYear,
  };

  if (excludeId) {
    if (!isValidObjectId(excludeId)) return true;
    filter._id = { $ne: createObjectId(excludeId) };
  }

  try {
    // Fetch all existing leave requests for that year
    const existingLeaves = await LeaveRequestModel.find(filter);

    // Flatten existing leaveDates for quick lookup
    const existingDates = new Set(
      existingLeaves.flatMap((req) =>
        (req.leaveDates || []).map((d) =>
          new Date(d).toISOString().slice(0, 10)
        )
      )
    );

    // Check if any requested date already exists
    for (const d of leaveDates) {
      const dateStr = new Date(d).toISOString().slice(0, 10);
      if (existingDates.has(dateStr)) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return true; // fallback safe
  }
}

export async function validateOverlap(entries, excludeId) {
  for (const entry of entries) {
    const overlap = await isLeaveOverlapping({
      employeeId: entry.employeeId,
      leaveDates: entry.leaveDates, // <-- pass full array
      leaveYear: entry.leaveYear,
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

export function splitHalfDayLeaveIntoAnnualOrUnpaidOld({
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

export function splitHalfDayLeaveIntoAnnualOrUnpaid({
  halfDaysRequested,
  annualLeaveRemaining,
  dates, // array of selected dates, possibly duplicates if they picked AM/PM
}) {
  const result = [];
  let annualUsed = 0;
  let unpaidUsed = 0;

  // Each date = one half-day request
  dates.forEach((dateStr) => {
    const date = new Date(dateStr);

    if (annualLeaveRemaining >= 0.5) {
      annualUsed += 0.5;
      annualLeaveRemaining -= 0.5;
      result.push({ type: "Annual Leave", days: 0.5, date });
    } else {
      unpaidUsed += 0.5;
      result.push({ type: "Unpaid Leave", days: 0.5, date });
    }
  });

  return {
    breakdown: result, // [{type, days: 0.5, date}, ...]
    annualUsed,
    unpaidUsed,
  };
}

export function splitHalfDayLeaveWithYearRules({
  breakdown,
  employeeId,
  adminId,
}) {
  return breakdown.map(({ type, days, date }) => ({
    leaveYear: getLeaveYearString(date),
    leaveType: type,
    leaveDays: days, // always 0.5 here
    leaveStartDate: date,
    leaveEndDate: date,
    leaveDates: [date],
    employeeId,
    leaveStatus: adminId ? "Approved" : "Pending",
    adminId: adminId || null,
    isHalfDay: true,
  }));
}

export function splitHalfDayLeaveWithYearRulesOld({
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

export async function splitLeaveWithYearRulesByDates(
  leaveDates,
  currentYearRemaining,
  employeeId,
  selectedLeaveType,
  leaveStatus,
  adminId,
  nextYearRemaining = 28
) {
  const entries = [];

  // Case 1: Requested type is Annual Leave
  if (selectedLeaveType === "Annual Leave") {
    const annualPart = leaveDates.slice(0, currentYearRemaining);
    const unpaidPart = leaveDates.slice(currentYearRemaining);

    if (annualPart.length > 0) {
      entries.push({
        employeeId,
        leaveYear: getLeaveYearString(new Date(annualPart[0])),
        leaveType: "Annual Leave",
        leaveStatus,
        leaveStartDate: new Date(annualPart[0]),
        leaveEndDate: new Date(annualPart[annualPart.length - 1]),
        leaveDays: annualPart.length,
        leaveDates: annualPart,
        submittedBy: adminId ?? employeeId,
      });
    }

    if (unpaidPart.length > 0) {
      entries.push({
        employeeId,
        leaveYear: getLeaveYearString(new Date(unpaidPart[0])),
        leaveType: "Unpaid Leave",
        leaveStatus,
        leaveStartDate: new Date(unpaidPart[0]),
        leaveEndDate: new Date(unpaidPart[unpaidPart.length - 1]),
        leaveDays: unpaidPart.length,
        leaveDates: unpaidPart,
        submittedBy: adminId ?? employeeId,
      });
    }
  }

  // Case 2: Other leave types (e.g. Sick Leave, Study Leave)
  else {
    const availablePart = leaveDates.slice(0, currentYearRemaining);
    const unpaidPart = leaveDates.slice(currentYearRemaining);

    if (availablePart.length > 0) {
      entries.push({
        employeeId,
        leaveYear: getLeaveYearString(new Date(availablePart[0])),
        leaveType: selectedLeaveType,
        leaveStatus,
        leaveStartDate: new Date(availablePart[0]),
        leaveEndDate: new Date(availablePart[availablePart.length - 1]),
        leaveDays: availablePart.length,
        leaveDates: availablePart,
        submittedBy: adminId ?? employeeId,
      });
    }

    if (unpaidPart.length > 0) {
      entries.push({
        employeeId,
        leaveYear: getLeaveYearString(new Date(unpaidPart[0])),
        leaveType: "Unpaid Leave",
        leaveStatus,
        leaveStartDate: new Date(unpaidPart[0]),
        leaveEndDate: new Date(unpaidPart[unpaidPart.length - 1]),
        leaveDays: unpaidPart.length,
        leaveDates: unpaidPart,
        submittedBy: adminId ?? employeeId,
      });
    }
  }

  return entries;
}

export function generateLeaveDates(from, to, rules) {
  const dates = [];
  const current = new Date(from);

  while (current <= to) {
    const day = current.getUTCDay();
    if (day === 0) {
      // always skip Sunday
      current.setUTCDate(current.getUTCDate() + 1);
      continue;
    }
    if (day === 6 && !rules.includeSaturday) {
      // skip Saturday if needed
      current.setUTCDate(current.getUTCDate() + 1);
      continue;
    }
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

export function getDatesInRange(from, to) {
  const dates = [];
  let current = new Date(from);
  while (current <= to) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export async function updateLeaveBalance({
  employeeId,
  leaveYear,
  leaveType,
  leaveDays,
  session,
  allowNegative = false, // For unpaid/half-day we allow "unlimited"
}) {
  let leaveDoc = await CommonLeaveModel.findOne({
    employeeId: createObjectId(employeeId),
    leaveYear,
    "leaveData.leaveType": leaveType,
  }).session(session);

  if (leaveDoc) {
    const idx = leaveDoc.leaveData.findIndex((l) => l.leaveType === leaveType);

    if (idx !== -1) {
      // Check if annual leave has enough balance
      if (
        leaveType === "Annual Leave" &&
        leaveDoc.leaveData[idx].remaining < leaveDays
      ) {
        return false; // ❌ not enough annual balance
      }

      leaveDoc.leaveData[idx].used += leaveDays;
      // if (leaveType === "Annual Leave") {
      leaveDoc.leaveData[idx].remaining -= leaveDays;
      // }

      leaveDoc.markModified(`leaveData.${idx}`);
      await leaveDoc.save({ session });
      return true;
    }
  }

  // Create record if not exists or leaveType missing
  await CommonLeaveModel.updateOne(
    { employeeId: createObjectId(employeeId), leaveYear },
    {
      $push: {
        leaveData: {
          leaveType,
          used: leaveDays,
          remaining: leaveType === "Annual Leave" ? 0 : 0, // unlimited for Unpaid/Half Day
        },
      },
    },
    { upsert: true, session }
  );

  return leaveType !== "Annual Leave" || allowNegative;
}

export async function getRemainingBalance(
  employeeId,
  leaveYear,
  leaveType,
  session
) {
  const leaveDoc = await CommonLeaveModel.findOne({
    employeeId: createObjectId(employeeId),
    leaveYear,
    "leaveData.leaveType": leaveType,
  }).session(session);

  if (!leaveDoc) return 0;

  const leaveEntry = leaveDoc.leaveData.find((l) => l.leaveType === leaveType);
  return leaveEntry?.remaining || 0;
}

export function splitLeaveDatesByYear(dates, startMonth) {
  const map = {};

  for (const dateStr of dates) {
    const leaveYear = getLeaveYearString(new Date(dateStr), startMonth);

    if (!map[leaveYear]) {
      map[leaveYear] = [];
    }

    map[leaveYear].push(dateStr);
  }

  return map;
}

export async function validateOverlappingLeave(employeeId, leaveDates) {
  const overlapping = await LeaveRequestModel.findOne({
    employeeId,
    leaveStatus: { $in: ["Pending", "Approved"] },
    leaveDates: { $in: leaveDates },
  });

  if (overlapping) {
    return {
      success: false,
      message: "Some of the selected dates are already applied for leave.",
    };
  }

  return { success: true };
}

export async function validateOverlappingHalfDayLeave(
  employeeId,
  leaveDates,
  halfDayType
) {
  const overlapping = await LeaveRequestModel.find({
    employeeId,
    leaveStatus: { $in: ["Pending", "Approved"] },
    leaveDates: { $in: leaveDates },
    isDeleted: false,
  });

  for (const leave of overlapping) {
    if (!leave.isHalfDay) {
      return {
        success: false,
        message:
          "Some of the selected dates are already applied for full-day leave.",
      };
    }
    if (leave.halfDayType === halfDayType) {
      return {
        success: false,
        message: "Some of the selected half-day leaves are already applied.",
      };
    }
  }

  return { success: true };
}

export function calculateLeaveDays(leaveDates, rules) {
  let count = 0;
  for (const dateStr of leaveDates) {
    const date = new Date(dateStr);
    const day = date.getUTCDay();
    if (day === 0) {
      // always skip Sunday
      continue;
    }
    if (day === 6 && !rules.includeSaturday) {
      // skip Saturday if needed
      continue;
    }
    count++;
  }
  return count;
}
