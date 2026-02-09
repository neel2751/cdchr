"use server";

import { connect } from "@/db/db";
import { normalizeDateToUTC } from "@/lib/formatDate";
import { createObjectId } from "@/lib/mongodb";
import LeaveRequestModel from "@/models/leaveRequestModel";

export async function getLeaveReportData(params) {
  // Simulate fetching data from a database or external API
  let query = { isDeleted: false };
  if (params) {
    const { startDate, endDate, employeeId, leaveType, leaveYear } = params;

    if (startDate && endDate) {
      // we have leaveDates to filter
      query.leaveDates = {
        $elemMatch: {
          $gte: normalizeDateToUTC(new Date(startDate)),
          $lte: normalizeDateToUTC(new Date(endDate)),
        },
      };
    }
    if (employeeId && employeeId !== "all") {
      query.employeeId = createObjectId(employeeId);
    }
    if (leaveType && leaveType !== "all") {
      query.leaveType = leaveType;
    }
    if (leaveYear && leaveYear !== "all") {
      query.leaveYear = leaveYear;
    }
  }

  try {
    await connect();
    const pipeline = [
      {
        $match: query,
      },
      {
        $lookup: {
          from: "officeemployes",
          localField: "employeeId",
          foreignField: "_id",
          as: "employeeDetails",
        },
      },
      {
        $unwind: "$employeeDetails",
      },
      {
        $facet: {
          tableData: [
            {
              $project: {
                _id: 1,
                employeeName: "$employeeDetails.name",
                leaveType: 1,
                leaveYear: 1,
                leaveStartDate: 1,
                leaveEndDate: 1,
                leaveDates: 1,
                leaveDays: 1,
                isHalfDay: 1,
                leaveStatus: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
          chartData: [
            {
              $group: {
                _id: "$leaveType",
                totalLeaves: { $sum: "$leaveDays" },
              },
            },
          ],
          statusChartData: [
            {
              $group: {
                _id: "$leaveStatus",
                totalLeaves: { $sum: "$leaveDays" },
              },
            },
          ],
        },
      },
    ];
    const result = await LeaveRequestModel.aggregate(pipeline);
    const finalResult = result[0] || {};
    const data = {
      list: finalResult.tableData || [],
      totalCount:
        (finalResult.totalCount[0] && finalResult.totalCount[0].count) || 0,
      chartData: finalResult.chartData || [],
      statusChartData: finalResult.statusChartData || [],
    };

    return {
      success: true,
      data: JSON.stringify(data),
    };
  } catch (error) {
    console.error("Error fetching leave report data:", error);
    return {
      success: false,
      error: "Failed to fetch leave report data.",
    };
  }
}
