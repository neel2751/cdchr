"use server";

import { connect } from "@/db/db";
import LeaveRequestModel from "@/models/leaveRequestModel";

export async function getDepartmentWiseLeaveCount() {
  try {
    await connect();
    const pipeline = [
      {
        $lookup: {
          from: "officeemployes",
          localField: "employeeId",
          foreignField: "_id",
          as: "employee",
        },
      },
      {
        $unwind: "$employee",
      },
      {
        $lookup: {
          from: "roletypes",
          localField: "employee.department",
          foreignField: "_id",
          as: "department",
        },
      },
      {
        $unwind: "$department",
      },
      {
        $group: {
          _id: "$department.roleTitle",
          count: { $sum: 1 }, // count the number of documents
          pending: {
            $sum: {
              $cond: {
                if: { $eq: ["$leaveStatus", "Pending"] },
                then: 1,
                else: 0,
              },
            },
          },
          approved: {
            $sum: {
              $cond: {
                if: { $eq: ["$leaveStatus", "Approved"] },
                then: 1,
                else: 0,
              },
            },
          },
          rejected: {
            $sum: {
              $cond: {
                if: { $eq: ["$leaveStatus", "Rejected"] },
                then: 1,
                else: 0,
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          department: "$_id",
          count: 1,
          pending: 1,
          approved: 1,
          rejected: 1,
        },
      },
    ];
    const result = await LeaveRequestModel.aggregate(pipeline);
    console.log(result);
    return { success: true, data: JSON.stringify(result) };
  } catch (error) {
    console.log(" Error in getDepartmentWiseLeaveCount", error);
    return { success: false, message: "Something went wrong" };
  }
}

export async function getMonthWiseLeaveCount() {
  try {
    await connect();
    const pipeline = [
      {
        $addFields: {
          month: { $month: "$leaveStartDate" },
          year: { $year: "$leaveStartDate" },
        },
      },
      {
        $group: {
          _id: { month: "$month", year: "$year" },
          count: { $sum: 1 },
        },
      },
      {
        $addFields: {
          monthName: {
            $arrayElemAt: [
              [
                "JAN",
                "FEB",
                "MAR",
                "APR",
                "MAY",
                "JUN",
                " JUL",
                "AUG",
                "SEP",
                "OCT",
                "NOV",
                "DEC",
              ],
              { $subtract: ["$_id.month", 1] },
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          monthName: 1,
          count: 1,
        },
      },
      {
        $sort: {
          year: 1,
          monthName: 1,
        },
      },
    ];
    const result = await LeaveRequestModel.aggregate(pipeline);
    console.log(result);
    return { success: true, data: JSON.stringify(result) };
  } catch (error) {
    console.log(" Error in getMonthWiseLeaveCount", error);
    return { success: false, message: "Something went wrong" };
  }
}

export async function getMonthWiseLeaveCountWithType() {
  try {
    await connect();
    const pipeline = [
      {
        $addFields: {
          month: { $month: "$leaveStartDate" },
        },
      },
      {
        $group: {
          _id: { month: "$month", leaveType: "$leaveType" },
          count: { $sum: 1 },
        },
      },
      {
        $addFields: {
          monthName: {
            $arrayElemAt: [
              [
                "JAN",
                "FEB",
                "MAR",
                "APR",
                "MAY",
                "JUN",
                "JUL",
                "AUG",
                "SEP",
                "OCT",
                "NOV",
                "DEC",
              ],
              { $subtract: ["$_id.month", 1] },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$monthName",
          leaveTypes: {
            $push: {
              leaveType: "$_id.leaveType",
              totalLeaves: "$count",
              pending: "$pending",
              approved: "$approved",
              rejected: "$rejected",
            },
          },
        },
      },
      {
        $project: {
          month: "$_id",
          leaveTypes: 1,
          _id: 0,
        },
      },
      {
        $sort: { month: 1 }, // Sort by month (chronological order)
      },
    ];
    const result = await LeaveRequestModel.aggregate(pipeline);
    console.log(result[0].leaveTypes);
    return { success: true, data: JSON.stringify(result) };
  } catch (error) {
    console.error(" Error fetching leave data:", error);
    return { success: false, error: error.message };
  }
}
