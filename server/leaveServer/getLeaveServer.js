"use server";
import { connect } from "@/db/db";
import { getServerSideProps } from "../session/session";
import { format, getYear, isPast } from "date-fns";
import mongoose from "mongoose";
import LeaveRequestModel from "@/models/leaveRequestModel";
import CommonLeaveModel from "@/models/commonLeaveModel";
import { withTransaction } from "@/lib/mongodb";
import { validateLeaveData } from "./helper/helper";

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

    const match =
      role === "superAdmin"
        ? { leaveYear: checLeaveYear }
        : {
            employeeId: new mongoose.Types.ObjectId(employeeId),
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

export async function getLeaveRequestDataAdmin(filterData) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const role = props?.session?.user?.role;
    if (!employeeId) return { success: false, message: "Employee not found" };

    await connect();
    const { leaveYear } = filterData;

    const match =
      role === "superAdmin"
        ? { leaveYear: leaveYear }
        : {
            employeeId: new mongoose.Types.ObjectId(employeeId),
            leaveYear: leaveYear,
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
      {
        $match: match,
      },
      {
        $sort: {
          leaveSubmitDate: -1,
        },
      },
      {
        $lookup: lookup,
      },
      {
        $lookup: approveLookup,
      },
      {
        $lookup: {
          from: "leaverequests", // Self-join on the same collection
          let: {
            startDate: "$leaveStartDate",
            endDate: "$leaveEndDate",
            employeeId: "$employeeId", // ✅ fixed
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$employeeId", "$$employeeId"] },
                    {
                      $lte: [
                        { $toDate: "$leaveStartDate" }, // ✅ convert to Date
                        "$$endDate",
                      ],
                    },
                    {
                      $gte: [
                        { $toDate: "$leaveEndDate" }, // ✅ convert to Date
                        "$$startDate",
                      ],
                    },
                    { $in: ["$leaveStatus", ["Pending", "Approved"]] }, // ✅ Only active leaves
                    {
                      $gte: [
                        { $toDate: "$leaveStartDate" },
                        new Date(), // Today's date in UTC
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
                leaveType: 1,
                leaveStatus: 1,
                leaveDays: 1,
                leaveSubmitDate: 1,
                isHalfDay: 1,
                employeeName: "$overlapEmployee.name", // Project the employee name
                overLappingDays: {
                  $max: [
                    {
                      $add: [
                        {
                          $divide: [
                            {
                              $subtract: [
                                {
                                  $min: [
                                    { $toDate: "$leaveEndDate" },
                                    "$$endDate",
                                  ],
                                },
                                {
                                  $max: [
                                    { $toDate: "$leaveStartDate" },
                                    "$$startDate",
                                  ],
                                },
                              ],
                            },
                            1000 * 60 * 60 * 24,
                          ],
                        },
                        1,
                      ],
                    },
                    0, // clamp to zero
                  ],
                },
              },
            },
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

    const leaveData = await LeaveRequestModel.aggregate(pipeline);
    return { success: true, data: JSON.stringify(leaveData) }; // Return the data as a string
  } catch (error) {
    console.log("Get Leave Request Data for Admin", error);
    return { success: false, message: "Failed to get leave request data" };
  }
}

export async function handleEmployeeLeaveStatus(data) {
  try {
    const { props } = await getServerSideProps();
    const { _id: approvedBy } = props?.session?.user;
    const approvedDate = new Date();
    const newData = { ...data, approvedBy, approvedDate };
    if (data?.leaveStatus === "Approved") {
      const updatedLeave = await LeaveRequestModel.updateOne(
        { _id: data.leaveId },
        {
          $set: newData,
        }
      );
      return { success: true, message: "Leave status updated successfully" };
    } else {
      await rejectLeaveRequest(data?.leaveId, approvedBy, data?.adminComment);
      return { success: true, message: "Leave Rejected Successfully..." };
    }
  } catch (error) {
    console.log("Error updating leave request status", error);
    return { success: false, message: "Error updating leave request status" };
  }
}

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

export async function rejectPastLeaveRequest(requestId) {
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
      leaveRequest?.leaveStatus === "Expired"
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
    leaveRequest.leaveStatus = "Expired";
    leaveRequest.rejectedBy = adminId;
    leaveRequest.wasExpired = true;
    leaveRequest.adminComment = "Leave request is rejected due to past date";
    await leaveRequest.save({ session });
    return { success: true, message: "Reject Leave Successfully..." };
  });
}

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
          employeeId: employeeId,
          leaveYear,
          "leaveData.leaveType": specificLeave, // Initial filter to narrow down documents
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
