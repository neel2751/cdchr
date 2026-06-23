"use server";
// import { getLeaveYearString } from "@/lib/getLeaveYear";
import { differenceInCalendarMonths, isBefore } from "date-fns";
import { getServerSideProps } from "../session/session";
import CommonLeaveModel from "@/models/commonLeaveModel";
import { connect } from "@/db/db";
import LeaveCategoryModel from "@/models/leaveCategoryModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { getCommonSpecificLeave } from "./getLeaveServer";
import { getLeaveSettings } from "../leaveSettingServer";
import {
  getLeaveYearString,
  getPreviousLeaveYearString,
} from "@/helper/getLeaveYearString";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";

/**
 * @typedef {Object} LeaveOptions
 * @property {string} leaveType - The category of leave (e.g., Annual, Sick).
 * @property {number} total - Total number of leave days allocated.
 * @property {number} used - Number of leave days used.
 * @property {number} remaining - Number of leave days remaining.
 * @property {string} type - Type of leave (e.g., Paid, Unpaid).
 * @property {string|null} [extraType=null] - Optional secondary classification.
 * @property {boolean} [isHide=false] - Flag to hide this leave type.
 * @property {boolean} [isLock=false] - Flag to lock this leave type from edits.
 */

class Leave {
  /**
   * Creates an immutable Leave instance
   * @param {LeaveOptions} options - Configuration object for leave
   */
  constructor({
    leaveType,
    total,
    used,
    remaining,
    type,
    SSP = null,
    extraType = null,
    isHide = false,
    isLock = false,
    paid = null,
    isPaid = true,
  }) {
    // Input validation
    if (used + remaining > total) {
      throw new Error("Used + Remaining days cannot exceed Total days.");
    }
    if (SSP && extraType === null) {
      throw new Error("Extra Type is required if you pass SSP");
    }
    if (
      (leaveType === "Maternity Leave" || leaveType === "Paternity Leave") &&
      paid === null
    ) {
      throw new Error("Add the paid value");
    }

    this.leaveType = leaveType;
    this.total = total;
    this.used = used;
    this.remaining = remaining;
    this.type = type;
    this.SSP = SSP;
    this.extraType = extraType;
    this.paid = paid;
    this.isPaid = isPaid;
    this.isHide = isHide;
    this.isLock = isLock;

    // Make the instance immutable
    Object.freeze(this);
  }
}

/*
#Points

1: Uk Statutory Leave = 5.6 Weeks x days per week.
2: Leave Year = April to March (not calendar year).
3: Round to the nearest whole number.
4: Only prorate if the employee joined during the current leave year.
5: Days per week can be: full-time (5 or 6) or part-time(e.g:3).
6: if they joined before of the current leave year -> grant full leave.


#Example

1: 6 days/week, started in April --> 5.6 * 6 = 33.6 --> 34 days
2: 5 days/week, started in April --> 5.6 * 5 = 28 days
3: 3 days/week (part-time), started in April = 5.6 * 3 = 16.8 --> 17 days
3: 6 days/week, joined in July --> 5.6 * 6 / 12 * 9 = 25.2 --> 25 days
4: 5 days/week, joined in July --> 5.6 * 5 / 12 * 9 = 20.9 --> 21 days
5: 3 days/week, joined in july --> 5.6 * 3 / 12 * 9 = 12.6 --> 13 days

*/
/**
 * @param {string}
 * @param {number}
 * @returns {object}
 */

async function countAnnualLeave(joinDateStr, dayPerWeek) {
  if (!joinDateStr || dayPerWeek <= 0) return 0;

  const settings = await getLeaveSettings(); // later pass companyId
  const startMonth = settings?.data?.leaveYearStartMonth || 4; // 1-12

  const now = new Date();
  const joinDate = new Date(joinDateStr);

  // calculate leave year start and end dynamically
  const currentMonth = now.getMonth() + 1; // getMonth is zero-based
  let startYear;
  if (currentMonth >= startMonth) {
    startYear = now.getFullYear();
  } else {
    startYear = now.getFullYear() - 1;
  }

  const leaveYearStart = new Date(startYear, startMonth - 1, 1);
  const leaveYearEnd = new Date(startYear + 1, startMonth - 1, 0);
  // last day before next leave year starts

  // const leaveYearStart = new Date(
  //   now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1,
  //   3,
  //   1
  // );
  // const leaveYearEnd = new Date(leaveYearStart.getFullYear() + 1, 2, 31);

  const weeklyFactor = 5.6;
  const fullLeave = weeklyFactor * dayPerWeek;

  if (joinDate < leaveYearStart) {
    return Math.round(fullLeave);
  }

  // if (isBefore(joinDateStr, leaveYearStart)) {
  //   return Math.round(fullLeave);
  // }

  const monthsRemaining =
    differenceInCalendarMonths(leaveYearEnd, joinDateStr) + 1;
  const proratedLeave = (fullLeave / 12) * monthsRemaining;
  return Math.round(proratedLeave);
}

async function countSickLeaveWithSSP() {
  return new Leave({
    leaveType: "Sick Leave",
    total: 7,
    used: 0,
    remaining: 7,
    type: "days",
    SSP: 28,
    extraType: "weeks",
  });
}

async function countMaternityLeave() {
  return new Leave({
    leaveType: "Maternity Leave",
    total: 52,
    used: 0,
    remaining: 52,
    type: "weeks",
    isHide: true,
    isLock: true,
    paid: 39,
  });
}

async function countPaternityLeave() {
  return new Leave({
    leaveType: "Paternity Leave",
    total: 2,
    used: 0,
    remaining: 2,
    type: "weeks",
    isHide: true,
    isLock: true,
    paid: 2,
  });
}

// Sync Leave Types

export async function syncMissingLeaveTypesNew(
  joinDate,
  dayPerWeek,
  employeeId,
) {
  try {
    if (!joinDate || !dayPerWeek || !employeeId)
      return { success: false, message: "Please Provide Valid Data" };

    const mongooseId = isValidObjectId(employeeId)
      ? createObjectId(employeeId)
      : null;

    if (!mongooseId) return { success: false, message: "Invalid employeeId" };

    const settings = await getLeaveSettings();
    const currentYear = getLeaveYearString(
      new Date(),
      settings.leaveYearStartMonth,
    );

    const leaveData = await getLeaveData(employeeId, currentYear, true);
    if (leaveData?.success) {
      await checkWithStoreLeaveType(leaveData, employeeId, currentYear);
      return { success: true, message: "Leave data synced successfully" };
    } else {
      const storeLeaveData = await countLeaveNewFirstTime(
        joinDate,
        dayPerWeek,
        employeeId,
      );

      if (!storeLeaveData?.success) return storeLeaveData;

      const checkData = { data: JSON.parse(storeLeaveData?.data) };
      await checkWithStoreLeaveType(checkData, employeeId, currentYear);

      return { success: true, message: "Leave data synced successfully" };
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error syncing leave data" };
  }
}

export async function countLeaveNewFirstTime(
  joinDate,
  dayPerWeek,
  employeeId,
  targetDate,
) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const submitedBy = props?.session?.user?._id;

    const settings = await getLeaveSettings();

    const baseDate = targetDate ? new Date(targetDate) : new Date();

    const leaveYear = getLeaveYearString(
      baseDate,
      settings.data?.leaveYearStartMonth,
    );
    const existing = await CommonLeaveModel.findOne({ employeeId, leaveYear });
    if (existing) {
      return {
        success: false,
        message: "Leave data already exists for this employee and year",
      };
    }
    // const leaveData = await generateDefaultLeaves(joinDate, dayPerWeek);
    const leaveData = await generateLeaveForNewYear({
      employeeId,
      joinDate,
      dayPerWeek,
      targetLeaveYear: leaveYear,
    });
    const commonLeave = await CommonLeaveModel.create({
      employeeId,
      leaveYear,
      leaveData,
      submitedBy,
      submitedDate: new Date(),
    });

    return {
      success: true,
      message: "store success",
      data: JSON.stringify(commonLeave),
    };
  } catch (error) {
    console.log(
      "countLeaveFirstTime function under countLeaveServer file",
      error,
    );
    return { success: false, message: "Something went wrong" };
  }
}

export async function generateLeaveForNewYear({
  employeeId,
  joinDate,
  dayPerWeek,
  targetLeaveYear, // e.g. "2025-26"
}) {
  await connect();

  const settings = await getLeaveSettings();

  // GLOBAL SWITCH CHECK
  const carryForwardEnabled = settings?.data?.carryForwardEnabled;
  const rules = settings?.data?.carryForwardRules || [];

  // derive previous year string from target year
  const prevLeaveYear = getPreviousLeaveYearString(
    targetLeaveYear,
    settings?.data?.leaveYearStartMonth,
  );

  const previousLeave = await CommonLeaveModel.findOne({
    employeeId,
    leaveYear: prevLeaveYear,
  }).lean();

  // Base new-year leaves (no carry forward yet)
  const baseLeaves = await generateDefaultLeaves(joinDate, dayPerWeek);

  if (!carryForwardEnabled || !previousLeave) {
    return baseLeaves;
  }

  const finalLeaves = baseLeaves.map((leave) => {
    const rule = rules.find((r) => r.leaveType === leave.leaveType);

    if (!rule || !rule.allowed || !previousLeave) {
      return leave;
    }

    const prevType = previousLeave.leaveData.find(
      (l) => l.leaveType === leave.leaveType,
    );

    if (!prevType || prevType.remaining <= 0) {
      return leave;
    }

    const carryDays = Math.min(prevType.remaining, rule.maxDays || 0);

    if (carryDays <= 0) {
      return leave;
    }

    return {
      ...leave,
      total: leave.total + carryDays,
      remaining: leave.remaining + carryDays,
      carryForwarded: carryDays,
      previousRemaining: prevType.remaining,
    };
  });

  return finalLeaves;
}

export async function generateDefaultLeaves(joinDate, dayPerWeek) {
  // Fetch all active leave categories
  const categories = await LeaveCategoryModel.find({
    isActive: true,
    isDeleted: false,
  }).lean();

  const leaves = [];
  const addedTypes = new Set();

  // 🔹 System mandatory leave types
  const SYSTEM_LEAVE_TYPES = [
    "Annual Leave",
    "Sick Leave",
    "Maternity Leave",
    "Paternity Leave",
    "Unpaid Leave",
  ];

  // Helper to safely add leave (no duplicates)
  const addLeave = (leaveObj) => {
    if (!addedTypes.has(leaveObj.leaveType)) {
      leaves.push(leaveObj);
      addedTypes.add(leaveObj.leaveType);
    }
  };

  // 🔹 1. First generate from categories
  for (const cat of categories) {
    let leaveInstance = null;

    // Annual Leave (special calculation)
    if (cat.leaveType === "Annual Leave") {
      const annualCount = await countAnnualLeave(joinDate, dayPerWeek);

      leaveInstance = new Leave({
        leaveType: "Annual Leave",
        total: annualCount,
        used: 0,
        remaining: annualCount,
        type: "days",
        isPaid: true,
        isHide: cat.isHide === "true" || cat.isHide === true,
        isLock: !cat.isEditable,
      });
    }

    // Sick Leave (SSP logic)
    else if (cat.leaveType === "Sick Leave") {
      leaveInstance = await countSickLeaveWithSSP();
    }

    // Maternity Leave
    else if (cat.leaveType === "Maternity Leave") {
      leaveInstance = await countMaternityLeave();
    }

    // Paternity Leave
    else if (cat.leaveType === "Paternity Leave") {
      leaveInstance = await countPaternityLeave();
    }

    // Other normal categories (custom leaves)
    else {
      leaveInstance = new Leave({
        leaveType: cat.leaveType,
        total: cat.total,
        used: 0,
        remaining: cat.total,
        type: "days",
        isPaid: cat.isPaid === "true" || cat.isPaid === true,
        isHide: cat.isHide === "true" || cat.isHide === true,
        isLock: !cat.isEditable,
      });
    }

    if (leaveInstance) addLeave(leaveInstance);
  }

  // 🔹 2. Ensure mandatory system leaves ALWAYS exist (safety net)

  // Annual Leave (if admin removed it accidentally)
  if (!addedTypes.has("Annual Leave")) {
    const annualCount = await countAnnualLeave(joinDate, dayPerWeek);

    addLeave(
      new Leave({
        leaveType: "Annual Leave",
        total: annualCount,
        used: 0,
        remaining: annualCount,
        type: "days",
        isPaid: true,
      }),
    );
  }

  // Sick Leave
  if (!addedTypes.has("Sick Leave")) {
    addLeave(await countSickLeaveWithSSP());
  }

  // Maternity Leave
  if (!addedTypes.has("Maternity Leave")) {
    addLeave(await countMaternityLeave());
  }

  // Paternity Leave
  if (!addedTypes.has("Paternity Leave")) {
    addLeave(await countPaternityLeave());
  }

  // Unpaid Leave (always exists, unlimited fallback)
  if (!addedTypes.has("Unpaid Leave")) {
    addLeave(
      new Leave({
        leaveType: "Unpaid Leave",
        total: 100,
        used: 0,
        remaining: 100,
        type: "days",
        isPaid: false,
        isHide: false,
      }),
    );
  }

  return leaves;
}

// Make one object function to make common leave

export async function storeCommonLeaveNew(joinDate, dayPerWeek, employeeId) {
  try {
    const mongooseId = isValidObjectId(employeeId)
      ? createObjectId(employeeId)
      : null;
    if (!mongooseId) return { success: false, message: "Invalid employeeId" };
    // const joinDate = new Date("08-22-2025");
    // const dayPerWeek = 5;
    // const employeeId = 123566465342;
    const leaveData = await countLeaveNewFirstTime(
      joinDate,
      dayPerWeek,
      employeeId,
    );
    if (!leaveData?.success) return leaveData;
    return leaveData;
  } catch (error) {}
}

export async function getLeaveData(employeeId, leaveYear, server) {
  try {
    const data = await CommonLeaveModel.findOne({ employeeId, leaveYear });
    if (data)
      return { success: true, data: server ? data : JSON.stringify(data) };
  } catch (e) {
    console.log(" Error fetching leave data", e);
    return { success: false, message: "Error fetching leave data" };
  }
}

async function checkWithStoreLeaveType(leaveData, employeeId, leaveYear) {
  try {
    const allLeave = await LeaveCategoryModel.find();
    const existingLeave = leaveData?.data?.leaveData.map(
      (leave) => leave.leaveType,
    );
    const missingLeaveTypes = allLeave.filter(
      (globalLeave) => !existingLeave?.includes(globalLeave.leaveType),
    );
    const newData = missingLeaveTypes.map(
      (item) =>
        new Leave({
          leaveType: item?.leaveType,
          total: item?.total,
          used: 0,
          remaining: item?.total,
          type: "days",
          paid: 1,
          isPaid: item?.isPaid === "Paid" ? true : false,
          isHide: item?.isHide === "Hide" ? true : false,
        }),
    );

    if (missingLeaveTypes.length > 0) {
      await CommonLeaveModel.updateOne(
        { employeeId, leaveYear },
        {
          $push: { leaveData: { $each: newData } },
        },
      );
      return { success: true, message: "Missing leave types synced" };
    } else {
      return { success: true, message: "No missing leave types found" };
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something Went Wrong..." };
  }
}

// Add one common leave to one employee

export async function addOneCommonLeaveToOneEmployee({
  leaveType,
  leaveYear,
  employeeId,
  leaveDays,
}) {
  try {
    const employeeObjectId = createObjectId(employeeId); // Convert employeeId once
    const existingLeaveCatogory = await LeaveCategoryModel.findOne({
      leaveType,
    });
    if (!existingLeaveCatogory)
      return {
        success: false,
        message: "Leave Category not find on admin category",
      };
    const existingCommonLeave = await getCommonSpecificLeave({
      employeeId: employeeObjectId,
      leaveYear: leaveYear,
      specificLeave: leaveType,
    });
    if (existingCommonLeave) {
      return {
        success: false,
        message: "Leave Category already added",
      };
    }
    const leaveData = new Leave({
      leaveType: existingLeaveCatogory?.leaveType,
      total: leaveDays ? leaveDays : existingLeaveCatogory?.total,
      used: leaveDays ? leaveDays : 0,
      remaining: 0,
      type: existingLeaveCatogory.type || "days",
      isPaid: existingLeaveCatogory?.isPaid === "Paid" ? true : false,
      isHide: existingLeaveCatogory?.isHide === "Hide" ? true : false,
    });

    // update the common leave data
    await CommonLeaveModel.updateOne(
      { employeeId: employeeObjectId, leaveYear },
      {
        $push: { leaveData: leaveData },
      },
    );
    return { success: true, message: "Missing leave types synced" };
  } catch (error) {
    console.log("Error in addOneCommonLeaveToOneEmployee", error);
    return { success: false, message: "Something want wrong" };
  }
}

// Generate new leave year for all employees
export async function generateNewLeaveYearForAllEmployees(
  targetDate = new Date(),
) {
  try {
    await connect();

    const settings = await getLeaveSettings();
    const leaveYear = getLeaveYearString(
      targetDate,
      settings.data?.leaveYearStartMonth,
    );
    const employee = await OfficeEmployeeModel.find({
      isActive: true,
      delete: false,
    }).lean();

    let created = 0;
    let skipped = 0;
    let notEligible = 0;
    let failed = 0;

    for (const emp of employee) {
      const dayPerWeek = emp.dayPerWeek || emp.daysPerWeek;

      // Keep consistent with per-employee UI eligibility
      if (!emp?.joinDate || !dayPerWeek || !emp?.employeType) {
        notEligible++;
        continue;
      }

      const existing = await CommonLeaveModel.findOne({
        employeeId: emp._id,
        leaveYear,
      }).lean();

      if (existing) {
        skipped++;
        continue;
      }

      try {
        const leaveData = await generateLeaveForNewYear({
          employeeId: emp._id,
          joinDate: emp.joinDate,
          dayPerWeek,
          targetLeaveYear: leaveYear,
        });

        await CommonLeaveModel.create({
          employeeId: emp._id,
          leaveYear,
          leaveData,
          submitedBy: null,
          submitedDate: new Date(),
        });

        created++;
      } catch (e) {
        failed++;
      }
    }
    return {
      success: true,
      message: `Leave sync completed. Created: ${created}, Skipped: ${skipped}, Not eligible: ${notEligible}, Failed: ${failed}`,
      data: JSON.stringify({
        leaveYear,
        created,
        skipped,
        notEligible,
        failed,
      }),
    };
  } catch (error) {
    console.log("Error in generateNewLeaveYearForAllEmployees", error);
    return { success: false, message: "Something went wrong" };
  }
}

export async function syncLeaveAllEmployeesForCurrentYear(
  targetDate = new Date(),
) {
  return generateNewLeaveYearForAllEmployees(targetDate);
}

export async function getLeaveYearSyncStatus(targetDate = new Date()) {
  try {
    await connect();

    const settings = await getLeaveSettings();
    const leaveYear = getLeaveYearString(
      targetDate,
      settings?.data?.leaveYearStartMonth,
    );

    const employeeFilter = {
      isActive: true,
      delete: false,
      joinDate: { $ne: null },
      employeType: { $exists: true, $ne: "" },
      dayPerWeek: { $exists: true, $ne: null },
    };

    const totalEligibleEmployees =
      await OfficeEmployeeModel.countDocuments(employeeFilter);

    const syncedEmployees = await CommonLeaveModel.aggregate([
      { $match: { leaveYear } },
      {
        $lookup: {
          from: "officeemployes",
          localField: "employeeId",
          foreignField: "_id",
          as: "employee",
        },
      },
      { $unwind: "$employee" },
      {
        $match: {
          "employee.isActive": true,
          "employee.delete": false,
          "employee.joinDate": { $ne: null },
          "employee.employeType": { $exists: true, $ne: "" },
          "employee.dayPerWeek": { $exists: true, $ne: null },
        },
      },
      { $group: { _id: "$employeeId" } },
      { $count: "count" },
    ]);

    const syncedCount = syncedEmployees?.[0]?.count || 0;
    const pendingEmployees = Math.max(totalEligibleEmployees - syncedCount, 0);

    const payload = {
      leaveYear,
      totalEligibleEmployees,
      syncedEmployees: syncedCount,
      pendingEmployees,
      showSyncAllButton: pendingEmployees > 0,
    };

    return {
      success: true,
      data: JSON.stringify(payload),
    };
  } catch (error) {
    console.log("Error in getLeaveYearSyncStatus", error);
    return {
      success: false,
      message: "Failed to fetch leave sync status",
      data: JSON.stringify({
        leaveYear: "",
        totalEligibleEmployees: 0,
        syncedEmployees: 0,
        pendingEmployees: 0,
        showSyncAllButton: false,
      }),
    };
  }
}

// Preview carry forward for all employees
export async function previewCarryForwardForCompany() {
  try {
    await connect();

    const settings = await getLeaveSettings();
    const settingsData = settings.data || {};
    const carryForwardEnabled = settingsData.carryForwardEnabled;
    const rules = settingsData?.carryForwardRules || [];
    const startMonth = settingsData?.leaveYearStartMonth || 4;

    // Get current & previous leave year
    const currentLeaveYear = getLeaveYearString(new Date(), startMonth);
    const previousLeaveYear = getPreviousLeaveYearString(
      currentLeaveYear,
      startMonth,
    );

    // Get all active employees
    const employees = await OfficeEmployeeModel.find({
      isActive: true,
      delete: false,
    });

    const previewResults = [];

    for (const emp of employees) {
      const prevLeave = await CommonLeaveModel.findOne({
        employeeId: emp._id,
        leaveYear: previousLeaveYear,
      }).lean();

      // If no previous data → skip (nothing to carry)
      if (!prevLeave) continue;

      // Generate base new year leaves (without saving)
      const baseLeaves = await generateDefaultLeaves(
        emp.joinDate,
        emp.dayPerWeek,
      );

      for (const leave of baseLeaves) {
        const rule = rules.find((r) => r.leaveType === leave.leaveType);

        const prevType = prevLeave.leaveData.find(
          (l) => l.leaveType === leave.leaveType,
        );

        let willCarry = 0;

        if (
          carryForwardEnabled &&
          rule?.enabled &&
          prevType &&
          prevType.remaining > 0
        ) {
          willCarry = Math.min(prevType.remaining, rule.maxDays || 0);
        }

        previewResults.push({
          employeeId: emp._id,
          employeeName: emp.name,
          leaveType: leave.leaveType,
          remainingLastYear: prevType?.remaining || 0,
          ruleMax: rule?.maxDays || 0,
          willCarry,
          newTotal: leave.total + willCarry,
        });
      }
    }

    return {
      success: true,
      data: JSON.stringify(previewResults),
      currentLeaveYear,
      previousLeaveYear,
    };
  } catch (error) {
    console.log("Preview Carry Forward Error:", error);
    return { success: false, message: "Failed to preview carry forward" };
  }
}

export async function previewCarryForwardPerCompany(targetDate = new Date()) {
  await connect();

  const settingsRes = await getLeaveSettings();
  const settings = settingsRes?.data;

  if (!settings?.carryForwardEnabled) {
    return { success: false, message: "Carry forward is disabled" };
  }

  const startMonth = settings.leaveYearStartMonth;
  const currentLeaveYear = getLeaveYearString(targetDate, startMonth);
  const previousLeaveYear = getPreviousLeaveYearString(currentLeaveYear);

  // All employees previous year leaves
  const previousLeaves = await CommonLeaveModel.find({
    leaveYear: previousLeaveYear,
  }).lean();

  const rulesMap = new Map();
  (settings.carryForwardRules || []).forEach((r) => {
    rulesMap.set(r.leaveType, r);
  });

  const preview = [];

  for (const empLeave of previousLeaves) {
    const carried = [];

    for (const leave of empLeave.leaveData) {
      const rule = rulesMap.get(leave.leaveType);

      if (!rule || !rule.allowed) continue;

      const maxAllowed = rule.maxDays ?? 0;
      const carryAmount = Math.min(leave.remaining, maxAllowed);

      if (carryAmount > 0) {
        carried.push({
          leaveType: leave.leaveType,
          remainingLastYear: leave.remaining,
          willCarryForward: carryAmount,
        });
      }
    }
    // based on the employeeId find the employee Name
    const employee = await OfficeEmployeeModel.findById(
      empLeave.employeeId,
    ).lean();

    if (carried.length > 0) {
      preview.push({
        employeeId: empLeave.employeeId,
        employeeName: employee?.name || "Unknown",
        leaveYearFrom: previousLeaveYear,
        leaveYearTo: currentLeaveYear,
        carriedLeaves: carried,
      });
    }
  }

  return { success: true, data: JSON.stringify(preview) };
}
