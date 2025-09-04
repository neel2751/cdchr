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

export async function fetchLiveOfficeClockOld({
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

function convertTimeToMinutes(fieldName) {
  return {
    $let: {
      vars: {
        parts: {
          $split: [
            {
              $cond: [
                {
                  $or: [
                    { $eq: [`$${fieldName}`, ""] },
                    { $eq: [`$${fieldName}`, null] },
                  ],
                },
                "0:0",
                `$${fieldName}`,
              ],
            },
            ":",
          ],
        },
      },
      in: {
        $add: [
          { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 60] },
          { $toInt: { $arrayElemAt: ["$$parts", 1] } },
        ],
      },
    },
  };
}

export async function fetchOfficeEmployeeClockCount({
  employeeId = null,
  fromDate = null,
  toDate = null,
  page = 1,
  limit = 10,
}) {
  try {
    const { props } = await getServerSideProps();
    const { user } = props?.session || {};
    const isAdmin = user?.role === "admin" || user?.role === "superAdmin";
    const employeeOid = isAdmin ? decrypt(employeeId) : user?._id;
    console.log("employeeOid", employeeOid);

    if (!employeeOid) {
      return { success: false, message: "Invalid employee ID" };
    }

    await connect();

    const date = getUKTime({ format: "date" });
    const monday = startOfWeek(new Date(date), { weekStartsOn: 1 });
    const formdate = formatDate(new Date(monday), "yyyy-MM-dd");
    const toEndDate = new Date(addDays(monday, 7));

    const start = fromDate
      ? normalizeDateToUTC(new Date(fromDate))
      : normalizeDateToUTC(new Date(formdate));
    const end = toDate
      ? normalizeDateToUTC(new Date(toDate))
      : normalizeDateToUTC(new Date(toEndDate));

    const matchConditions = {
      date: { $gte: start, $lt: end },
      isDeleted: false,
    };

    if (employeeId) {
      matchConditions.employeeId = createObjectId(employeeOid);
    }

    const skip = (page - 1) * limit;

    const clockRecords = await ClockModel.aggregate([
      { $match: matchConditions },

      // 1️⃣ Convert HH:mm to minutes safely
      {
        $addFields: {
          clockInMinutes: convertTimeToMinutes("clockIn"),
          clockOutMinutes: convertTimeToMinutes("clockOut"),
          breakInMinutes: convertTimeToMinutes("breakIn"),
          breakOutMinutes: convertTimeToMinutes("breakOut"),
        },
      },

      // 2️⃣ Compute durations
      {
        $addFields: {
          totalMinutesPerDay: {
            $subtract: ["$clockOutMinutes", "$clockInMinutes"],
          },
          breakMinutesPerDay: {
            $subtract: ["$breakOutMinutes", "$breakInMinutes"],
          },
        },
      },

      // 3️⃣ Format per-day hours
      {
        $addFields: {
          totalHoursPerDay: {
            $concat: [
              {
                $toString: { $floor: { $divide: ["$totalMinutesPerDay", 60] } },
              },
              ":",
              {
                $cond: [
                  { $lt: [{ $mod: ["$totalMinutesPerDay", 60] }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$totalMinutesPerDay", 60] } },
                    ],
                  },
                  { $toString: { $mod: ["$totalMinutesPerDay", 60] } },
                ],
              },
            ],
          },
          breakHoursPerDay: {
            $concat: [
              {
                $toString: { $floor: { $divide: ["$breakMinutesPerDay", 60] } },
              },
              ":",
              {
                $cond: [
                  { $lt: [{ $mod: ["$breakMinutesPerDay", 60] }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$breakMinutesPerDay", 60] } },
                    ],
                  },
                  { $toString: { $mod: ["$breakMinutesPerDay", 60] } },
                ],
              },
            ],
          },
        },
      },

      // 4️⃣ Group by employee
      {
        $group: {
          _id: "$employeeId",
          records: { $push: "$$ROOT" },
          totalMinutes: { $sum: "$totalMinutesPerDay" },
          avgMinutes: { $avg: "$totalMinutesPerDay" },
          avgClockInMinutes: { $avg: "$clockInMinutes" },
          avgClockOutMinutes: { $avg: "$clockOutMinutes" },
          avgBreakMinutes: { $avg: "$breakMinutesPerDay" },
        },
      },

      // 5️⃣ Lookup employee details
      {
        $lookup: {
          from: "officeemployes",
          localField: "_id",
          foreignField: "_id",
          as: "employeeDetails",
        },
      },
      { $unwind: "$employeeDetails" },

      // 6️⃣ Project final summary
      {
        $project: {
          employeeId: "$_id",
          name: "$employeeDetails.name",
          startDate: start,
          endDate: end,
          records: { $slice: ["$records", skip, limit] },
          totalRecords: { $size: "$records" },
          totalHours: {
            $concat: [
              { $toString: { $floor: { $divide: ["$totalMinutes", 60] } } },
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
              { $toString: { $floor: { $divide: ["$avgMinutes", 60] } } },
              ":",
              {
                $cond: [
                  { $lt: [{ $floor: { $mod: ["$avgMinutes", 60] } }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $floor: { $mod: ["$avgMinutes", 60] } } },
                    ],
                  },
                  { $toString: { $floor: { $mod: ["$avgMinutes", 60] } } },
                ],
              },
            ],
          },
          avgClockIn: {
            $concat: [
              {
                $toString: { $floor: { $divide: ["$avgClockInMinutes", 60] } },
              },
              ":",
              {
                $let: {
                  vars: {
                    roundedMinutes: {
                      $round: [{ $mod: ["$avgClockInMinutes", 60] }, 0],
                    },
                  },
                  in: {
                    $cond: [
                      { $lt: ["$$roundedMinutes", 10] },
                      { $concat: ["0", { $toString: "$$roundedMinutes" }] },
                      { $toString: "$$roundedMinutes" },
                    ],
                  },
                },
              },
            ],
          },
          avgClockOut: {
            $concat: [
              {
                $toString: { $floor: { $divide: ["$avgClockOutMinutes", 60] } },
              },
              ":",
              {
                $let: {
                  vars: {
                    roundedMinutes: {
                      $round: [{ $mod: ["$avgClockOutMinutes", 60] }, 0],
                    },
                  },
                  in: {
                    $cond: [
                      { $lt: ["$$roundedMinutes", 10] },
                      { $concat: ["0", { $toString: "$$roundedMinutes" }] },
                      { $toString: "$$roundedMinutes" },
                    ],
                  },
                },
              },
            ],
          },
          avgBreakHours: {
            $concat: [
              { $toString: { $floor: { $divide: ["$avgBreakMinutes", 60] } } },
              ":",
              {
                $cond: [
                  { $lt: [{ $mod: ["$avgBreakMinutes", 60] }, 10] },
                  {
                    $concat: [
                      "0",
                      { $toString: { $mod: ["$avgBreakMinutes", 60] } },
                    ],
                  },
                  { $toString: { $mod: ["$avgBreakMinutes", 60] } },
                ],
              },
            ],
          },
        },
      },
    ]);

    return { success: true, data: JSON.stringify(clockRecords[0]) || null };
  } catch (error) {
    console.error("Error fetching live office clock count:", error);
    return { success: false, message: "Something went wrong" };
  }
}

export async function fetchChartData({
  employeeId = null,
  fromDate = null,
  toDate = null,
}) {
  try {
    const { props } = await getServerSideProps();
    const { user } = props?.session || {};
    const isAdmin = user?.role === "admin" || user?.role === "superAdmin";
    await connect(); // your mongo connection
    const today = new Date();
    const start = fromDate
      ? new Date(fromDate)
      : startOfWeek(today, { weekStartsOn: 1 });
    const end = toDate ? new Date(toDate) : today;
    const employeeOid = isAdmin ? decrypt(employeeId) : user?._id;
    if (!employeeOid) {
      return { success: false, message: "Invalid employee ID" };
    }
    const matchConditions = {
      date: { $gte: start, $lte: end },
      isDeleted: false,
    };
    if (employeeId) {
      matchConditions.employeeId = createObjectId(employeeOid);
    }

    const chartData = await ClockModel.aggregate([
      { $match: matchConditions }, // filtered by employee/date range
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
          breakInMinutes: {
            $cond: [
              { $ifNull: ["$breakIn", false] },
              {
                $let: {
                  vars: { parts: { $split: ["$breakIn", ":"] } },
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
              null,
            ],
          },
          breakOutMinutes: {
            $cond: [
              { $ifNull: ["$breakOut", false] },
              {
                $let: {
                  vars: { parts: { $split: ["$breakOut", ":"] } },
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
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          durationMinutes: {
            $subtract: ["$clockOutMinutes", "$clockInMinutes"],
          },
          breakMinutes: {
            $cond: [
              { $and: ["$breakInMinutes", "$breakOutMinutes"] },
              { $subtract: ["$breakOutMinutes", "$breakInMinutes"] },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: "$date",
          totalMinutes: { $sum: "$durationMinutes" },
          avgBreakMinutes: { $avg: "$breakMinutes" },
        },
      },
      {
        $project: {
          date: "$_id",
          totalHours: {
            $concat: [
              { $toString: { $floor: { $divide: ["$totalMinutes", 60] } } },
              ":",
              { $toString: { $mod: ["$totalMinutes", 60] } },
            ],
          },
          avgBreakHours: {
            $concat: [
              { $toString: { $floor: { $divide: ["$avgBreakMinutes", 60] } } },
              ":",
              { $toString: { $mod: ["$avgBreakMinutes", 60] } },
            ],
          },
        },
      },
      { $sort: { date: 1 } },
    ]);

    return { success: true, data: JSON.stringify(chartData) };
  } catch (error) {
    console.error("Error fetching chart data:", error);
    return { success: false, message: "Something went wrong" };
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
    await connect();

    const today = normalizeDateToUTC(new Date());
    const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
    const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;

    // 🔹 If fetching for a single employee
    if (employeeId) {
      const [employee] = await OfficeEmployeeModel.aggregate([
        { $match: { _id: createObjectId(employeeId) } },
        {
          $lookup: {
            from: "clocks",
            let: { eid: "$_id", sid: siteId ? siteId : null },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$employeeId", "$$eid"] },
                      { $eq: ["$isDeleted", false] },
                      { $gte: ["$date", start] },
                      { $lte: ["$date", end] },
                    ],
                  },
                },
              },
              { $sort: { date: -1 } }, // latest record first
              { $limit: 1 },
            ],
            as: "clockRecords",
          },
        },
        {
          $unwind: { path: "$clockRecords", preserveNullAndEmptyArrays: true },
        },
        {
          $project: {
            _id: 0,
            employeeId: "$_id",
            name: 1,
            email: 1,
            clockIn: "$clockRecords.clockIn",
            clockOut: "$clockRecords.clockOut",
            breakIn: "$clockRecords.breakIn",
            breakOut: "$clockRecords.breakOut",
            status: "$clockRecords.status",
            date: "$clockRecords.date",
          },
        },
      ]);

      return {
        success: true,
        data: JSON.stringify(employee || {}),
        totalCount: employee ? 1 : 0,
      };
    }

    // 🔹 Else → fetch all employees (admin/office view) with pagination
    const queryObj = {};
    if (query) {
      queryObj.$or = [
        { name: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ];
    }

    const skip = (page - 1) * pageSize;

    const basePipeline = [
      { $match: queryObj },
      {
        $lookup: {
          from: "clocks",
          let: { eid: "$_id", sid: siteId ? siteId : null },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employeeId", "$$eid"] },
                    { $eq: ["$isDeleted", false] },
                    { $gte: ["$date", start] },
                    { $lte: ["$date", end] },
                  ],
                },
              },
            },
            { $sort: { date: -1 } },
            { $limit: 1 },
          ],
          as: "clockRecords",
        },
      },
      { $unwind: { path: "$clockRecords", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          employeeId: "$_id",
          name: 1,
          email: 1,
          clockIn: "$clockRecords.clockIn",
          clockOut: "$clockRecords.clockOut",
          breakIn: "$clockRecords.breakIn",
          breakOut: "$clockRecords.breakOut",
          status: "$clockRecords.status",
          date: "$clockRecords.date",
        },
      },
    ];

    const pipeline = [
      {
        $facet: {
          totalCount: [...basePipeline, { $count: "count" }],
          data: [...basePipeline, { $skip: skip }, { $limit: pageSize }],
        },
      },
      {
        $addFields: {
          total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
        },
      },
      { $project: { total: 1, data: 1 } },
    ];

    const [result] = await OfficeEmployeeModel.aggregate(pipeline);

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
