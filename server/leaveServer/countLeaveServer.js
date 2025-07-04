"use server";
import { getLeaveYearString } from "@/lib/getLeaveYear";
import { differenceInCalendarMonths, isBefore } from "date-fns";
import mongoose from "mongoose";
import { getServerSideProps } from "../session/session";
import CommonLeaveModel from "@/models/commonLeaveModel";
import { connect } from "@/db/db";
import LeaveCategoryModel from "@/models/leaveCategoryModel";
import { validateLeaveData } from "./helper/helper";
import { createObjectId } from "@/lib/mongodb";
import { getCommonSpecificLeave } from "./getLeaveServer";

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

  const now = new Date();

  const leaveYearStart = new Date(
    now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1,
    3,
    1
  );
  const leaveYearEnd = new Date(leaveYearStart.getFullYear() + 1, 2, 31);

  const weeklyFactor = 5.6;
  const fullLeave = weeklyFactor * dayPerWeek;

  if (isBefore(joinDateStr, leaveYearStart)) {
    return Math.round(fullLeave);
  }

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

// utils/leaveUtils.js
export async function generateDefaultLeaves(joinDate, dayPerWeek) {
  const annualCount = await countAnnualLeave(joinDate, dayPerWeek);

  const annualLeave = new Leave({
    leaveType: "Annual Leave",
    total: annualCount,
    used: 0,
    remaining: annualCount,
    type: "days",
    isPaid: true,
  });

  const sickLeave = await countSickLeaveWithSSP();
  const maternityLeave = await countMaternityLeave();
  const paternityLeave = await countPaternityLeave();

  const unpaidLeave = new Leave({
    leaveType: "Unpaid Leave",
    total: 0,
    used: 0,
    remaining: 0,
    type: "days",
    isPaid: false,
    isHide: false,
  });

  return [annualLeave, sickLeave, maternityLeave, paternityLeave, unpaidLeave];
}

// Make one object function to make common leave

export async function countLeaveNewFirstTime(
  joinDate,
  dayPerWeek,
  employeeId,
  targetDate
) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const submitedBy = props?.session?.user?._id;

    const leaveYear = getLeaveYearString(targetDate); // e.g., "2026-27"
    let commonLeave = await CommonLeaveModel.findOne({ employeeId, leaveYear });
    if (!commonLeave) {
      const leaveData = await generateDefaultLeaves(joinDate, dayPerWeek);
      commonLeave = await CommonLeaveModel.create({
        employeeId,
        leaveYear,
        leaveData,
        submitedBy,
        submitedDate: new Date(),
      });
    }
    commonLeave.leaveData.find((item) => item.leaveType === "Annual Leave");
    return {
      success: true,
      message: "store success",
      data: JSON.stringify(commonLeave),
    };
  } catch (error) {
    console.log(
      "countLeaveFirstTime function under countLeaveServer file",
      error
    );
    return { success: false, message: "Something went wrong" };
  }
}

export async function storeCommonLeaveNew(joinDate, dayPerWeek, employeeId) {
  try {
    const mongooseId = mongoose.Types.ObjectId.isValid(employeeId)
      ? new mongoose.Types.ObjectId(employeeId)
      : null;
    if (!mongooseId) return { success: false, message: "Invalid employeeId" };
    // const joinDate = new Date("08-22-2025");
    // const dayPerWeek = 5;
    // const employeeId = 123566465342;
    const leaveData = await countLeaveNewFirstTime(
      joinDate,
      dayPerWeek,
      employeeId
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
      (leave) => leave.leaveType
    );
    const missingLeaveTypes = allLeave.filter(
      (globalLeave) => !existingLeave?.includes(globalLeave.leaveType)
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
        })
    );

    if (missingLeaveTypes.length > 0) {
      await CommonLeaveModel.updateOne(
        { employeeId, leaveYear },
        {
          $push: { leaveData: { $each: newData } },
        }
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

// Sync Leave Types
export async function syncMissingLeaveTypesNew(
  joinDate,
  dayPerWeek,
  employeeId
) {
  try {
    if (!joinDate || !dayPerWeek || !employeeId)
      return { success: false, message: "Please Provide Valid Data" };
    const mongooseId = mongoose.Types.ObjectId.isValid(employeeId)
      ? new mongoose.Types.ObjectId(employeeId)
      : null;
    if (!mongooseId) return { success: false, message: "Invalid employeeId" };
    const currentYear = getLeaveYearString(new Date());
    const server = true;
    // check in the common leave data
    const leaveData = await getLeaveData(employeeId, currentYear, server);
    if (leaveData?.success) {
      await checkWithStoreLeaveType(leaveData, employeeId, currentYear);
    } else {
      const storeLeaveData = await storeCommonLeaveNew(
        joinDate,
        dayPerWeek,
        employeeId
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
      }
    );
    return { success: true, message: "Missing leave types synced" };
  } catch (error) {
    console.log("Error in addOneCommonLeaveToOneEmployee", error);
    return { success: false, message: "Something want wrong" };
  }
}
