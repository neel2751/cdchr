"use server";
// The leave year comes from lib/leaveYear.js now — it reads the month the
// company chose. The old @/lib/getLeaveYear helper hard-coded April and has
// been deleted; see lib/leaveYear.js for what went wrong with it.
import {
  annualLeaveForYear,
  boundsForLeaveYear,
  leaveYearBounds,
} from "@/lib/leaveEntitlement";
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
import { requireEntitlementAccess } from "@/lib/employeeAccess";
import { carryForwardExpiry, resolveCarryForward } from "@/lib/carryForward";

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
2: Leave Year starts on the month the company chose (LeaveSetting) — April for
   most, but a January-December company is not unusual.
3: Round part days UP, in the employee's favour: the figure is a statutory
   minimum, so rounding down hands somebody less holiday than the law gives.
4: Only prorate if the employee joined during the leave year being generated.
5: Days per week can be: full-time (5 or 6) or part-time(e.g:3).
6: if they joined before of the current leave year -> grant full leave.
7: if they join AFTER it ends -> nothing. A start date in a future leave year
   used to produce a negative month count, a negative entitlement, and a stored
   record saying the employee owed the company leave.

#Example (April-March leave year)

1: 6 days/week, started in April --> 5.6 * 6 = 33.6 --> 34 days
2: 5 days/week, started in April --> 5.6 * 5 = 28 days
3: 3 days/week (part-time), started in April = 5.6 * 3 = 16.8 --> 17 days
4: 6 days/week, joined 1 July --> 34 * 274/365 = 25.5 --> 26 days
5: 5 days/week, joined 1 July --> 28 * 274/365 = 21.0 --> 21 days
6: 3 days/week, joined 1 July --> 17 * 274/365 = 12.6 --> 13 days

The pro-rata is by DAYS employed, not by whole months. The old version counted a
calendar month as worked however little of it was, so joining on the 30th of June
was credited the same nine months as joining on the 1st -- about two and a half
days of leave that had not been accrued -- and the entitlement moved in steps on
the 1st of each month rather than accruing. See lib/leaveEntitlement.js, which
holds the arithmetic and the reasoning behind it.
*/

/**
 * One employee's annual leave for one leave year.
 *
 * `targetLeaveYear` is threaded in rather than always using today's year,
 * because the caller is not always talking about today: generating a company's
 * next leave year in advance used to pro-rate everybody against the *current*
 * one, so a March joiner was given a fraction of a year they would in fact work
 * all of.
 *
 * @param {string|Date} joinDateStr
 * @param {number} dayPerWeek contracted days per week
 * @param {string} [targetLeaveYear] e.g. "2026-27". Defaults to today's.
 * @returns {Promise<number>} whole days
 */
async function countAnnualLeave(joinDateStr, dayPerWeek, targetLeaveYear) {
  if (!joinDateStr || dayPerWeek <= 0) return 0;

  const settings = await getLeaveSettings(); // later pass companyId
  const startMonth = settings?.data?.leaveYearStartMonth || 4; // 1-12

  const { start, end } = targetLeaveYear
    ? boundsForLeaveYear(targetLeaveYear, startMonth)
    : leaveYearBounds(new Date(), startMonth);

  return annualLeaveForYear({
    joinDate: joinDateStr,
    dayPerWeek,
    leaveYearStart: start,
    leaveYearEnd: end,
  });
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
    // `.data`, not the wrapper. This read said `settings.leaveYearStartMonth`,
    // which is always undefined — getLeaveSettings returns `{ success, data }` —
    // so getLeaveYearString fell back to its April default. For any company on
    // a leave year that does not start in April, this filed the employee's
    // entitlement under the wrong year key while the screens that show it
    // computed the right one, and the employee appeared to have no entitlement
    // at all.
    const currentYear = getLeaveYearString(
      new Date(),
      settings?.data?.leaveYearStartMonth,
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

/**
 * @param {Object} input
 * @param {string} input.employeeId
 * @param {string|Date} input.joinDate
 * @param {number} input.dayPerWeek
 * @param {string} input.targetLeaveYear e.g. "2025-26"
 * @param {Object} [input.employee] the employee record, when the caller already
 *   has it. Carry-forward eligibility depends on their employment type,
 *   department, start date and personal override, so it has to be read from
 *   somewhere — passing it in keeps the bulk path from re-fetching per employee.
 */
export async function generateLeaveForNewYear({
  employeeId,
  joinDate,
  dayPerWeek,
  targetLeaveYear, // e.g. "2025-26"
  employee,
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
  const baseLeaves = await generateDefaultLeaves(
    joinDate,
    dayPerWeek,
    targetLeaveYear,
  );

  if (!carryForwardEnabled || !previousLeave) {
    return baseLeaves;
  }

  const { start: targetYearStart } = boundsForLeaveYear(
    targetLeaveYear,
    settings?.data?.leaveYearStartMonth,
  );

  // Only the four fields eligibility turns on. Fetched here when the caller did
  // not supply them — a single employee being generated has no record in hand,
  // while the whole-company sweep does.
  const subject =
    employee ||
    (await OfficeEmployeeModel.findById(employeeId)
      .select("employeType department joinDate dayPerWeek carryForwardOverrides")
      .lean());

  const finalLeaves = baseLeaves.map((leave) => {
    const prevType = previousLeave.leaveData.find(
      (l) => l.leaveType === leave.leaveType,
    );

    // One shared rule, in lib/carryForward.js, rather than a fourth copy of it.
    // It also caps the carry at the leave type's own ceiling, which nothing did
    // before: 34 fresh days plus 30 carried used to store a total of 64, above
    // the 60 anybody is allowed to set by hand — which left the row permanently
    // uneditable.
    const carried = resolveCarryForward({
      enabled: carryForwardEnabled,
      rule: rules.find((r) => r.leaveType === leave.leaveType),
      previousRemaining: prevType?.remaining,
      baseTotal: leave.total,
      leaveType: leave.leaveType,
      unit: leave.type === "weeks" ? "weeks" : "days",
      // WHO. A company allowing carry-forward for some staff and not others is
      // the normal case; see carryForwardEligibility() in lib/carryForward.js.
      employee: subject,
      leaveYearStart: targetYearStart,
    });

    if (carried.days <= 0) return leave;

    return {
      ...leave,
      total: leave.total + carried.days,
      remaining: leave.remaining + carried.days,
      // Kept so the screens can explain a total nobody can otherwise account
      // for. `carryForwarded` and `previousRemaining` were already written here
      // and read by absolutely nothing, which is why an employee could end up
      // holding 44 days of annual leave with no breakdown anywhere on screen.
      carryForwarded: carried.days,
      previousRemaining: prevType.remaining,
      carriedFrom: prevLeaveYear,
      // "policy" or "override-always" — which of the two decided it.
      carryForwardVia: carried.via || "policy",
      // The entitlement before anything was carried, so the two halves of the
      // figure stay separable after the fact.
      baseTotal: leave.total,
      carryForwardExpiresAt: carryForwardExpiry(
        rules.find((r) => r.leaveType === leave.leaveType),
        targetYearStart,
      ),
    };
  });

  return finalLeaves;
}

/**
 * @param {string|Date} joinDate
 * @param {number} dayPerWeek
 * @param {string} [targetLeaveYear] which leave year the annual figure is for.
 *   Omitted means today's — correct for a new starter, wrong for a year being
 *   generated ahead of time.
 */
export async function generateDefaultLeaves(
  joinDate,
  dayPerWeek,
  targetLeaveYear,
) {
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
      const annualCount = await countAnnualLeave(joinDate, dayPerWeek, targetLeaveYear);

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
    const annualCount = await countAnnualLeave(joinDate, dayPerWeek, targetLeaveYear);

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

/**
 * One employee's entitlement record for one leave year.
 *
 * Used to return `undefined` when no record existed — the `if (data)` had no
 * `else`, so the function fell off the end. Every caller then had to treat
 * "nothing there" and "it went wrong" as the same thing, because both arrived
 * as a falsy `?.success`, and a server action that resolves to `undefined` is
 * not a shape any client can reason about.
 *
 * Not-found now says so. It is still `success: false`, deliberately: every
 * caller's else branch means "no record for this year, make one", which is
 * exactly right for a miss. `notFound` is there for the one caller that needs
 * to tell a miss from a failure — an employee simply has no entitlements set
 * for a year they did not work, and that is not an error to report.
 *
 * @param {string} employeeId
 * @param {string} leaveYear e.g. "2026-27". A *string*: the field is a String
 *   and a calendar year number matches nothing.
 * @param {boolean} [server] return the document itself rather than JSON.
 */
export async function getLeaveData(employeeId, leaveYear, server) {
  try {
    const data = await CommonLeaveModel.findOne({ employeeId, leaveYear });
    if (data)
      return { success: true, data: server ? data : JSON.stringify(data) };
    return {
      success: false,
      notFound: true,
      message: `No leave entitlements recorded for ${leaveYear}`,
    };
  } catch (e) {
    console.log(" Error fetching leave data", e);
    return { success: false, message: "Error fetching leave data" };
  }
}

async function checkWithStoreLeaveType(leaveData, employeeId, leaveYear) {
  try {
    // Filtered, which it was not. `find()` with no criteria returns deleted and
    // deactivated categories too, so every press of the scan button re-added
    // leave types an admin had removed — and the employee got a fresh allowance
    // of each.
    const allLeave = await LeaveCategoryModel.find({
      isDeleted: false,
      isActive: true,
    });
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

/**
 * Give one employee one more leave type, for one leave year.
 *
 * Behind the "+" on the entitlement sheet, for a type the employee does not have
 * — usually because it was created after their entitlements were built.
 *
 * TWO THINGS WERE WRONG.
 *
 * `remaining` was hard-coded to 0, and `used` was set to the *whole* allowance
 * whenever `leaveDays` was passed. So the button created a leave type the
 * employee could not take a single day of: the sheet showed "20 total, 0
 * remaining" and every booking against it was refused for lack of balance.
 * Remaining is now derived — an allowance minus what has been taken of it,
 * which for a type being added for the first time is all of it.
 *
 * And there was no authorisation at all. Every exported "use server" function is
 * an addressable endpoint whether or not a button points at it, so this took an
 * employee id from its caller and wrote to that employee's entitlements — any
 * signed-in account could hand itself an allowance. Guarded now by the same rule
 * that governs every other write to somebody else's record.
 *
 * @param {Object} input
 * @param {string} input.leaveType must already exist as a LeaveCategory
 * @param {string} input.leaveYear e.g. "2026-27"
 * @param {string} input.employeeId
 * @param {number} [input.leaveDays] override the category's allowance
 */
export async function addOneCommonLeaveToOneEmployee({
  leaveType,
  leaveYear,
  employeeId,
  leaveDays,
}) {
  try {
    const refusal = await requireEntitlementAccess(employeeId);
    if (refusal) return refusal;

    if (!leaveType || !leaveYear || !employeeId) {
      return {
        success: false,
        message: "Leave type, leave year and employee are all required",
      };
    }
    if (!isValidObjectId(employeeId)) {
      return { success: false, message: "Invalid employeeId" };
    }

    await connect();
    const employeeObjectId = createObjectId(employeeId); // Convert employeeId once
    const existingLeaveCatogory = await LeaveCategoryModel.findOne({
      leaveType,
      isDeleted: false,
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

    // An explicit figure wins over the category's default, but it has to be a
    // real number of days — a blank field arriving as "" would otherwise become
    // an allowance of zero.
    const override = Number(leaveDays);
    const total =
      leaveDays !== undefined && leaveDays !== null && leaveDays !== ""
        ? override
        : Number(existingLeaveCatogory.total);

    if (!Number.isFinite(total) || total < 0) {
      return { success: false, message: "Invalid number of days" };
    }

    const leaveData = new Leave({
      leaveType: existingLeaveCatogory?.leaveType,
      total,
      // Nothing has been taken of an allowance that did not exist a moment ago.
      used: 0,
      remaining: total,
      type: existingLeaveCatogory.type || "days",
      isPaid: existingLeaveCatogory?.isPaid === "Paid" ? true : false,
      isHide: existingLeaveCatogory?.isHide === "Hide" ? true : false,
    });

    // update the common leave data
    const result = await CommonLeaveModel.updateOne(
      { employeeId: employeeObjectId, leaveYear },
      {
        $push: { leaveData: leaveData },
      },
    );
    // An employee with no entitlement document for this year has nothing to push
    // onto. Said plainly rather than reported as success — the row would simply
    // not appear, and the admin would press the button again.
    if (!result.matchedCount) {
      return {
        success: false,
        message: `This employee has no entitlements for ${leaveYear} yet. Build them from Leave → Setup first.`,
      };
    }
    return { success: true, message: `${leaveType} added` };
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
          // Already in hand, so eligibility costs no extra query per employee.
          employee: emp,
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
    // For the service-length condition: how long they had served by the time the
    // year they are carrying into began.
    const { start: currentYearStart } = boundsForLeaveYear(
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
        currentLeaveYear,
      );

      for (const leave of baseLeaves) {
        const rule = rules.find((r) => r.leaveType === leave.leaveType);

        const prevType = prevLeave.leaveData.find(
          (l) => l.leaveType === leave.leaveType,
        );

        // `rule?.enabled` here used to be the whole bug: the schema field is
        // `allowed`, so this condition was never true and the preview reported
        // zero carry-forward for everybody while the generator carried days.
        // Both now go through the same function.
        const carried = resolveCarryForward({
          enabled: carryForwardEnabled,
          rule,
          previousRemaining: prevType?.remaining,
          baseTotal: leave.total,
          leaveType: leave.leaveType,
          unit: leave.type === "weeks" ? "weeks" : "days",
          employee: emp,
          leaveYearStart: currentYearStart,
        });

        previewResults.push({
          employeeId: emp._id,
          employeeName: emp.name,
          leaveType: leave.leaveType,
          remainingLastYear: prevType?.remaining || 0,
          ruleMax: rule?.maxDays || 0,
          willCarry: carried.days,
          willLose: carried.lost,
          explanation: carried.explanation,
          eligible: carried.outcome !== "not-eligible",
          via: carried.via || "policy",
          newTotal: leave.total + carried.days,
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

  // Everybody at once rather than one findById per employee inside the loop,
  // which is what this did — and it needs more than the name now, because
  // carry-forward eligibility turns on employment type, department, start date
  // and the personal override.
  const employees = await OfficeEmployeeModel.find({
    _id: { $in: previousLeaves.map((row) => row.employeeId) },
  })
    .select("name employeType department joinDate dayPerWeek carryForwardOverrides")
    .lean();
  const employeeById = new Map(employees.map((e) => [String(e._id), e]));

  const { start: currentYearStart } = boundsForLeaveYear(
    currentLeaveYear,
    startMonth,
  );

  const preview = [];

  for (const empLeave of previousLeaves) {
    const carried = [];
    const employee = employeeById.get(String(empLeave.employeeId));

    for (const leave of empLeave.leaveData) {
      // The same shared rule. Note this preview has no new-year entitlement to
      // measure the ceiling against, so it passes the old total — which is the
      // closest honest stand-in and errs towards reporting less, not more.
      const outcome = resolveCarryForward({
        enabled: true, // the caller already refused when the switch is off
        rule: rulesMap.get(leave.leaveType),
        previousRemaining: leave.remaining,
        baseTotal: leave.total,
        leaveType: leave.leaveType,
        unit: leave.type === "weeks" ? "weeks" : "days",
        employee,
        leaveYearStart: currentYearStart,
      });

      if (outcome.days > 0) {
        carried.push({
          leaveType: leave.leaveType,
          remainingLastYear: leave.remaining,
          willCarryForward: outcome.days,
          explanation: outcome.explanation,
        });
      }
    }

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
