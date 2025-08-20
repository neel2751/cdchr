"use server";

import { connect } from "@/db/db";
import { getServerSideProps } from "../session/session";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import ClockModel from "@/models/clockModel";
import { normalizeDateToUTC } from "@/lib/formatDate";
import { createObjectId } from "@/lib/mongodb";
import { decrypt } from "@/lib/algo";
import { addDays, startOfWeek } from "date-fns";
import { formatDate, getUKTime } from "@/utils/time";

export default async function fetchEmployeeWithHoliday() {
  try {
    const { props } = await getServerSideProps();

    const now = new Date();
    const startOfUtcDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );

    await connect();
    // start to fetch only isActive, isDeleted =false, visaEndDate & End Date is valid
    const pipeline = [
      {
        $match: {
          isActive: true,
          delete: false,
          $or: [
            { visaEndDate: { $lte: new Date() } },
            { endDate: { $lte: new Date() } },
          ],
        },
      },
      {
        $lookup: {
          from: "leaverequests",
          localField: "_id",
          foreignField: "employeeId",
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $lte: [
                        { $toDate: "$leaveStartDate" },
                        new Date(startOfUtcDay.toISOString()),
                      ],
                    },
                    {
                      $gte: [
                        { $toDate: "$leaveEndDate" },
                        new Date(startOfUtcDay.toISOString()),
                      ],
                    },
                    { $in: ["$leaveStatus", ["Approved"]] }, // ✅ Only active leaves
                    {
                      leaveYear: new Date().getFullYear(),
                    },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 0,
                leaveStartDate: 1,
                leaveEndDate: 1,
                leaveYear: 1,
              },
            },
          ],
          as: "leaveRequest",
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [{ $arrayElemAt: ["$leaveRequest", 0] }, "$$ROOT"],
          },
        },
      },
      {
        $project: { leaveRequest: 0 },
      },
    ];
    const result = await OfficeEmployeeModel.aggregate(pipeline);
    return { success: true, data: JSON.stringify(result) };
  } catch (error) {
    console.log(
      "FetchEmployeeWithHoliday function from TimeOffServer File",
      error
    );
  }
}

export async function getTodayAttendanceData() {
  try {
    await connect();
    const today = normalizeDateToUTC(new Date());
    const clockInfo = await ClockModel.find({ date: today });
    return JSON.stringify(clockInfo);
  } catch (error) {
    console.error("Error fetching today's attendance:", error);
    return null;
  }
}

export async function getEmployeeTodayAttendanceData(employeeId) {
  try {
    await connect();
    const today = normalizeDateToUTC(new Date());

    // .lean() returns a plain JS object without Mongoose metadata
    const clockInfo = await ClockModel.findOne({
      employeeId,
      date: today,
    }).lean();

    if (!clockInfo) {
      return {
        success: true,
        data: JSON.stringify({
          _id: null,
          employeeId,
          clockIn: null,
          breakIn: null,
          breakOut: null,
          clockOut: null,
        }),
      };
    }
    return {
      success: true,
      data: JSON.stringify(clockInfo),
    };
  } catch (error) {
    console.error(
      `Error fetching today's attendance for employee ${employeeId}:`,
      error
    );
    return { success: false, message: "Something went wrong" };
  }
}

export async function getEmployeeTodayAttendanceDataForAdmin(employeeId) {
  try {
    await connect();
    const today = normalizeDateToUTC(new Date());
    const clockInfo = await ClockModel.findOne({
      employeeId: employeeId, // Assuming createObjectId is handled elsewhere or not needed here
      date: today,
    });
    return JSON.stringify(clockInfo);
  } catch (error) {
    console.error(
      `Error fetching today's attendance for employee ${employeeId}:`,
      error
    );
    return null;
  }
}

export async function fetchLiveOfficeClock({
  siteId = null,
  employeeId = null,
  fromDate = null,
  toDate = null,
  query = "",
  page = 1,
  pageSize = 10,
}) {
  try {
    const { props } = await getServerSideProps();
    await connect();
    const { user } = props?.session || {};
    // const isAdmin = user?.role === "admin" || user?.role === "superAdmin";
    // const employeeOid = isAdmin ? employeeId : user?._id;
    const today = normalizeDateToUTC(new Date());
    const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
    const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;
    const queryObj = {};
    if (employeeId) {
      queryObj._id = createObjectId(employeeId); // Use employeeOid instead of employeeId
    }
    if (query) {
      queryObj.$or = [
        { name: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ];
    }

    const skip = (page - 1) * pageSize;

    const basePipeline = [
      {
        $match: queryObj,
      },
      {
        $lookup: {
          from: "clocks",
          let: { eid: "$_id", sid: siteId ? siteId : null },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $gte: ["$date", start] },
                    { $lte: ["$date", end] },
                    { $eq: ["$isDeleted", false] },
                    { $eq: ["$employeeId", "$$eid"] },
                  ],
                },
              },
            },
            // { $sort: { date: -1 } }, // Sort by date descending
            // { $limit: 1 }, // Get the latest clock record
          ],
          as: "clockRecords",
        },
      },
      { $unwind: { path: "$clockRecords", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: null, // Exclude the _id field from the output
          employeeId: "$_id",
          name: 1,
          email: 1,
          clockRecordId: { $ifNull: ["$clockRecords._id", null] },
          clockIn: { $ifNull: ["$clockRecords.clockIn", null] },
          clockOut: { $ifNull: ["$clockRecords.clockOut", null] },
          breakIn: { $ifNull: ["$clockRecords.breakIn", null] },
          breakOut: { $ifNull: ["$clockRecords.breakOut", null] },
          status: { $ifNull: ["$clockRecords.status", null] },
          date: { $ifNull: ["$clockRecords.date", null] },
        },
      },
    ];
    const pipeline = [
      {
        $facet: {
          totalCount: [...basePipeline, { $count: "count" }],
          data: [
            ...basePipeline,

            { $skip: skip }, // Skip for pagination
            { $limit: pageSize }, // Limit results for pagination
          ],
        },
      },
      {
        $addFields: {
          total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
        },
      },
      {
        $project: {
          total: 1,
          data: 1,
        },
      },
    ];
    const [result] = await OfficeEmployeeModel.aggregate(pipeline);
    // console.log("Live Office Clock Data:", result);

    return {
      success: true,
      data: JSON.stringify(result.data || []),
      totalCount: result.total || 0,
    };
  } catch (error) {
    console.error("Error fetching live office clock data:", error);
    return { success: false, message: "Something went wrong" };
  }
}

// We have to count total Hour per employee with per week, and Avrage count
export async function fetchOfficeEmployeeClockCount({
  employeeId = null,
  fromDate = null,
  toDate = null,
}) {
  try {
    const { props } = await getServerSideProps();
    const { user } = props?.session || {};
    const isAdmin = user?.role === "admin" || user?.role === "superAdmin";
    const employeeOid = isAdmin ? decrypt(employeeId) : user?._id;
    if (!employeeOid) {
      return { success: false, message: "Invalid employee ID" };
    }
    await connect();
    const date = getUKTime({ format: "date" });
    const monday = startOfWeek(new Date(date), { weekStartsOn: 1 }); // Start of the week (Monday)
    const formdate = formatDate(new Date(monday), "yyyy-MM-dd");
    const toEndDate = new Date(addDays(monday, 7));

    const start = fromDate
      ? normalizeDateToUTC(new Date(fromDate))
      : normalizeDateToUTC(new Date(formdate));
    const end = toDate
      ? normalizeDateToUTC(new Date(toDate))
      : normalizeDateToUTC(new Date(toEndDate));

    const matchConditions = {
      date: {
        $gte: start,
        $lte: end,
      },
      isDeleted: false,
    };
    if (employeeId) {
      matchConditions.employeeId = createObjectId(employeeOid); // Use employeeOid instead of employeeId
    }

    const clockRecords = await ClockModel.aggregate([
      { $match: matchConditions },

      {
        $addFields: {
          // Convert "HH:mm" to total minutes since midnight
          clockInMinutes: {
            $let: {
              vars: { parts: { $split: ["$clockIn", ":"] } },
              in: {
                $add: [
                  {
                    $multiply: [
                      { $toInt: { $arrayElemAt: ["$$parts", 0] } },
                      60,
                    ],
                  },
                  { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                ],
              },
            },
          },
          clockOutMinutes: {
            $let: {
              vars: { parts: { $split: ["$clockOut", ":"] } },
              in: {
                $add: [
                  {
                    $multiply: [
                      { $toInt: { $arrayElemAt: ["$$parts", 0] } },
                      60,
                    ],
                  },
                  { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                ],
              },
            },
          },
        },
      },

      {
        $addFields: {
          durationMinutes: {
            $subtract: ["$clockOutMinutes", "$clockInMinutes"],
          },
        },
      },

      {
        $group: {
          _id: "$employeeId",
          clockIn: { $first: "$clockIn" },
          clockOut: { $last: "$clockOut" },
          breakIn: { $first: "$breakIn" },
          breakOut: { $last: "$breakOut" },
          date: { $first: "$date" },
          totalMinutes: { $sum: "$durationMinutes" },
          avgMinutes: { $avg: "$durationMinutes" },
        },
      },

      {
        $lookup: {
          from: "officeemployes",
          localField: "_id",
          foreignField: "_id", // Make sure this matches employeeId if needed
          as: "employeeDetails",
        },
      },
      { $unwind: "$employeeDetails" },

      {
        $project: {
          employeeId: "$_id",
          name: "$employeeDetails.name",
          clockIn: 1,
          clockOut: 1,
          breakIn: 1,
          breakOut: 1,
          date: 1,
          totalHours: {
            $concat: [
              {
                $cond: [
                  { $lt: [{ $floor: { $divide: ["$totalMinutes", 60] } }, 10] },
                  {
                    $concat: [
                      "0",
                      {
                        $toString: {
                          $floor: { $divide: ["$totalMinutes", 60] },
                        },
                      },
                    ],
                  },
                  { $toString: { $floor: { $divide: ["$totalMinutes", 60] } } },
                ],
              },
              ":",
              {
                $cond: [
                  { $lt: [{ $mod: ["$totalMinutes", 60] }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$totalMinutes", 60] } },
                    ],
                  },
                  { $toString: { $mod: ["$totalMinutes", 60] } },
                ],
              },
            ],
          },

          avgHours: {
            $concat: [
              {
                $cond: [
                  { $lt: [{ $floor: { $divide: ["$avgMinutes", 60] } }, 10] },
                  {
                    $concat: [
                      "0",
                      {
                        $toString: { $floor: { $divide: ["$avgMinutes", 60] } },
                      },
                    ],
                  },
                  { $toString: { $floor: { $divide: ["$avgMinutes", 60] } } },
                ],
              },
              ":",
              {
                $cond: [
                  { $lt: [{ $mod: ["$avgMinutes", 60] }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$avgMinutes", 60] } },
                    ],
                  },
                  { $toString: { $mod: ["$avgMinutes", 60] } },
                ],
              },
            ],
          },
        },
      },
    ]);
    return { success: true, data: JSON.stringify(clockRecords) };
  } catch (error) {
    console.error("Error fetching live office clock count:", error);
    return { success: false, message: "Something went wrong" };
  }
}

export async function fetchAvgAttendance({
  employeeId = null,
  fromDate = null,
  toDate = null,
}) {
  try {
    const { props } = await getServerSideProps();
    const { user } = props?.session || {};
    const isAdmin = user?.role === "admin" || user?.role === "superAdmin";
    const employeeOid = isAdmin ? decrypt(employeeId) : user?._id;
    if (!employeeOid) {
      return { success: false, message: "Invalid employee ID" };
    }
    await connect();
    const date = getUKTime({ format: "date" });
    const monday = startOfWeek(new Date(date), { weekStartsOn: 1 }); // Start of the week (Monday)
    const formdate = formatDate(new Date(monday), "yyyy-MM-dd");
    const toEndDate = new Date(addDays(monday, 7));

    const start = fromDate
      ? normalizeDateToUTC(new Date(fromDate))
      : normalizeDateToUTC(new Date(formdate));
    const end = toDate
      ? normalizeDateToUTC(new Date(toDate))
      : normalizeDateToUTC(new Date(toEndDate));

    const matchConditions = {
      date: {
        $gte: start,
        $lte: end,
      },
      isDeleted: false,
      employeeId: createObjectId(employeeOid),
    };

    const clockRecords = await ClockModel.aggregate([
      { $match: matchConditions },

      // Convert HH:mm strings to total minutes
      {
        $addFields: {
          clockInMinutes: {
            $let: {
              vars: { parts: { $split: ["$clockIn", ":"] } },
              in: {
                $add: [
                  {
                    $multiply: [
                      { $toInt: { $arrayElemAt: ["$$parts", 0] } },
                      60,
                    ],
                  },
                  { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                ],
              },
            },
          },
          clockOutMinutes: {
            $let: {
              vars: { parts: { $split: ["$clockOut", ":"] } },
              in: {
                $add: [
                  {
                    $multiply: [
                      { $toInt: { $arrayElemAt: ["$$parts", 0] } },
                      60,
                    ],
                  },
                  { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                ],
              },
            },
          },
        },
      },

      // Duration
      {
        $addFields: {
          durationMinutes: {
            $subtract: ["$clockOutMinutes", "$clockInMinutes"],
          },
        },
      },

      // Group
      {
        $group: {
          _id: null,
          totalMinutes: { $sum: "$durationMinutes" },
          count: { $sum: 1 },
          avgClockInMinutes: { $avg: "$clockInMinutes" }, // ✅ true average
          avgClockOutMinutes: { $avg: "$clockOutMinutes" }, // ✅ true average
        },
      },

      // Project formatted results
      {
        $project: {
          avgMinutes: { $divide: ["$totalMinutes", "$count"] },
          totalMinutes: 1,

          // Format HH:mm for avgClockIn
          avgClockIn: {
            $concat: [
              {
                $cond: [
                  {
                    $lt: [
                      { $floor: { $divide: ["$avgClockInMinutes", 60] } },
                      10,
                    ],
                  },
                  {
                    $concat: [
                      "0",
                      {
                        $toString: {
                          $floor: { $divide: ["$avgClockInMinutes", 60] },
                        },
                      },
                    ],
                  },
                  {
                    $toString: {
                      $floor: { $divide: ["$avgClockInMinutes", 60] },
                    },
                  },
                ],
              },
              ":",
              {
                $cond: [
                  { $lt: [{ $mod: ["$avgClockInMinutes", 60] }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$avgClockInMinutes", 60] } },
                    ],
                  },
                  { $toString: { $mod: ["$avgClockInMinutes", 60] } },
                ],
              },
            ],
          },

          // Format HH:mm for avgClockOut
          avgClockOut: {
            $concat: [
              {
                $cond: [
                  {
                    $lt: [
                      { $floor: { $divide: ["$avgClockOutMinutes", 60] } },
                      10,
                    ],
                  },
                  {
                    $concat: [
                      "0",
                      {
                        $toString: {
                          $floor: { $divide: ["$avgClockOutMinutes", 60] },
                        },
                      },
                    ],
                  },
                  {
                    $toString: {
                      $floor: { $divide: ["$avgClockOutMinutes", 60] },
                    },
                  },
                ],
              },
              ":",
              {
                $cond: [
                  { $lt: [{ $mod: ["$avgClockOutMinutes", 60] }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$avgClockOutMinutes", 60] } },
                    ],
                  },
                  { $toString: { $mod: ["$avgClockOutMinutes", 60] } },
                ],
              },
            ],
          },

          // Average working hours (duration)
          avgHours: {
            $concat: [
              {
                $cond: [
                  { $lt: [{ $floor: { $divide: ["$avgMinutes", 60] } }, 10] },
                  {
                    $concat: [
                      "0",
                      {
                        $toString: { $floor: { $divide: ["$avgMinutes", 60] } },
                      },
                    ],
                  },
                  { $toString: { $floor: { $divide: ["$avgMinutes", 60] } } },
                ],
              },
              ":",
              {
                $cond: [
                  { $lt: [{ $mod: ["$avgMinutes", 60] }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$avgMinutes", 60] } },
                    ],
                  },
                  { $toString: { $mod: ["$avgMinutes", 60] } },
                ],
              },
            ],
          },

          // Total hours
          totalHours: {
            $concat: [
              {
                $cond: [
                  { $lt: [{ $floor: { $divide: ["$totalMinutes", 60] } }, 10] },
                  {
                    $concat: [
                      "0",
                      {
                        $toString: {
                          $floor: { $divide: ["$totalMinutes", 60] },
                        },
                      },
                    ],
                  },
                  { $toString: { $floor: { $divide: ["$totalMinutes", 60] } } },
                ],
              },
              ":",
              {
                $cond: [
                  { $lt: [{ $mod: ["$totalMinutes", 60] }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$totalMinutes", 60] } },
                    ],
                  },
                  { $toString: { $mod: ["$totalMinutes", 60] } },
                ],
              },
            ],
          },
        },
      },
    ]);

    return {
      success: true,
      data: JSON.stringify(clockRecords[0] || {}),
    };
  } catch (error) {
    console.error("Error fetching average attendance:", error);
    return { success: false, message: "Something went wrong" };
  }
}
