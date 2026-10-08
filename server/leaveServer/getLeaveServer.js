"use server";
import { connect } from "@/db/db";
import { requireEntitlementAccess } from "@/lib/employeeAccess";
import { hasStatutoryFloor, maxTotalFor } from "@/data/leaveTypes";
import { resolveCarryForward } from "@/lib/carryForward";
import {
  annualLeaveForYear,
  boundsForLeaveYear,
} from "@/lib/leaveEntitlement";
import { getServerSideProps } from "../session/session";
import { getYear, isPast } from "date-fns";
import LeaveRequestModel from "@/models/leaveRequestModel";
import CommonLeaveModel from "@/models/commonLeaveModel";
import { createObjectId, withTransaction } from "@/lib/mongodb";
import { validateLeaveData, refundLeaveDays } from "./helper/helper";
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
    // Only a super admin lists other people's requests, so only they need the
    // employee join. Everyone else sees their own, where the name is already
    // known. The stage is left out entirely rather than pushed as `{}` —
    // MongoDB rejects an empty $lookup with "must specify 'pipeline' when
    // 'from' is empty" and fails the whole pipeline.
    const lookup =
      role === "superAdmin"
        ? {
            from: "officeemployes",
            localField: "employeeId",
            foreignField: "_id",
            as: "employees",
          }
        : null;
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
      ...(lookup ? [{ $lookup: lookup }] : []),
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
    // Same as above: omitted rather than pushed as an empty object, which
    // MongoDB rejects and which failed this pipeline for every role below
    // super admin.
    const lookup =
      role === "superAdmin" || isPermission
        ? {
            from: "officeemployes",
            localField: "employeeId",
            foreignField: "_id",
            as: "employees",
          }
        : null;

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
      // Omitted entirely when there is no employee join to make, rather than
      // pushed as an empty object: MongoDB rejects an empty $lookup with "must
      // specify 'pipeline' when 'from' is empty" and fails the whole pipeline,
      // which is what broke this list for every role below super admin.
      ...(lookup ? [{ $lookup: lookup }] : []),
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
      const before = await LeaveRequestModel.findById(data?.leaveId).lean();
      if (data?.leaveStatus === "Approved") {
        // Only the three fields an approval actually changes.
        //
        // This used to be `$set: { ...data, approvedBy, approvedDate }` — the
        // whole client payload written straight onto the request. Approving is
        // a permission to change a *status*, but that spread also accepted
        // leaveDays, leaveDates, leaveType and isPaid from the browser. The
        // balance is spent when the request is created, not when it is
        // approved, so rewriting leaveDays here moved the record out of step
        // with the balance it had already taken, in the one call that looks
        // like it only flips a flag.
        const updatedLeave = await LeaveRequestModel.updateOne(
          { _id: data.leaveId },
          {
            $set: {
              leaveStatus: "Approved",
              approvedBy,
              approvedDate,
              adminComment: data?.adminComment || "",
            },
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
      throw new Error(
        `This request is already ${leaveRequest.leaveStatus.toLowerCase()}, so it cannot be rejected again.`
      );
    const { employeeId, leaveYear, leaveType } = leaveRequest;
    const { commonLeave, leaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
    });
    // Through the shared helper so this agrees with rollbackLeaveRequest:
    // `used` is floored at zero, and an unpaid refund moves `used` only.
    // Refunding unpaid `remaining` here was inventing days the employee never
    // had, since the request path never took any.
    const entitlement = commonLeave.leaveData.find(
      (leave) => leave.leaveType === leaveRequest.leaveType
    );
    refundLeaveDays(entitlement, leaveRequest?.leaveDays, leaveRequest.leaveType);

    commonLeave.markModified("leaveData");
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

/**
 * Withdraw a leave request and hand its days back.
 *
 * Two callers, deliberately:
 *
 *   An admin cancelling or expiring anybody's request, from Leave Management.
 *
 *   An employee withdrawing their *own* request from My Leaves — the buttons
 *   there only appear while a request is still Pending, marking it "Cancelled"
 *   when the leave is in the future and "Expired" when its start date has
 *   already passed. Withdrawing something nobody has approved yet is the
 *   employee's own business, so it does not need an admin.
 *
 * The check is on ownership, not just role. It used to test neither: any
 * signed-in user could cancel any request by id, which is how self-service came
 * to work at all. Requiring an admin instead would have been the other mistake
 * — it would have taken the employee's own withdrawal away with it.
 */
export async function rejectPastLeaveRequest(requestId, leaveStatus) {
  return await withTransaction(async (session) => {
    const { props } = await getServerSideProps();
    const actor = props?.session?.user;
    const adminId = actor?._id;
    if (!adminId) throw new Error("Not signed in");

    const leaveRequest = await LeaveRequestModel.findById(requestId).session(
      session
    );
    if (!leaveRequest) throw new Error("Leave request not found");

    const isAdmin = actor?.role === "superAdmin" || actor?.role === "admin";
    const isOwner =
      String(leaveRequest.employeeId) === String(adminId);

    if (!isAdmin && !isOwner) {
      throw new Error("You can only withdraw your own leave request");
    }

    // "Rejected" is a verdict on somebody else's request, so it stays with the
    // admins. An employee withdrawing their own may only cancel or expire it.
    if (!isAdmin && leaveStatus === "Rejected") {
      throw new Error("Only an admin can reject a leave request");
    }

    // Only a request nobody has ruled on yet can be withdrawn. Everything below
    // has either had its days returned already — returning them twice would
    // credit the balance for leave that was taken once — or is a decision that
    // belongs to an admin to undo.
    const settled = [
      "Approved",
      "Rejected",
      "Cancelled",
      "Expired",
      "Rolled Back",
    ];
    if (settled.includes(leaveRequest?.leaveStatus)) {
      // Worth a full sentence: this is now read by employees withdrawing their
      // own leave, and the useful part is what to do next rather than a bare
      // statement that the request is settled.
      throw new Error(
        leaveRequest.leaveStatus === "Approved"
          ? "This leave has already been approved. Ask an admin to roll it back."
          : `This request is already ${leaveRequest.leaveStatus.toLowerCase()}, so there is nothing to withdraw.`
      );
    }
    const { employeeId, leaveYear, leaveType } = leaveRequest;
    const { commonLeave, leaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
    });
    // Same shared helper as the other two unwind paths — see refundLeaveDays.
    const entitlement = commonLeave.leaveData.find(
      (leave) => leave.leaveType === leaveRequest.leaveType
    );
    refundLeaveDays(entitlement, leaveRequest?.leaveDays, leaveRequest.leaveType);

    commonLeave.markModified("leaveData");
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
        // Both rules this path already had — floor `used` at zero, and leave an
        // unpaid `remaining` alone — now live in refundLeaveDays, so the reject
        // paths share them instead of each re-deriving the arithmetic.
        refundLeaveDays(entitlement, leaveDays, leaveType);

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

/**
 * What this employee is actually entitled to in annual leave for one leave year.
 *
 * The same calculation that produced the stored figure — 5.6 weeks × contracted
 * days, pro-rated by the days employed — read back so an edit can be measured
 * against it. `endDate` is passed, which the generator does not do: a leaver
 * accrues only up to their last day, and this is the one place where knowing
 * that matters, because it is the difference between a correction and a cut.
 *
 * Returns null when it cannot be worked out — no start date, or no contracted
 * week. There is no floor to enforce if there is nothing to derive it from, and
 * inventing one would block an admin from fixing exactly that record.
 */
async function statutoryFloorFor({ employeeId, leaveYear }) {
  try {
    const employee = await OfficeEmployeeModel.findById(employeeId)
      .select("joinDate dayPerWeek endDate")
      .lean();
    if (!employee?.joinDate || !employee?.dayPerWeek) return null;

    const settings = await getLeaveSettings();
    const { start, end } = boundsForLeaveYear(
      leaveYear,
      settings?.data?.leaveYearStartMonth
    );

    return annualLeaveForYear({
      joinDate: employee.joinDate,
      dayPerWeek: employee.dayPerWeek,
      leaveYearStart: start,
      leaveYearEnd: end,
      endDate: employee.endDate || null,
    });
  } catch (error) {
    // Never let this decide the edit is impossible: a floor that cannot be read
    // is no floor, and the ceiling and used-days rules still apply.
    console.log("statutoryFloorFor failed:", error?.message);
    return null;
  }
}

/**
 * Change one employee's allowance for one leave type.
 *
 * EVERY CHANGE NEEDS A REASON. The history entry already recorded who changed
 * what, when, and from which figure to which — everything except the one thing
 * that cannot be reconstructed afterwards. "Their annual leave went from 28 to
 * 22 in March" is answerable from the data; "why" was not, and it is the only
 * question anybody actually asks. So `reason` is required for every edit, not
 * only the alarming ones, and it is enforced here rather than in the form —
 * this is an addressable endpoint, and a rule that lives only in a dialog is
 * not a rule.
 *
 * ZERO IS ALLOWED, AND IT USED NOT TO BE. `value <= 0` was refused outright,
 * which made "this employee gets no study leave this year" unsayable — and it
 * refused a figure the entitlement generator itself produces, because
 * annualLeaveForYear() returns 0 for somebody whose start date is in a later
 * leave year. Zero now means what it says: no allowance.
 *
 * ANNUAL LEAVE IS PROTECTED BY A CALCULATION, NOT A NUMBER. It is the one type
 * with a floor the law sets, and that floor is different for every employee:
 * 5.6 weeks × their contracted week, pro-rated by the days they are actually
 * employed in this leave year. So instead of a constant minimum, the figure is
 * worked out here from the employee's own record and the edit is checked against
 * it. Going below is *allowed* — a leaver accrues less than a full year, and an
 * over-grant has to be correctable — but not silently: the caller has to come
 * back with `acknowledgement: { confirmed: true, reason }`, and the reason is
 * written into the leave history next to the change.
 *
 * That shape is deliberate. A hard refusal would block the legitimate cases; a
 * silent accept is the accident worth preventing — somebody clearing the field
 * and saving, and an employee quietly losing their statutory holiday.
 *
 * @param {Object} data
 * @param {number} data.value the new total, in the unit the row is stored in
 * @param {string} data.reason why — required, 5 to 500 characters
 * @param {{leaveYear: string, employeeId: string, leaveType: string, used?: number}} data.initialValues
 * @param {{confirmed?: boolean}} [data.acknowledgement] required only when the
 *   new figure is below the employee's statutory annual-leave entitlement
 * @returns {Promise<{success: boolean, message: string, requiresConfirmation?: boolean, statutory?: number, unit?: string}>}
 */
export async function editCommonLeave(data) {
  try {
    const {
      value,
      reason: rawReason,
      acknowledgement,
      initialValues: { leaveYear, employeeId, leaveType },
    } = data;

    // Took an employee id and a number from its caller and wrote them to that
    // employee's allowance, with no check at all. See requireEntitlementAccess.
    const refusal = await requireEntitlementAccess(employeeId);
    if (refusal) return refusal;

    // Step 1: Validate the shape of the number. The CEILING is checked further
    // down, once the entitlement row has been read — the limit depends on which
    // leave type this is and on whether the row counts days or weeks, and only
    // the row knows.
    if (!Number.isInteger(value) || value < 0) {
      return {
        success: false,
        message: "Invalid leave days. Whole numbers only, and not negative.",
      };
    }

    // The reason, for every change. Five characters is a low bar on purpose:
    // the aim is to make the lazy path cost slightly more than typing the real
    // answer, not to police prose. The screen offers the common reasons as
    // one-click options, which is what actually keeps the quality up.
    const reason = String(rawReason || "").trim();
    if (reason.length < 5) {
      return {
        success: false,
        message: "Say why this allowance is changing — it goes on the record.",
      };
    }
    if (reason.length > 500) {
      return { success: false, message: "That reason is too long" };
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

    // The ceiling, per leave type.
    //
    // This was a flat `value > 40` on every type, which was wrong in both
    // directions. Too tight: Unpaid Leave starts at 100 and so could never be
    // edited at all, a company sick-pay scheme of more than eight weeks was
    // impossible, and maternity leave is 52 weeks by law. Too loose is not the
    // problem it looks like — the only type with a well-known real range is
    // annual leave, and that is the one where an extra digit quietly grants
    // somebody a year of holiday. So annual leave keeps a tight cap and
    // everything else is bounded by the length of a leave year. The numbers, and
    // the reasoning for each, are in data/leaveTypes.js.
    //
    // `leaveTypeData.type` is what the stored figure counts: "weeks" for
    // maternity and paternity, "days" for everything else.
    const unit = leaveTypeData.type === "weeks" ? "weeks" : "days";
    const ceiling = maxTotalFor(leaveType, unit);
    if (value > ceiling) {
      return {
        success: false,
        message: `${leaveType} cannot be set above ${ceiling} ${unit}.`,
      };
    }

    if (used > value)
      return {
        success: false,
        message: "New total leave is less then used days",
      };

    // The floor, for the one type that has one the law sets.
    //
    // Worked out from this employee's own record rather than from a constant —
    // see hasStatutoryFloor() in data/leaveTypes.js for why a constant cannot
    // express it. `endDate` is included, so a leaver's floor is already their
    // reduced accrual and correcting them down to it needs no confirmation at
    // all; only going below what they are genuinely owed does.
    let belowStatutory = null;
    if (hasStatutoryFloor(leaveType)) {
      const statutory = await statutoryFloorFor({ employeeId, leaveYear });

      if (statutory !== null && value < statutory) {
        // The reason is already in hand; what is missing is the acknowledgement
        // that this figure is knowingly below what the employee is owed. Kept as
        // a separate signal so a caller that never saw the warning cannot
        // stumble past it with a reason that was about something else.
        if (acknowledgement?.confirmed !== true) {
          return {
            success: false,
            // Not an error the caller should just show and give up on: it is a
            // question. The screen opens a confirmation, and comes back with the
            // same edit plus an acknowledgement.
            requiresConfirmation: true,
            statutory,
            unit,
            current: oldTotal,
            proposed: value,
            message:
              value === 0
                ? `This would leave the employee with no annual leave at all. ` +
                  `They are entitled to ${statutory} ${unit} for ${leaveYear}.`
                : `${value} ${unit} is below this employee's entitlement of ` +
                  `${statutory} ${unit} for ${leaveYear}.`,
          };
        }

        belowStatutory = { statutory };
      }
    }
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
      // On every entry, not just the alarming ones. "Their annual leave was cut
      // to 4 days" is a question somebody asks months later, and this is where
      // the answer lives.
      reason,
      // And when the figure was knowingly taken under what the employee is owed,
      // what they were owed at the time — so the entry still makes sense after
      // their contract or start date has moved on.
      ...(belowStatutory
        ? {
            belowStatutory: true,
            statutoryEntitlement: belowStatutory.statutory,
          }
        : {}),
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

    const refusal = await requireEntitlementAccess(employeeId);
    if (refusal) return refusal;

    if (
      leaveType === "undefined" ||
      leaveType === "null" ||
      leaveType === "" ||
      !leaveType
    )
      return { success: false, message: "Leave type is required" };

    // `isHide` is the CURRENT state, and this action flips it. The guard here
    // used to be `|| !isHide`, which rejected `false` — so a visible leave type
    // could never be hidden, only a hidden one revealed. The switch worked in
    // exactly one direction and answered "isHide is required" in the other.
    // What it meant to assert is that a boolean was supplied at all.
    if (typeof isHide !== "boolean") {
      return {
        success: false,
        message: "Whether the leave type is currently hidden must be given",
      };
    }
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
    // More than the name: carry-forward eligibility turns on employment type,
    // department, start date and the employee's personal override.
    .populate(
      "employeeId",
      "name employeType department joinDate dayPerWeek carryForwardOverrides"
    )
    .lean();

  const preview = [];

  for (const common of commonLeaves) {
    for (const leave of common.leaveData) {
      if (leave.leaveType === "Unpaid Leave") continue;

      const rule = rules.find((r) => r.leaveType === leave.leaveType);
      const remaining = leave.remaining || 0;

      // Default entitlement for next year. `defaultEntitlement` is not a field
      // anything writes, so in practice this is last year's total — the closest
      // honest stand-in for a figure that has not been generated yet.
      const newYearEntitlement = leave.defaultEntitlement || leave.total || 0;

      // The shared rule, so this preview and the generator cannot disagree.
      const carried = resolveCarryForward({
        enabled: true, // the caller already threw when the switch is off
        rule,
        previousRemaining: remaining,
        baseTotal: newYearEntitlement,
        leaveType: leave.leaveType,
        unit: leave.type === "weeks" ? "weeks" : "days",
        employee: common.employeeId,
        leaveYearStart: boundsForLeaveYear(
          leaveYear,
          settings?.data?.leaveYearStartMonth,
        ).start,
      });

      preview.push({
        employeeName: common.employeeId?.name || "Unknown",
        eligible: carried.outcome !== "not-eligible",
        // `rules?.leaveType` — the whole array, which has no leaveType, so this
        // was always undefined and fell through to the right value by accident.
        leaveType: leave.leaveType,
        carryAllowed: rule?.allowed === true,
        remaining,
        maxCarryLimit: rule?.maxDays || 0,
        willExpire: carried.lost,
        willCarry: carried.days,
        explanation: carried.explanation,
        newYearEntitlement,
        newTotal: newYearEntitlement + carried.days,
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

// Removed here: holidayPlanner.
//
// The first version of the planner's data source, superseded by
// holidayPlannerNew below. Nothing called it but hooks/useHolidayPlanner.js,
// which was itself a second, abandoned planner that no screen rendered — and
// which keyed its calendar with `toISOString().split("T")[0]`, converting local
// midnight to UTC and so shifting every date back a day through British Summer
// Time. That is the exact bug the live planner's `toDateKey` documents avoiding.
//
// Deleted rather than left in place because an exported "use server" function is
// an addressable endpoint whether or not a button points at it.

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
