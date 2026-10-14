"use server";

import { connect } from "@/db/db";
import { createObjectId } from "@/lib/mongodb";
import { toWorkingDate } from "@/lib/clockTime";
import ClockRecordModel from "@/models/clockInModel";
import { permissionRefusal } from "@/lib/actionAccess";

/**
 * The reporting screens under /admin/report. There is no menu entry for them,
 * so proxy.js finds no menu item and sends everyone but a super admin to the
 * dashboard — super-admin-only in practice, which is what this reproduces.
 * These return every employee's attendance or leave for a date range.
 */
const OWNS = ["/admin/report"];

export async function getAttendanceReportData(params) {
  const denied = await permissionRefusal(OWNS);
  if (denied) return denied;

  let query = { isDeleted: false };
  if (params) {
    const { startDate, endDate, employeeId, leaveYear } = params;

    // THE DATE FILTER MATCHED NOTHING, EVER.
    //
    // It read `attendanceDates`, as an array, with $elemMatch. No clock record
    // has ever had such a field — it is written nowhere in this codebase, and
    // zero of the rows in production carry it. The shape belongs to the site
    // attendance collection, which really does hold an array of dated entries
    // (server/attendanceServer/attendanceServer.js); on a clock record the
    // working day is a single `date` at UTC midnight.
    //
    // So the report came back empty the moment anybody picked a date range,
    // which is the normal way to use it — and it looked like the clock-ins had
    // never been written rather than like the filter was wrong.
    //
    // Normalised through toWorkingDate because `date` is stored at UTC
    // midnight: a plain `new Date(endDate)` carrying a time of day excludes the
    // end day itself for some timezones and includes it for others, which is
    // the sort of bug that only shows up as "yesterday is missing".
    const dateRanges = [];

    const from = toWorkingDate(startDate);
    const to = toWorkingDate(endDate);
    if (from && to) dateRanges.push({ $gte: from, $lte: to });

    if (employeeId && employeeId !== "all") {
      query.employeeId = createObjectId(employeeId);
    }

    if (leaveYear && leaveYear !== "all") {
      const year = parseInt(leaveYear, 10);
      if (Number.isFinite(year)) {
        dateRanges.push({
          $gte: new Date(Date.UTC(year, 0, 1)),
          $lte: new Date(Date.UTC(year, 11, 31)),
        });
      }
    }

    // Both narrow the same field, so they are ANDed rather than assigned —
    // whichever was written second used to silently replace the first, so
    // picking a range AND a year gave the year alone.
    if (dateRanges.length === 1) {
      query.date = dateRanges[0];
    } else if (dateRanges.length > 1) {
      query.$and = dateRanges.map((range) => ({ date: range }));
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
          from: "employes",
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
