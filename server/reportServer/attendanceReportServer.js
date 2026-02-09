"use server";

import { connect } from "@/db/db";
import { createObjectId } from "@/lib/mongodb";
import ClockRecordModel from "@/models/clockInModel";

export async function getAttendanceReportData(params) {
  let query = { isDeleted: false };
  if (params) {
    const { startDate, endDate, employeeId, leaveYear } = params;

    if (startDate && endDate) {
      query.attendanceDates = {
        $elemMatch: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };
    }
    if (employeeId && employeeId !== "all") {
      query.employeeId = createObjectId(employeeId);
    }

    if (leaveYear && leaveYear !== "all") {
      const year = parseInt(leaveYear, 10);
      const startOfYear = new Date(year, 0, 1);
      const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

      query.date = {
        $gte: startOfYear,
        $lte: endOfYear,
      };
    }
  }

  try {
    await connect();

    const pipeline = [
      { $match: query },
      // 1. Lookup from Office Employees
      {
        $lookup: {
          from: "officeemployes",
          localField: "employeeId",
          foreignField: "_id",
          as: "officeInfo",
        },
      },
      // 2. Lookup from General Employees
      {
        $lookup: {
          from: "employees",
          localField: "employeeId",
          foreignField: "_id",
          as: "generalInfo",
        },
      },
      // 3. Merge them into a single object
      {
        $addFields: {
          employeeDetails: {
            $cond: [
              { $eq: ["$employeeType", "OfficeEmployee"] },
              { $arrayElemAt: ["$officeInfo", 0] },
              { $arrayElemAt: ["$generalInfo", 0] },
            ],
          },
        },
      },
      // 4. Remove the temporary arrays
      { $project: { officeInfo: 0, generalInfo: 0 } },
      { $unwind: "$employeeDetails" }, // Unwind the merged object
      {
        $facet: {
          tableData: [
            {
              $project: {
                _id: 1,
                employeeName: {
                  $cond: [
                    { $eq: ["$employeeType", "OfficeEmployee"] },
                    "$employeeDetails.name", // Field from officeemployes
                    {
                      $concat: [
                        "$employeeDetails.firstName", // Field from employees
                        " ",
                        "$employeeDetails.lastName",
                      ],
                    },
                  ],
                },
                date: 1,
                clockIn: 1,
                clockOut: 1,
                breaks: 1,
                overtime: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
          chartData: [
            {
              $group: {
                _id: "$employeeId",
                // We use $first to grab these fields from the documents being grouped
                employeeType: { $first: "$employeeType" },
                firstName: { $first: "$employeeDetails.firstName" },
                lastName: { $first: "$employeeDetails.lastName" },
                officeName: { $first: "$employeeDetails.name" },
                totalDays: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 1,
                totalDays: 1,
                // Now we perform the logic AFTER the grouping
                name: {
                  $cond: [
                    { $eq: ["$employeeType", "OfficeEmployee"] },
                    "$officeName",
                    { $concat: ["$firstName", " ", "$lastName"] },
                  ],
                },
              },
            },
          ],
        },
      },
    ];

    const attendanceData = await ClockRecordModel.aggregate(pipeline);
    const newData = attendanceData[0] || {};
    const data = {
      list: newData.tableData || [],
      totalCount:
        newData.totalCount && newData.totalCount.length > 0
          ? newData.totalCount[0].count
          : 0,
      chartData: newData.chartData || [],
    };
    return {
      success: true,
      data: JSON.stringify(data),
    };
  } catch (error) {
    console.error("Error fetching attendance report data:", error);
    return {
      success: false,
      message: "Failed to fetch attendance report data.",
    };
  }
}
