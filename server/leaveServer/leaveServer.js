"use server";

import { connect } from "@/db/db";
import CommonLeaveModel from "@/models/commonLeaveModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import mongoose from "mongoose";
import { getServerSideProps } from "../session/session";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { currentLeaveYear, resolveLeaveYear } from "@/lib/leaveYear";
import { createObjectId } from "@/lib/mongodb";
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

// Removed here: storeLeave and countLeave.
//
// The same dead-and-broken pair as the five described further down, and broken
// the same way. CommonLeave.leaveYear is a String like "2026-27", written by
// getLeaveYearString(); countLeave built its document with
// `leaveYear: getYear(new Date())` — a number, which Mongoose casts to "2026".
// That matches nothing, ever, so the row storeLeave wrote could never be read
// back by any screen; it was landfill that also duplicated the employee's real
// entitlement document.
//
// countLeave was also a third, independent implementation of the entitlement
// arithmetic — 28 days flat for full-time, `partTimeDays * 5.6` for part-time,
// no leave year, no pro-rata, and an `accrued` figure computed from weeks since
// the join date that nothing consumed. The one that is actually used is
// generateDefaultLeaves() in countLeaveServer.js, which goes through
// lib/leaveEntitlement.js.
//
// storeLeave had no caller anywhere in the app and countLeave had exactly one:
// storeLeave. Deleted rather than repaired for the reason the note below gives —
// both were exported "use server" functions, which are addressable endpoints
// whether or not a button points at them, and this one wrote to the database.

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

  // The company's own leave year. This read used to be
  // `getLeaveYearString(new Date(), settings?.data?.leaveYearStartMonth)` against
  // the helper in lib/getLeaveYear.js, whose second parameter is `short`, not a
  // start month — so the month was read as a truthy boolean and thrown away, and
  // the table looked up April's leave year whatever the company had chosen. On a
  // January–December company that meant the $lookup below matched nothing and
  // every employee was listed as having no entitlement.
  const leaveYear = await currentLeaveYear();

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
                    { $eq: ["$leaveYear", leaveYear] },
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
          // Needed alongside joinDate and dayPerWeek so the screen can work out
          // the same statutory annual-leave floor the server enforces, and warn
          // *before* a save rather than after. Without endDate the browser would
          // compute a leaver's floor as a full year and warn about a correction
          // that is in fact exactly right — see statutoryFloorFor().
          endDate: 1,
          employeType: 1,
          dayPerWeek: 1,
          // The employee's personal carry-forward exception, so the quick-edit
          // on this table can show its current value instead of opening blank
          // and resetting it on save.
          carryForwardOverrides: 1,
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
    // A $facet with no matches gives `totalCount: []`, so reading `[0].count`
    // off it threw a TypeError — which the catch below turned into "Failed to
    // fetch common leave data". Searching for a name nobody has, or filtering to
    // a department with no staff, reported a server error instead of an empty
    // table.
    const totalCount = employeeWithLeave?.[0]?.totalCount?.[0]?.count ?? 0;
    const result = employeeWithLeave?.[0]?.result ?? [];
    return { success: true, data: JSON.stringify(result), totalCount };
  } catch (error) {
    console.log(" Error in fetchCommonLeave", error);
    return { success: false, message: "Failed to fetch common leave data" };
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
    // resolveLeaveYear, not `|| getLeaveYearString(new Date())`: that default was
    // April's leave year regardless of the company's setting, so an employee at a
    // company on any other year was shown an empty leave card.
    const leaveYear = await resolveLeaveYear(input?.leaveYear);

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

