"use server";

import { connect } from "@/db/db";
import CommonLeaveModel from "@/models/commonLeaveModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInWeeks,
  getYear,
} from "date-fns";
import mongoose from "mongoose";
import { getServerSideProps } from "../session/session";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { fetchLeaveCategory } from "../category/category";
import { getLeaveYearString } from "@/lib/getLeaveYear";
import { createObjectId } from "@/lib/mongodb";
import { getLeaveSettings } from "../leaveSettingServer";
import { decrypt } from "@/lib/algo";
import { resolveEmployeeTarget } from "@/lib/employeeAccess";

/** decrypt() throws on a malformed token; a bad slug should just mean "me". */
function safeDecryptId(value) {
  if (!value) return null;
  try {
    return decrypt(value) || null;
  } catch {
    return null;
  }
}

export async function storeLeave(employeeId, data) {
  try {
    await connect();
    //check the employeeId is valid or not
    const monggoseId = mongoose.Types.ObjectId.isValid(employeeId)
      ? new mongoose.Types.ObjectId(employeeId)
      : null;
    if (!monggoseId) return { success: false, message: "Invalid employeeId" };
    // first we have to count a leave data
    const leaveData = await countLeave(monggoseId, data);
    if (!leaveData?.success)
      return { success: false, message: "Failed to count leave data" };
    const storeData = await CommonLeaveModel(leaveData?.data);
    const result = await storeData.save();
    return {
      success: true,
      message: "Leave data stored successfully",
      data: JSON.stringify(result),
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Failed to store leave data" };
  }
}

// give an option to update the leave data particaluallry

// if employee doesn't have any leave so give permission to generate leave depend on the current data
export async function fetchCommonLeave(filterData) {
  const sanitizedSearch = filterData?.query?.trim() || ""; // Ensure search is a string
  // const searchRegex = new RegExp(sanitizedSearch, "i"); // Create a case-ins ensitive regex
  const validPage = parseInt(filterData?.page < 0 ? 1 : filterData?.page || 1);
  const validLimit = parseInt(filterData?.pageSize || 10);
  const roleTypeFilter = filterData?.filter?.role;
  const companyFilter = filterData?.filter?.company;
  const filterType = filterData?.filter?.type;
  const skip = (validPage - 1) * validLimit;
  // Entitlements only apply to current staff. This also keeps the table in
  // step with getLeaveYearSyncStatus(), which has always counted active
  // employees only — the two disagreed while leavers were still listed here.
  const query = { delete: false, isActive: true };

  const settings = await getLeaveSettings();
  const currentLeaveYear = getLeaveYearString(
    new Date(),
    settings?.data?.leaveYearStartMonth
  );

  const roleTypeFilterQuery = roleTypeFilter
    ? { "departments._id": createObjectId(roleTypeFilter) } // Field for department filter
    : {};

  const companyFilterQuery = companyFilter
    ? { "companys._id": createObjectId(companyFilter) } // Field for company filter
    : {};

  if (filterType) {
    query.immigrationType = filterType;
  }
  if (sanitizedSearch) {
    query.$or = [
      { name: { $regex: sanitizedSearch, $options: "i" } },
      { email: { $regex: sanitizedSearch, $options: "i" } },
      // { phoneNumber: { $regex: sanitizedSearch, $options: "i" } },
    ];
  }

  // check if any employee overlap the dates if it is how many dates they are overlapping

  try {
    await connect();
    const pipeline = [
      {
        $match: query,
      },
      {
        $lookup: {
          from: "commonleaves",
          let: { empId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employeeId", "$$empId"] },
                    { $eq: ["$leaveYear", currentLeaveYear] },
                  ],
                },
              },
            },
          ],
          as: "commonLeave",
        },
      },

      {
        $lookup: {
          from: "roletypes",
          localField: "department",
          foreignField: "_id",
          as: "roleType",
        },
      },
      {
        $match: {
          ...roleTypeFilterQuery,
          ...companyFilterQuery,
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $addFields: {
          roleType: { $arrayElemAt: ["$roleType.roleTitle", 0] },
          hasCommonLeave: { $gt: [{ $size: "$commonLeave" }, 0] },
          leaveData: { $arrayElemAt: ["$commonLeave.leaveData", 0] },
          leaveYear: { $arrayElemAt: ["$commonLeave.leaveYear", 0] },
          leaveHistory: { $arrayElemAt: ["$commonLeave.leaveHistory", 0] },
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          joinDate: 1,
          employeType: 1,
          dayPerWeek: 1,
          hasCommonLeave: 1,
          leaveData: 1,
          roleType: 1,
          leaveYear: 1,
          leaveHistory: 1,
          // The password hash is deliberately not projected — the table has no
          // use for it and it must never reach the client.
        },
      },
      {
        $facet: {
          totalCount: [{ $count: "count" }],
          result: [
            { $skip: skip > 0 ? skip : 0 },
            { $limit: validLimit > 0 ? validLimit : 10 },
          ],
        },
      },
      {
        $project: {
          totalCount: 1,
          result: 1, // Flatten the "result" array
        },
      },
    ];

    const employeeWithLeave = await OfficeEmployeeModel.aggregate(pipeline);
    const totalCount = employeeWithLeave[0].totalCount[0].count;
    const result = employeeWithLeave[0].result;
    return { success: true, data: JSON.stringify(result), totalCount };
  } catch (error) {
    console.log(" Error in fetchCommonLeave", error);
    return { success: false, message: "Failed to fetch common leave data" };
  }
}

export async function countLeave(employeeId, data) {
  try {
    const allCategory = await fetchLeaveCategory();
    if (!allCategory.success) return allCategory;
    const leaveCategories = JSON.parse(allCategory?.data);

    const STATUTORY_ANNUAL_LEAVE_DAYS = 28;
    const STATUTORY_SICK_WEEKS = 28; // Maximum SSP weeks
    const MATERNITY_WEEKS = 52;
    const MATERNITY_PAID_WEEKS = 39;
    const PATERNITY_WEEKS = 2;

    const startDateObj = new Date(data?.joinDate);
    const weeksWorked = differenceInWeeks(new Date(), startDateObj);
    const fullYearRatio = Math.min(weeksWorked / 52, 1);
    let sspEligibleWeeks = STATUTORY_SICK_WEEKS;
    //count 4 week after date of the startDateObj
    const fourWeeksAfter = addWeeks(new Date(startDateObj), 4);
    // count 26 week after date of the startDateObj
    const twentySixWeeksAfter = addWeeks(new Date(startDateObj), 26);

    // Calculate SSP eligibility and weeks
    const isEligibleForSSP = weeksWorked >= 4; // Need 4 weeks of employment
    if (!isEligibleForSSP) {
      sspEligibleWeeks = 0;
    }

    // Calculate maternity leave eligibility and weeks(26 weeks continous employment)
    const isEligibleForParental = weeksWorked >= 26;
    const sickLeave = {
      leaveType: "Sick Leave",
      total: 7,
      used: 0,
      remaining: STATUTORY_SICK_WEEKS,
      accrued: Math.round(STATUTORY_SICK_WEEKS * fullYearRatio),
      isEligible: isEligibleForSSP,
      eligibleDate: fourWeeksAfter,
      paid: sspEligibleWeeks,
      requireFitNote: true,
      type: "weeks",
    };
    const maternityLeave = {
      leaveType: "Maternity Leave",
      total: MATERNITY_WEEKS,
      used: 0,
      remaining: MATERNITY_WEEKS,
      accrued: Math.round(MATERNITY_WEEKS * fullYearRatio),
      isEligible: isEligibleForParental,
      eligibleDate: twentySixWeeksAfter,
      paid: MATERNITY_PAID_WEEKS,
      compulsory: 2,
      type: "weeks",
    };
    const paternityLeave = {
      // leaveType: 'Statutory Sick Pay',
      leaveType: "Paternity Leave",
      total: PATERNITY_WEEKS,
      used: 0,
      remaining: PATERNITY_WEEKS,
      accrued: Math.round(PATERNITY_WEEKS * fullYearRatio),
      isEligible: isEligibleForParental,
      paid: PATERNITY_WEEKS,
      type: "weeks",
    };
    // first count Full-Time
    const employmentType = data?.employeType;
    if (employmentType === "Full-Time") {
      console.log("-----Full Time------");
      const result = {
        employeeId: employeeId,
        leaveYear: getYear(new Date()),
        leaveData: [
          {
            leaveType: "Annual Leave",
            total: STATUTORY_ANNUAL_LEAVE_DAYS,
            used: 0,
            remaining: STATUTORY_ANNUAL_LEAVE_DAYS,
            accrued: Math.round(STATUTORY_ANNUAL_LEAVE_DAYS * fullYearRatio),
            type: "days",
            isEligible: true,
          },
          sickLeave,
          maternityLeave,
          paternityLeave,
        ],
      };
      const allLeaveType = result?.leaveData?.map(({ leaveType }) => leaveType);
      const leaveFilter = leaveCategories.filter(
        (leave) => !allLeaveType.includes(leave.leaveType)
      );
      const newData = leaveFilter.map((item) => {
        const isEligible =
          item?.ruleType === "days"
            ? addDays(new Date(startDateObj), item?.rule)
            : addMonths(new Date(startDateObj), item?.rule);
        return {
          leaveType: item?.leaveType,
          total: item?.total,
          used: 0,
          remaining: item?.total,
          rule: item?.rule,
          ruleType: item?.ruleType,
          eligibleDate: isEligible,
        };
      });
      const newLeavData = {
        ...result,
        leaveData: [...result.leaveData, ...newData],
      };
      return { success: true, data: newLeavData };
    } else {
      console.log("-----Part Time------");
      const result = {
        employeeId: employeeId,
        leaveYear: getYear(new Date()),
        leaveData: [
          {
            leaveType: "Annual Leave",
            total:
              Number(data?.partTimeDays) < 6
                ? Math.round(Number(data?.partTimeDays) * 5.6)
                : 28,
            used: 0,
            remaining:
              Number(data?.partTimeDays) < 6
                ? Math.round(Number(data?.partTimeDays) * 5.6)
                : 28,
            accrued: Math.round(STATUTORY_ANNUAL_LEAVE_DAYS * fullYearRatio),
            type: "days",
            isEligible: true,
          },
          sickLeave,
          maternityLeave,
          paternityLeave,
        ],
      };
      return result;
    }
  } catch (error) {
    console.error(error);
    return { success: false, message: "Error processing data" };
  }
}

/**
 * One person's leave entitlements for one leave year.
 *
 * Took no arguments at all until now, which meant it could only ever answer
 * for the signed-in user and only for today's leave year. Its one caller is
 * the leave card on an employee's record — so HR opening somebody else's Leave
 * tab was shown *their own* allowance under that employee's name, and the leave
 * year filter on that card could not move it.
 *
 * Called with no arguments it behaves exactly as before.
 *
 * @param {{ slug?: string, leaveYear?: string }} [input] `slug` is the
 *   encrypted employee id; it goes through the usual access rule, so asking
 *   about somebody else without the permission answers for you.
 */
export async function getEmployeeLeaveData(input) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const sessionId = props?.session?.user?._id;

    const scoped = input ? Object.hasOwn(input, "slug") : false;
    const { employeeId: targetId } = scoped
      ? await resolveEmployeeTarget(safeDecryptId(input.slug))
      : { employeeId: sessionId };

    const employeeId = targetId || sessionId;
    const leaveYear = input?.leaveYear || getLeaveYearString(new Date());

    // A year nobody has set entitlements for is ordinary, not an error — the
    // card above simply has nothing to show. Translated here rather than in
    // getLeaveData, whose other callers want the miss to read as a failure so
    // they create the missing record.
    const data = await getLeaveData(employeeId, leaveYear);
    if (data?.notFound) return { success: true, data: null };
    return data;
  } catch (error) {
    console.log(" Error fetching employee leave data:", error);
    return { success: false, message: "Error fetching employee leave data" }; // Return a default value
  }
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

// Removed here: syncMissingLeaveTypes, checkWithStoreLeaveType,
// storeEmployeeLeave, checkEligibility and editLeaveRequest.
//
// All five were dead — nothing in the application called them — and all five
// were broken the same way, which is almost certainly why they were abandoned
// rather than maintained. CommonLeave.leaveYear is a String like "2026-27",
// written by getLeaveYearString(). These passed a number:
// `new Date().getFullYear()` and `getYear(new Date())`, which Mongoose casts to
// "2026". That matches nothing, ever.
//
// So the lookups could not succeed. syncMissingLeaveTypes always fell to its
// else branch and created a second CommonLeave row for an employee who already
// had one — the "branch on falsy" was not a style choice, it was the only
// branch that ever ran. storeEmployeeLeave's balance update silently matched no
// document, while editLeaveRequest, which it calls, really did rewrite the
// leave request: leave edited, balance untouched.
//
// The working versions are in countLeaveServer.js — syncMissingLeaveTypesNew,
// which is what the scan button and handleOfficeEmployee actually call, and
// which builds its leave year with getLeaveYearString(). Booking goes through
// storeEmployeeLeaveData in leaveRequestServer.js.
//
// Deleted rather than repaired because two of them were exported "use server"
// functions, which are addressable endpoints whether or not a button points at
// them — and because working replacements already exist.
//
// isDateOverLapping is kept below: exported, read-only, no year bug. It simply
// has no caller at the moment.

export async function isDateOverLapping(employeeId, data, id) {
  try {
    await connect();
    const requestId = id && { _id: { $ne: new mongoose.Types.ObjectId(id) } };
    const ObjectIdEmployee = new mongoose.Types.ObjectId(employeeId);
    // check only with status pending
    const overLappingRequests = await LeaveRequestModel.find({
      ObjectIdEmployee,
      requestId,
      $or: [{ leaveStatus: "Pending" }, { leaveStatus: "Approved" }],
      $or: [
        {
          leaveStartDate: { $lte: data.leaveEndDate },
          leaveEndDate: { $gte: data.leaveStartDate },
        },
      ],
    });
    return overLappingRequests.length > 0;
  } catch (error) {
    console.log("Error fetching overlapping leave requests", error);
    return true;
  }
}

