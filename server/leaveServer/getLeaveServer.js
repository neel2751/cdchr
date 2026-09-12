"use server";
import { connect } from "@/db/db";
import { getServerSideProps } from "../session/session";
import { getYear, isPast } from "date-fns";
import LeaveRequestModel from "@/models/leaveRequestModel";
import CommonLeaveModel from "@/models/commonLeaveModel";
import { createObjectId, withTransaction } from "@/lib/mongodb";
import { validateLeaveData } from "./helper/helper";
import RoleBasedModel from "@/models/rolebasedModel";
import { getLeaveYearString } from "@/helper/getLeaveYearString";
import { normalizeDateToUTC } from "@/lib/formatDate";
import { getLeaveSettings } from "../leaveSettingServer";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { withAudit, recordAudit } from "@/lib/audit";

export async function getLeaveRequestData(leaveYear) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const role = props?.session?.user?.role;
    if (!employeeId) return { success: false, message: "Employee not found" };
    await connect();
    const checLeaveYear = Number(parseInt(leaveYear))
      ? Number(parseInt(leaveYear))
      : getYear(new Date());

    // Assign match condition based on role

    const match =
      role === "superAdmin"
        ? { leaveYear: checLeaveYear }
        : {
            employeeId: createObjectId(employeeId),
            leaveYear: checLeaveYear,
          };
    const lookup =
      role === "superAdmin"
        ? {
            from: "officeemployes",
            localField: "employeeId",
            foreignField: "_id",
            as: "employees",
          }
        : {};
    const approveLookup = {
      from: "officeemployes",
      localField: "approvedBy",
      foreignField: "_id",
      as: "admin",
    };

    const pipeline = [
      // Match
      {
        $match: match,
      },
      // Sort
      {
        $sort: {
          leaveSubmitDate: -1,
        },
      },
      // Lookup with superadmin and admin
      {
        $lookup: lookup,
      },
      {
        $lookup: approveLookup,
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$$ROOT",
              {
                employee: {
                  name: { $arrayElemAt: ["$employees.name", 0] },
                  role: { $arrayElemAt: ["$employees.roleType", 0] },
                },
                approvedBy: {
                  name: { $arrayElemAt: ["$admin.name", 0] },
                },
              },
            ],
          },
        },
      },
    ];
    const leaveData = await LeaveRequestModel.aggregate(pipeline);
    return { success: true, data: JSON.stringify(leaveData) };
  } catch (error) {
    console.log("Error fetching leave request data", error);
    return { success: false, message: "Error fetching leave request data" };
  }
}

// Maps an array of leave dates to their UTC calendar day ("yyyy-MM-dd").
// Dates are stored at UTC midnight, but comparing the raw instants would make a
// single stray timestamp look like a different day, so the day string is the
// safer key for set operations.
function utcDayKeys(field) {
  return {
    $map: {
      input: { $ifNull: [field, []] },
      as: "d",
      in: {
        $dateToString: {
          date: { $toDate: "$$d" },
          format: "%Y-%m-%d",
          timezone: "UTC",
        },
      },
    },
  };
}

export async function getLeaveRequestDataAdmin(filterData) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const role = props?.session?.user?.role;
    if (!employeeId) return { success: false, message: "Employee not found" };
    const roles = await RoleBasedModel.find({
      employeeId,
      isDeleted: false,
    })
      .lean()
      .exec();
    const permissions = roles.flatMap((r) => r.permissions);
    const isPermission = permissions.includes("/admin/leaveManagement");

    await connect();
    const {
      leaveYear,
      page,
      limit,
      leaveStatus,
      fromDate,
      toDate,
      employeeId: filterEmployeeId,
    } = filterData;

    // before apply page and limit we have to convert them to number and set default values
    const validPage =
      Number.isInteger(parseInt(page)) && parseInt(page) > 0
        ? parseInt(page)
        : 1;
    const validLimit =
      Number.isInteger(parseInt(limit)) && parseInt(limit) > 0
        ? parseInt(limit)
        : 10;
    const skip = (validPage - 1) * validLimit;
    const canSeeEveryone = role === "superAdmin" || isPermission;
    const match = canSeeEveryone
      ? {}
      : { employeeId: createObjectId(employeeId) };

    // Employee-wise filter. Only meaningful for someone who can see every
    // request — a normal employee stays pinned to their own rows above.
    if (canSeeEveryone && filterEmployeeId && filterEmployeeId !== "All") {
      match.employeeId = createObjectId(filterEmployeeId);
    }

    if (leaveYear) {
      match.leaveYear = leaveYear;
    } else {
      match.leaveYear = getLeaveYearString(new Date());
    }

    if (fromDate && toDate) {
      match.leaveDates = {
        $elemMatch: {
          $gte: normalizeDateToUTC(new Date(fromDate)),
          $lte: normalizeDateToUTC(new Date(toDate)),
        },
      };
    }

    console.log("Leave Status Filter:", match);

    if (leaveStatus && leaveStatus !== "All") {
      match.leaveStatus = leaveStatus;
    }
    const lookup =
      role === "superAdmin" || isPermission
        ? {
            from: "officeemployes",
            localField: "employeeId",
            foreignField: "_id",
            as: "employees",
          }
        : {};

    const approveLookup = {
      from: "officeemployes",
      localField: "approvedBy",
      foreignField: "_id",
      as: "admin",
    };
    // Everything below the page slice is joined per row, so it is built
    // separately and run inside the $facet *after* $skip/$limit. Joining first
    // and paginating afterwards made every request in the leave year pay for
    // three lookups to render ten rows.
    const enrichStages = [
      {
        $lookup: lookup,
      },
      {
        $lookup: approveLookup,
      },
      // Overlaps are matched on the actual booked days, not on the
      // start/end envelope. Leave is stored as a list of scattered dates
      // (`leaveDates`), so two requests can share an envelope without sharing a
      // single day — and a request with gaps used to report days it never
      // booked. Comparing the UTC calendar day of each date keeps this in step
      // with the holiday planner, which keys the same dates the same way.
      {
        $lookup: {
          from: "leaverequests", // Self-join on the same collection
          let: {
            selfId: "$_id",
            employeeId: "$employeeId",
            dayKeys: utcDayKeys("$leaveDates"),
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$_id", "$$selfId"] },
                    { $ne: ["$employeeId", "$$employeeId"] },
                    { $in: ["$leaveStatus", ["Pending", "Approved"]] }, // ✅ Only active leaves
                    { $ne: ["$isDeleted", true] },
                    {
                      $gt: [
                        {
                          $size: {
                            $setIntersection: [
                              utcDayKeys("$leaveDates"),
                              "$$dayKeys",
                            ],
                          },
                        },
                        0,
                      ],
                    },
                  ],
                },
              },
            },
            {
              $lookup: {
                from: "officeemployes", // Lookup to get employee details
                localField: "employeeId", // Use `employeeId` from the matching leave requests
                foreignField: "_id", // Match it with the `_id` field in `officeemployees`
                as: "overlapEmployee", // Name the field in the output
              },
            },
            {
              $unwind: {
                path: "$overlapEmployee",
                preserveNullAndEmptyArrays: true,
              }, // Unwind the result to make employee data accessible
            },
            {
              $project: {
                _id: 1,
                employeeId: 1,
                leaveStartDate: 1,
                leaveEndDate: 1,
                leaveDates: 1,
                leaveType: 1,
                leaveStatus: 1,
                leaveDays: 1,
                leaveSubmitDate: 1,
                isHalfDay: 1,
                halfDayType: 1,
                employeeName: "$overlapEmployee.name", // Project the employee name
                overlappingDates: {
                  $setIntersection: [utcDayKeys("$leaveDates"), "$$dayKeys"],
                },
                overLappingDays: {
                  $size: {
                    $setIntersection: [utcDayKeys("$leaveDates"), "$$dayKeys"],
                  },
                },
              },
            },
            { $sort: { leaveStartDate: 1 } },
          ],
          as: "overlappingRequests",
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$$ROOT",
              {
                employee: {
                  name: { $arrayElemAt: ["$employees.name", 0] },
                  role: { $arrayElemAt: ["$employees.roleType", 0] },
                },
                approvedBy: {
                  name: { $arrayElemAt: ["$admin.name", 0] },
                },
              },
            ],
          },
        },
      },
      {
        $unset: ["employees", "admin"], // Remove the arrays
      },
    ];

    const pipeline = [
      {
        $match: match,
      },
      {
        $sort: {
          leaveSubmitDate: -1,
        },
      },
      {
        $facet: {
          data: [
            { $skip: skip }, // Skip for pagination
            { $limit: validLimit }, // Limit the number of results
            ...enrichStages, // Joins only the rows on this page
          ],
          totalCount: [{ $count: "count" }], // Count total documents
        },
      },
      {
        // An empty result set produces an empty totalCount array. Unwinding it
        // without this flag threw the whole document away, so a filter that
        // matched nothing surfaced as an error instead of an empty table.
        $unwind: { path: "$totalCount", preserveNullAndEmptyArrays: true },
      },
    ];

    const leaveData = await LeaveRequestModel.aggregate(pipeline);
    return {
      success: true,
      data: JSON.stringify(leaveData[0]?.data ?? []),
      totalCount: leaveData[0]?.totalCount?.count ?? 0,
    }; // Return the data as a string
  } catch (error) {
    console.log("Get Leave Request Data for Admin", error);
    return { success: false, message: "Failed to get leave request data" };
  }
}

export const handleEmployeeLeaveStatus = withAudit(
  "Leave.status",
  async (data) => {
    try {
      const { props } = await getServerSideProps();
      const { _id: approvedBy } = props?.session?.user;
      const approvedDate = new Date();
      const newData = { ...data, approvedBy, approvedDate };
      const before = await LeaveRequestModel.findById(data?.leaveId).lean();
      if (data?.leaveStatus === "Approved") {
        const updatedLeave = await LeaveRequestModel.updateOne(
          { _id: data.leaveId },
          {
            $set: newData,
          }
        );
        recordAudit({
          entityId: data?.leaveId,
          before,
          after: await LeaveRequestModel.findById(data?.leaveId).lean(),
          description: `Approved leave request ${data?.leaveId}`,
        });
        return { success: true, message: "Leave status updated successfully" };
      } else {
        await rejectLeaveRequest(data?.leaveId, approvedBy, data?.adminComment);
        recordAudit({
          entityId: data?.leaveId,
          before,
          after: await LeaveRequestModel.findById(data?.leaveId).lean(),
          description: `Rejected leave request ${data?.leaveId}`,
        });
        return { success: true, message: "Leave Rejected Successfully..." };
      }
    } catch (error) {
      console.log("Error updating leave request status", error);
      return { success: false, message: "Error updating leave request status" };
    }
  },
  { module: "Leave" },
);

async function rejectLeaveRequest(requestId, adminId, adminComment = "") {
  return await withTransaction(async (session) => {
    const leaveRequest = await LeaveRequestModel.findById(requestId).session(
      session
    );
    if (!leaveRequest) throw new Error("Leave request not found");
    if (
      leaveRequest?.leaveStatus === "Approved" ||
      leaveRequest?.leaveStatus === "Rejected"
    )
      throw new Error("Leave is alreday approved or rejected");
    const { employeeId, leaveYear, leaveType } = leaveRequest;
    const { commonLeave, leaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
    });
    const used = leaveData?.used - leaveRequest?.leaveDays;
    const remaining = leaveData?.remaining + leaveRequest?.leaveDays;

    const newLeaveData = {
      ...leaveData,
      used,
      remaining,
    };
    commonLeave.leaveData = commonLeave.leaveData.map((leave) =>
      leave.leaveType === leaveRequest.leaveType ? newLeaveData : leave
    );

    await commonLeave.save({ session });
    //Step 5: Update the leave request status and add admin rejectoin deatils
    leaveRequest.leaveStatus = "Rejected";
    leaveRequest.approvedBy = adminId;
    leaveRequest.approvedDate = new Date();
    leaveRequest.rejectedBy = adminId;
    leaveRequest.adminComment = adminComment
      ? adminComment
      : isPast(leaveRequest?.leaveStartDate)
      ? "Leave request is rejected due to past date"
      : adminComment;
    await leaveRequest.save({ session });
    return { success: true, message: "Reject Leave Successfully..." };
  });
}

export async function rejectPastLeaveRequest(requestId, leaveStatus) {
  return await withTransaction(async (session) => {
    const { props } = await getServerSideProps();
    const adminId = props.session.user?._id;
    const leaveRequest = await LeaveRequestModel.findById(requestId).session(
      session
    );
    if (!leaveRequest) throw new Error("Leave request not found");
    if (
      leaveRequest?.leaveStatus === "Approved" ||
      leaveRequest?.leaveStatus === "Rejected" ||
      leaveRequest?.leaveStatus === "Cancelled" ||
      leaveRequest?.leaveStatus === "Expired" ||
      // A rolled back request has already had its days returned; cancelling it
      // again would credit the same balance twice.
      leaveRequest?.leaveStatus === "Rolled Back"
    )
      throw new Error("Leave is alreday approved or rejected");
    const { employeeId, leaveYear, leaveType } = leaveRequest;
    const { commonLeave, leaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
    });
    const used = leaveData?.used - leaveRequest?.leaveDays;
    const remaining = leaveData?.remaining + leaveRequest?.leaveDays;

    const newLeaveData = {
      ...leaveData,
      used,
      remaining,
    };
    commonLeave.leaveData = commonLeave.leaveData.map((leave) =>
      leave.leaveType === leaveRequest.leaveType ? newLeaveData : leave
    );

    await commonLeave.save({ session });
    //Step 5: Update the leave request status and add admin rejectoin deatils
    leaveRequest.leaveStatus = leaveStatus || "Rejected";
    leaveRequest.rejectedBy = adminId;
    leaveRequest.wasExpired = leaveStatus === "Expired" ? true : false;
    leaveRequest.adminComment =
      leaveStatus === "Expired"
        ? "Leave request is expired due to past date"
        : leaveStatus === "Cancelled"
        ? "Leave request is cancelled by admin"
        : leaveRequest.adminComment;
    await leaveRequest.save({ session });
    return { success: true, message: "Reject Leave Successfully..." };
  });
}

/**
 * Undo an approved leave. Reserved for super admins.
 *
 * The request is never removed — it keeps its place in the history with a
 * "Rolled Back" status and a record of who reversed it and why. A reason is
 * mandatory: without it the action is refused. Days are handed back to the
 * employee's balance the same way they were taken (unpaid leave only tracks
 * `used`, so only `used` is unwound for it).
 */
export const rollbackLeaveRequest = withAudit(
  "Leave.rollback",
  async ({ leaveId, reason } = {}) => {
    try {
      const { props } = await getServerSideProps();
      const user = props?.session?.user;

      if (user?.role !== "superAdmin") {
        return {
          success: false,
          message: "Only a super admin can roll back an approved leave",
        };
      }

      const rollbackReason = (reason || "").trim();
      if (rollbackReason.length < 5) {
        return {
          success: false,
          message: "A reason is required to roll back a leave request",
        };
      }

      await connect();

      const before = await LeaveRequestModel.findById(leaveId).lean();
      if (!before) {
        return { success: false, message: "Leave request not found" };
      }

      const result = await withTransaction(async (session) => {
        const leaveRequest = await LeaveRequestModel.findById(leaveId).session(
          session
        );
        if (!leaveRequest) throw new Error("Leave request not found");

        if (leaveRequest.leaveStatus !== "Approved") {
          throw new Error(
            `Only an approved leave can be rolled back. This request is ${leaveRequest.leaveStatus}.`
          );
        }

        const { employeeId, leaveYear, leaveType, leaveDays } = leaveRequest;

        const commonLeave = await CommonLeaveModel.findOne({
          employeeId: createObjectId(employeeId),
          leaveYear,
        }).session(session);

        if (!commonLeave) {
          throw new Error(
            `No leave balance found for ${leaveYear}. Restore the entitlement before rolling this back.`
          );
        }

        const index = commonLeave.leaveData.findIndex(
          (leave) => leave.leaveType === leaveType
        );
        if (index === -1) {
          throw new Error(
            `${leaveType} is not configured for ${leaveYear}. Restore the entitlement before rolling this back.`
          );
        }

        const entitlement = commonLeave.leaveData[index];
        // Never let the unwind push `used` below zero — an older record edited
        // by hand could otherwise leave the balance inconsistent.
        entitlement.used = Math.max((entitlement.used || 0) - leaveDays, 0);
        if (leaveType !== "Unpaid Leave") {
          entitlement.remaining = (entitlement.remaining || 0) + leaveDays;
        }

        commonLeave.leaveHistory.push({
          action: "Leave.rollback",
          leaveType,
          leaveYear,
          leaveDays,
          leaveDates: leaveRequest.leaveDates,
          leaveRequestId: leaveRequest._id,
          reason: rollbackReason,
          updateAt: new Date(),
          updatedBy: user?._id,
          updatedByName: user?.name || "System",
          role: user?.role,
        });

        commonLeave.markModified("leaveData");
        await commonLeave.save({ session });

        leaveRequest.rollback = {
          reason: rollbackReason,
          previousStatus: leaveRequest.leaveStatus,
          rolledBackBy: user?._id,
          rolledBackAt: new Date(),
          restoredDays: leaveDays,
          restoredLeaveType: leaveType,
        };
        leaveRequest.leaveStatus = "Rolled Back";
        await leaveRequest.save({ session });

        return {
          success: true,
          message: `Leave rolled back. ${leaveDays} day(s) returned to ${leaveType}.`,
        };
      });

      recordAudit({
        entityId: leaveId,
        before,
        after: await LeaveRequestModel.findById(leaveId).lean(),
        description: `Rolled back approved leave ${leaveId}: ${rollbackReason}`,
      });

      return result;
    } catch (error) {
      console.log("Error rolling back leave request", error);
      return { success: false, message: "Error rolling back leave request" };
    }
  },
  { module: "Leave" }
);

export async function editCommonLeave(data) {
  try {
    const {
      value,
      initialValues: { leaveYear, employeeId, leaveType },
    } = data;

    // Step 1: Validate input
    if (!Number.isInteger(value) || value <= 0 || value > 40) {
      return {
        success: false,
        message:
          "Invalid Leave days. Only positive integers greater than 0 are allowed.",
      };
    }

    // fetch the current user session login data
    const { props } = await getServerSideProps();
    const { _id: admin, name, role } = props?.session?.user;

    // call the connection
    await connect();

    // Step 1: Find the common leave document
    const commonLeave = await CommonLeaveModel.findOne(
      {
        employeeId,
        leaveYear,
        "leaveData.leaveType": leaveType,
      },
      { "leaveData.$": 1 } // Fetch only the matched leave type
    );
    if (
      !commonLeave ||
      !commonLeave.leaveData ||
      commonLeave.leaveData.length === 0
    )
      return { success: false, message: "Leave type or employee not found" };

    // Step 3: Calculate new remaining days
    const leaveTypeData = commonLeave.leaveData[0]; // Access the matched leave data
    const { used, total: oldTotal, remaining: oldRemaining } = leaveTypeData;
    if (used > value)
      return {
        success: false,
        message: "New total leave is less then used days",
      };
    const newRemaining = value - used;

    if (newRemaining < 0)
      return { success: false, message: "Invalid Leave days" };

    // Step 4: Prepare history entry
    const historyEntry = {
      updateAt: new Date(),
      updatedBy: admin || "System", // Deafult to system if admin is not found
      updatedByName: name || "System", // Deafult to system if name is not found
      role: role || "system", // Deafult to system if role is not found
      leaveType,
      used,
      oldTotal,
      newTotal: value,
      oldRemaining,
      newRemaining,
    };

    // Step 5: Update the total, remaining, and append to history
    const updateResult = await CommonLeaveModel.updateOne(
      {
        employeeId,
        leaveYear,
        "leaveData.leaveType": leaveType, // Match the leave type
      },
      {
        $set: {
          "leaveData.$.total": value,
          "leaveData.$.remaining": newRemaining, // Update the remaining days
        },
        $push: {
          leaveHistory: historyEntry, // Append the history entry
        },
      }
    );

    if (updateResult.matchedCount === 0)
      return { success: false, message: "Leave type or employee not found" };
    if (updateResult.modifiedCount === 0)
      return { success: false, message: "No changes made to leave data" };

    // Step 6: Return success response
    return { success: true, message: "Leave days updated successfully" };
  } catch (error) {
    console.log("Error editing common leave:", error);
    return { success: false, message: "Error editing common leave." };
  }
}

export async function handleCommonLeaveStatus(data) {
  try {
    const { leaveType, isHide, employeeId, leaveYear } = data;

    if (
      leaveType === "undefined" ||
      leaveType === "null" ||
      leaveType === "" ||
      !leaveType
    )
      return { success: false, message: "Leave type is required" };
    if (isHide === undefined || isHide === null || isHide === "" || !isHide)
      return { success: false, message: "isHide is required" };
    // Step 1: Validate input
    if (!employeeId || !leaveYear) {
      return {
        success: false,
        message: "Employee ID and leave year are required",
      };
    }
    // Some Leave types are not allowed to be hidden
    const notAllowedLeaveTypes = ["Paternity Leave", "Maternity Leave"];
    if (notAllowedLeaveTypes.includes(leaveType) && isHide) {
      return {
        success: false,
        message: `Leave type "${leaveType}" cannot be Visible.`,
      };
    }

    // fetch the current user session login data
    const { props } = await getServerSideProps();
    const { _id: admin, name, role } = props?.session?.user;

    // call the connection
    await connect();

    // Step 1: Find the common leave document
    const commonLeave = await CommonLeaveModel.findOne(
      {
        employeeId,
        leaveYear,
        "leaveData.leaveType": leaveType,
      },
      { "leaveData.$": 1 } // Fetch only the matched leave type
    );
    if (
      !commonLeave ||
      !commonLeave.leaveData ||
      commonLeave.leaveData.length === 0
    )
      return { success: false, message: "Leave type or employee not found" };

    // Step 4: Prepare history entry
    const historyEntry = {
      updateAt: new Date(),
      updatedBy: admin || "System", // Deafult to system if admin is not found
      updatedByName: name || "System", // Deafult to system if name is not found
      role: role || "system", // Deafult to system if role is not found
      leaveType,
      isHide: !isHide,
    };

    // Step 5: Update the total, remaining, and append to history
    const updateResult = await CommonLeaveModel.updateOne(
      {
        employeeId,
        leaveYear,
        "leaveData.leaveType": leaveType, // Match the leave type
      },
      {
        $set: {
          "leaveData.$.isHide": !isHide, // Update the remaining days
        },
        $push: {
          leaveHistory: historyEntry, // Append the history entry
        },
      }
    );

    if (updateResult.matchedCount === 0)
      return { success: false, message: "Leave type or employee not found" };
    if (updateResult.modifiedCount === 0)
      return { success: false, message: "No changes made to leave data" };

    // Step 6: Return success response
    return { success: true, message: "Leave days updated successfully" };
  } catch (error) {
    console.log("Error editing common leave:", error);
    return { success: false, message: "Error editing common leave." };
  }
}

export async function getCommonSpecificLeave({
  employeeId,
  leaveYear,
  specificLeave,
}) {
  try {
    const specificLeaveData = await CommonLeaveModel.aggregate([
      {
        $match: {
          employeeId: createObjectId(employeeId),
          leaveYear,
          // leaveData is a array, so we need to match the specific leave type within it
          "leaveData.leaveType": specificLeave,
        },
      },
      {
        $unwind: "$leaveData", // Deconstructs the leaveData array into multiple documents
      },
      {
        $match: {
          "leaveData.leaveType": specificLeave,
          // You can add more specific conditions here as well
          // For example, "leaveData.startDate": "2025-06-10"
        },
      },
      {
        $project: {
          _id: 0,
          leaveData: 1, // Include only the leaveData object
        },
      },
      {
        $limit: 1, // Since you want to fetch only one leave
      },
    ]).exec();
    return specificLeaveData.length > 0 ? specificLeaveData[0].leaveData : null;
  } catch (error) {
    console.log(error);
    return null;
  }
}

export async function previewCarryForward({ leaveYear }) {
  await connect();

  const settings = await getLeaveSettings();

  if (!settings?.data?.carryForwardEnabled) {
    throw new Error("Carry forward is disabled in settings");
  }
  const rules = settings?.data?.carryForwardRules || [];

  const commonLeaves = await CommonLeaveModel.find({
    leaveYear,
  })
    .populate("employeeId", "name")
    .lean();

  const preview = [];

  for (const common of commonLeaves) {
    for (const leave of common.leaveData) {
      if (leave.leaveType === "Unpaid Leave") continue;

      const rule = rules.find((r) => r.leaveType === leave.leaveType);

      const remaining = leave.remaining || 0;

      let carryAllowed = false;
      let maxDays = 0;

      if (rule && rule.allowed) {
        carryAllowed = true;
        maxDays = rule.maxDays || 0;
      }

      let willCarry = 0;
      let willExpire = remaining;

      if (carryAllowed && remaining > 0) {
        willCarry = Math.min(remaining, maxDays);
        willExpire = remaining - willCarry;
      }

      // Default entitlement for next year (you probably already store this)
      const newYearEntitlement = leave.defaultEntitlement || leave.total || 0;

      const newTotal = newYearEntitlement + willCarry;

      preview.push({
        employeeName: common.employeeId?.name || "Unknown",
        leaveType: rules?.leaveType || leave.leaveType,
        carryAllowed,
        remaining,
        maxCarryLimit: maxDays,
        willExpire,
        willCarry,
        newYearEntitlement,
        newTotal,
      });
    }
  }

  const result = preview.filter((p) => p.willCarry > 0);

  return {
    success: true,
    leaveYear,
    data: JSON.stringify(result),
  };
}

// export async function getLeaveLiabilityReport() {
//   const employees = await OfficeEmployeeModel.find({ isDeleted: false });

//   const report = [];

//   for (const emp of employees) {
//     const commonLeave = await CommonLeaveModel.findOne({
//       employeeId: emp._id,
//       leaveYear: currentLeaveYear,
//     });

//     if (!commonLeave) continue;

//     const annual = commonLeave.leaveData.find(
//       (l) => l.leaveType === "Annual Leave"
//     );

//     if (!annual) continue;

//     const dailyRate = emp.salary / 260;

//     report.push({
//       employee: emp.name,
//       remainingDays: annual.remaining,
//       dailyRate,
//       liability: annual.remaining * dailyRate,
//     });
//   }

//   return report;
// }

export async function holidayPlanner({ startDate, endDate }) {
  try {
    await connect();

    const plannerData = await LeaveRequestModel.aggregate([
      {
        $match: {
          leaveStatus: "Approved",
          leaveDates: {
            $elemMatch: {
              $gte: normalizeDateToUTC(startDate),
              $lte: normalizeDateToUTC(endDate),
            },
          },
        },
      },
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
        $project: {
          _id: 1,
          employeeId: 1,
          employeeName: "$employee.fullName",
          status: "$leaveStatus",
          leaveType: 1,
          leaveDates: 1,
          isHalfDay: 1,
          halfDayType: 1,
          isPaid: 1,
        },
      },
    ]);

    return { success: true, data: JSON.stringify(plannerData) };
  } catch (error) {
    console.log("Error fetching holiday planner data", error);
    return { success: false, message: "Error fetching holiday planner data" };
  }
}

// Leave dates are stored at UTC midnight. A "yyyy-MM-dd" string is turned into
// exactly that instant; anything else falls back to the old normalisation.
// Running the caller's Date through normalizeDateToUTC used the *server's*
// timezone, which shifted the range by a day whenever the two disagreed — the
// last day of the month then dropped out of the results.
function toUtcRangeBound(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  return normalizeDateToUTC(value);
}

export async function holidayPlannerNew({ startDate, endDate }) {
  await connect();
  const leaves = await LeaveRequestModel.find({
    leaveStatus: "Approved",
    leaveDates: {
      $gte: toUtcRangeBound(startDate),
      $lte: toUtcRangeBound(endDate),
    },
  }).lean();

  const employees = await OfficeEmployeeModel.find(
    { _id: { $in: leaves.map((l) => l.employeeId) } },
    { name: 1 }
  ).lean();

  const employeeMap = Object.fromEntries(
    employees.map((e) => [e._id.toString(), e.name])
  );

  const calendarMap = {};

  leaves.forEach((leave) => {
    leave.leaveDates.forEach((date) => {
      const key = date.toISOString().split("T")[0];
      if (!calendarMap[key]) calendarMap[key] = [];

      calendarMap[key].push({
        employeeId: leave.employeeId,
        employeeName: employeeMap[leave.employeeId.toString()],
        leaveType: leave.leaveType,
        isHalfDay: leave.isHalfDay,
        halfDayType: leave.halfDayType || null,
        isPaid: leave.isPaid,
        status: leave.leaveStatus,
        leaveDates: leave.leaveDates,
        leaveSubmitDate: leave.leaveSubmitDate,
      });
    });
  });

  return { success: true, data: JSON.stringify(calendarMap) };
}
