"use server";

import { connect } from "@/db/db";
import { getServerSideProps } from "../session/session";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { getWorkingDate, toWorkingDate } from "@/lib/clockTime";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { decrypt } from "@/lib/algo";
import { addDays, startOfWeek } from "date-fns";
import { formatDate, getUKTime } from "@/utils/time";
import EmployeModel from "@/models/employeModel";
import ClockRecordModel from "@/models/clockInModel";
import { currentlyEmployedMatch } from "@/lib/employeeStatus";

export default async function fetchEmployeeWithHoliday() {
  try {
    const { props } = await getServerSideProps();

    const now = new Date();
    const startOfUtcDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    await connect();
    // start to fetch only isActive, isDeleted =false, visaEndDate & End Date is valid
    // The `$or` here used `$lte`, which matched staff whose visa or employment
    // had already lapsed — the opposite of what the comment above describes.
    const pipeline = [
      { $match: currentlyEmployedMatch(now) },
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
                    // A `{ leaveYear: <number> }` clause sat here. Inside
                    // `$expr` a plain document is a literal, not a comparison,
                    // so it was always truthy and filtered nothing — and
                    // `leaveYear` holds a string like "2026-27", never a
                    // number, so it could not have matched regardless. The
                    // date bounds above already scope this to today.
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
      error,
    );
  }
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
    let resolvedEmployeeId = user?._id || null;

    if (isAdmin && employeeId) {
      if (isValidObjectId(employeeId)) {
        resolvedEmployeeId = employeeId;
      } else {
        try {
          const decrypted = decrypt(employeeId);
          resolvedEmployeeId = isValidObjectId(decrypted) ? decrypted : null;
        } catch {
          resolvedEmployeeId = null;
        }
      }
    }

    if (!resolvedEmployeeId || !isValidObjectId(resolvedEmployeeId)) {
      return { success: false, message: "Invalid employee ID" };
    }

    await connect();

    const date = getUKTime({ format: "date" });
    const monday = startOfWeek(new Date(date), { weekStartsOn: 1 });
    const formdate = formatDate(new Date(monday), "yyyy-MM-dd");
    const toEndDate = new Date(addDays(monday, 7));

    const start = fromDate
      ? toWorkingDate(fromDate)
      : toWorkingDate(formdate);
    const end = toDate
      ? toWorkingDate(toDate)
      : toWorkingDate(toEndDate);

    const matchConditions = {
      employeeId: createObjectId(resolvedEmployeeId),
      date: { $gte: start, $lte: end },
      isDeleted: false,
    };

    const skip = (page - 1) * limit;

    const toMinutes = (time) => {
      if (!time || typeof time !== "string") return null;
      const parts = time.split(":");
      if (parts.length !== 2) return null;
      const hh = Number(parts[0]);
      const mm = Number(parts[1]);
      if (
        Number.isNaN(hh) ||
        Number.isNaN(mm) ||
        hh < 0 ||
        hh > 23 ||
        mm < 0 ||
        mm > 59
      )
        return null;
      return hh * 60 + mm;
    };

    const toHHMM = (mins) => {
      const total = Math.max(0, Math.round(mins || 0));
      const hh = Math.floor(total / 60);
      const mm = total % 60;
      return `${hh}:${String(mm).padStart(2, "0")}`;
    };

    const docs = await ClockRecordModel.find(matchConditions)
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const employee = await OfficeEmployeeModel.findById(
      createObjectId(resolvedEmployeeId),
      "name",
    ).lean();

    const recordsMapped = docs.map((doc) => {
      const clockInMin = toMinutes(doc.clockIn);
      const clockOutMin = toMinutes(doc.clockOut);
      const totalMinutesPerDay =
        clockInMin !== null && clockOutMin !== null
          ? Math.max(clockOutMin - clockInMin, 0)
          : 0;

      const breaks = Array.isArray(doc.breaks) ? doc.breaks : [];
      const breakMinutesPerDay = breaks.reduce((sum, br) => {
        const bi = toMinutes(br?.breakIn);
        const bo = toMinutes(br?.breakOut);
        if (bi === null || bo === null) return sum;
        return sum + Math.max(bo - bi, 0);
      }, 0);

      return {
        ...doc,
        breakIn: breaks?.[0]?.breakIn || null,
        breakOut: breaks?.length ? breaks[breaks.length - 1]?.breakOut : null,
        totalHoursPerDay: toHHMM(totalMinutesPerDay),
        breakHoursPerDay: toHHMM(breakMinutesPerDay),
        _clockInMinutes: clockInMin,
        _clockOutMinutes: clockOutMin,
        _totalMinutesPerDay: totalMinutesPerDay,
        _breakMinutesPerDay: breakMinutesPerDay,
      };
    });

    const totalRecords = recordsMapped.length;
    const paginatedRecords = recordsMapped.slice(skip, skip + limit);

    const totalMinutes = recordsMapped.reduce(
      (sum, r) => sum + r._totalMinutesPerDay,
      0,
    );
    const avgMinutes = totalRecords > 0 ? totalMinutes / totalRecords : 0;
    const avgBreakMinutes =
      totalRecords > 0
        ? recordsMapped.reduce((sum, r) => sum + r._breakMinutesPerDay, 0) /
          totalRecords
        : 0;

    const clockInSamples = recordsMapped
      .map((r) => r._clockInMinutes)
      .filter((v) => v !== null);
    const clockOutSamples = recordsMapped
      .map((r) => r._clockOutMinutes)
      .filter((v) => v !== null);

    const avgClockIn =
      clockInSamples.length > 0
        ? toHHMM(
            clockInSamples.reduce((sum, v) => sum + v, 0) /
              clockInSamples.length,
          )
        : "0:00";

    const avgClockOut =
      clockOutSamples.length > 0
        ? toHHMM(
            clockOutSamples.reduce((sum, v) => sum + v, 0) /
              clockOutSamples.length,
          )
        : "0:00";

    const result = {
      employeeId: resolvedEmployeeId,
      name: employee?.name || "N/A",
      startDate: start,
      endDate: end,
      records: paginatedRecords,
      totalRecords,
      totalHours: toHHMM(totalMinutes),
      avgHours: toHHMM(avgMinutes),
      avgClockIn,
      avgClockOut,
      avgBreakHours: toHHMM(avgBreakMinutes),
    };

    return { success: true, data: JSON.stringify(result) };
  } catch (error) {
    console.error("Error fetching live office clock count:", error);
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

    const today = getWorkingDate();
    const start = fromDate ? toWorkingDate(fromDate) : today;
    const end = toDate ? toWorkingDate(toDate) : today;

    // Exclusive upper bound for matching leave. `leaveDates` entries are not
    // guaranteed to sit exactly on UTC midnight, so an inclusive `$lte: end`
    // would miss a leave day stored with a time on it. Stepped in pure UTC
    // milliseconds — `end` is already UTC midnight and a local-time day step
    // would drift across a BST change.
    const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);

    // Approved leave covering any day in the requested range. Without this the
    // table cannot tell "did not come in" apart from "booked the day off", and
    // everyone on holiday reads as absent.
    const leaveLookup = [
      {
        $lookup: {
          from: "leaverequests",
          let: { eid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employeeId", "$$eid"] },
                    { $eq: ["$leaveStatus", "Approved"] },
                    {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: { $ifNull: ["$leaveDates", []] },
                              as: "d",
                              cond: {
                                $and: [
                                  { $gte: ["$$d", start] },
                                  { $lt: ["$$d", endExclusive] },
                                ],
                              },
                            },
                          },
                        },
                        0,
                      ],
                    },
                  ],
                },
              },
            },
            { $project: { _id: 0, leaveType: 1, isPaid: 1 } },
            { $limit: 1 },
          ],
          as: "leave",
        },
      },
      { $unwind: { path: "$leave", preserveNullAndEmptyArrays: true } },
    ];

    // -----------------------------------------------
    // 1) SINGLE EMPLOYEE VIEW
    // -----------------------------------------------
    if (employeeId) {
      const [employee] = await OfficeEmployeeModel.aggregate([
        { $match: { _id: createObjectId(employeeId) } },

        {
          $lookup: {
            from: "clockrecords",
            let: { eid: "$_id", sid: siteId ? createObjectId(siteId) : null },
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
            as: "clockRecord",
          },
        },

        { $unwind: { path: "$clockRecord", preserveNullAndEmptyArrays: true } },

        ...leaveLookup,

        {
          $project: {
            _id: 0,
            employeeId: "$_id",
            name: 1,
            email: 1,

            clockRecordId: { $ifNull: ["$clockRecord._id", null] },
            // Surfaced so the nightly job's findings are visible where the
            // fixing happens. A flag nobody sees is not a control.
            needsReview: { $ifNull: ["$clockRecord.needsReview", false] },
            reviewReason: "$clockRecord.reviewReason",
            clockIn: "$clockRecord.clockIn",
            clockOut: "$clockRecord.clockOut",

            // ⭐ MULTI BREAKS HERE
            breaks: { $ifNull: ["$clockRecord.breaks", []] },

            date: "$clockRecord.date",

            onLeave: { $cond: [{ $ifNull: ["$leave", false] }, true, false] },
            leaveType: { $ifNull: ["$leave.leaveType", null] },
            leaveIsPaid: { $ifNull: ["$leave.isPaid", null] },
          },
        },
      ]);

      return {
        success: true,
        data: JSON.stringify(employee || {}),
        totalCount: employee ? 1 : 0,
      };
    }

    // -----------------------------------------------
    // 2) ALL EMPLOYEES VIEW (PAGINATED)
    // -----------------------------------------------
    // Only current staff belong on the attendance board. Without this the
    // aggregation matched every office employee ever created, so deactivated
    // and soft-deleted people were listed as absent every day and were counted
    // in the summary cards. "Active" here means the same thing it does on the
    // office employee page: the account is switched on and not soft-deleted.
    const queryObj = { isActive: true, delete: { $ne: true } };
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
          from: "clockrecords",
          let: { eid: "$_id", sid: siteId ? createObjectId(siteId) : null },
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
          as: "clockRecord",
        },
      },

      { $unwind: { path: "$clockRecord", preserveNullAndEmptyArrays: true } },

      ...leaveLookup,

      {
        $project: {
          employeeId: "$_id",
          name: 1,
          email: 1,

          clockRecordId: { $ifNull: ["$clockRecord._id", null] },
            // Surfaced so the nightly job's findings are visible where the
            // fixing happens. A flag nobody sees is not a control.
            needsReview: { $ifNull: ["$clockRecord.needsReview", false] },
            reviewReason: "$clockRecord.reviewReason",
          clockIn: "$clockRecord.clockIn",
          clockOut: "$clockRecord.clockOut",

          // ⭐ MULTI BREAKS
          breaks: { $ifNull: ["$clockRecord.breaks", []] },

          date: "$clockRecord.date",

          onLeave: { $cond: [{ $ifNull: ["$leave", false] }, true, false] },
          leaveType: { $ifNull: ["$leave.leaveType", null] },
          leaveIsPaid: { $ifNull: ["$leave.isPaid", null] },
        },
      },
    ];

    const pipeline = [
      ...basePipeline,

      // ⭐ SORT - ACTIVE FIRST
      {
        $sort: {
          clockIn: -1,
        },
      },

      {
        $facet: {
          data: [
            { $skip: skip }, // Skip for pagination
            { $limit: pageSize }, // Limit results for pagination
          ],
          totalCount: [{ $count: "count" }],
          summary: [
            {
              $group: {
                _id: null,
                totalEmployees: { $sum: 1 },
                presentToday: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          {
                            $regexMatch: {
                              input: { $ifNull: ["$clockIn", ""] },
                              regex: "^([01]\\d|2[0-3]):([0-5]\\d)$",
                            },
                          },
                          {
                            $not: {
                              $regexMatch: {
                                input: { $ifNull: ["$clockOut", ""] },
                                regex: "^([01]\\d|2[0-3]):([0-5]\\d)$",
                              },
                            },
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                onBreak: {
                  $sum: {
                    $cond: [
                      {
                        $gt: [
                          {
                            $size: {
                              $filter: {
                                input: "$breaks",
                                as: "b",
                                cond: {
                                  $and: [
                                    {
                                      $regexMatch: {
                                        input: { $ifNull: ["$$b.breakIn", ""] },
                                        regex: "^([01]\\d|2[0-3]):([0-5]\\d)$",
                                      },
                                    },
                                    {
                                      $not: {
                                        $regexMatch: {
                                          input: {
                                            $ifNull: ["$$b.breakOut", ""],
                                          },
                                          regex:
                                            "^([01]\\d|2[0-3]):([0-5]\\d)$",
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            },
                          },
                          0,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                clockedOut: {
                  $sum: {
                    $cond: [
                      {
                        $regexMatch: {
                          input: { $ifNull: ["$clockOut", ""] },
                          regex: "^([01]\\d|2[0-3]):([0-5]\\d)$",
                        },
                      },
                      1,
                      0,
                    ],
                  },
                },
                // Split by whether the leave is paid: unpaid leave is an
                // absence the business is not paying for, so it does not
                // belong in the same figure as booked holiday.
                onLeave: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$onLeave", true] }, { $ne: ["$leaveIsPaid", false] }] },
                      1,
                      0,
                    ],
                  },
                },
                onUnpaidLeave: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$onLeave", true] }, { $eq: ["$leaveIsPaid", false] }] },
                      1,
                      0,
                    ],
                  },
                },
                totalWorkedMinutes: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          {
                            $regexMatch: {
                              input: { $ifNull: ["$clockIn", ""] },
                              regex: "^([01]\\d|2[0-3]):([0-5]\\d)$",
                            },
                          },
                          {
                            $regexMatch: {
                              input: { $ifNull: ["$clockOut", ""] },
                              regex: "^([01]\\d|2[0-3]):([0-5]\\d)$",
                            },
                          },
                          { $ne: ["$date", null] },
                        ],
                      },
                      {
                        $divide: [
                          {
                            $subtract: [
                              {
                                $dateFromString: {
                                  dateString: {
                                    $concat: [
                                      {
                                        $dateToString: {
                                          date: "$date",
                                          format: "%Y-%m-%d",
                                        },
                                      },
                                      "T",
                                      "$clockOut",
                                      ":00",
                                    ],
                                  },
                                },
                              },
                              {
                                $dateFromString: {
                                  dateString: {
                                    $concat: [
                                      {
                                        $dateToString: {
                                          date: "$date",
                                          format: "%Y-%m-%d",
                                        },
                                      },
                                      "T",
                                      "$clockIn",
                                      ":00",
                                    ],
                                  },
                                },
                              },
                            ],
                          },
                          60000,
                        ],
                      },
                      0,
                    ],
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                totalEmployees: 1,
                presentToday: 1,
                onBreak: 1,
                clockedOut: 1,
                onLeave: 1,
                onUnpaidLeave: 1,
                averageMinutes: {
                  $cond: [
                    { $gt: ["$clockedOut", 0] },
                    { $divide: ["$totalWorkedMinutes", "$clockedOut"] },
                    0,
                  ],
                },
              },
            },
          ],
        },
      },
      {
        $addFields: {
          total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
          summary: {
            $ifNull: [
              { $arrayElemAt: ["$summary", 0] },
              {
                totalEmployees: 0,
                presentToday: 0,
                onBreak: 0,
                clockedOut: 0,
                onLeave: 0,
                onUnpaidLeave: 0,
                averageMinutes: 0,
              },
            ],
          },
        },
      },
      { $project: { total: 1, data: 1, summary: 1 } },
    ];

    const aggregationResult = await OfficeEmployeeModel.aggregate(pipeline);
    const result = aggregationResult[0] || { data: [], total: 0 };

    return {
      success: true,
      data: JSON.stringify(result.data),
      totalCount: result.total || 0,
      summary: result.summary || {
        totalEmployees: 0,
        presentToday: 0,
        onBreak: 0,
        clockedOut: 0,
        onLeave: 0,
        onUnpaidLeave: 0,
        averageMinutes: 0,
      },
    };
  } catch (error) {
    console.error("Error fetching live office clock data:", error);
    return { success: false, message: "Something went wrong" };
  }
}

/* New FetchLiveOfficeClock function to handle both Employee types After Holiday I have to Start from Here onwards
  - If employeeId is provided, check which collection they belong to (OfficeEmployee or Employee)
  - Fetch that single employee with their latest ClockRecord
  - If no employeeId, fetch all employees from both collections, attach latest ClockRecord, merge results, and paginate in JS
 */
export async function fetchLiveClockRecords({
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

    const today = getWorkingDate();
    const start = fromDate ? toWorkingDate(fromDate) : today;
    const end = toDate ? toWorkingDate(toDate) : today;

    // helper to build common projection shape
    const projectClockShape = (employeeTypeLiteral) => ({
      _id: 0,
      employeeId: "$_id",
      name: 1,
      email: 1,
      employeeType: employeeTypeLiteral,
      clockRecordId: { $ifNull: ["$clockRecords._id", null] },
      clockIn: "$clockRecords.clockIn",
      clockOut: "$clockRecords.clockOut",
      breaks: "$clockRecords.breaks",
      status: "$clockRecords.status",
      date: "$clockRecords.date",
      locationType: "$clockRecords.locationType",
      siteId: "$clockRecords.siteId",
      overtime: "$clockRecords.overtime",
      clockInStatus: "$clockRecords.clockInStatus",
    });

    // If single employee requested -> detect which employee collection contains them
    if (employeeId) {
      // try Office first, then Site
      let employeeModel = null;
      let employeeType = null;

      const office = await OfficeEmployeeModel.findById(employeeId)
        .select("_id name email")
        .lean();
      if (office) {
        employeeModel = OfficeEmployeeModel;
        employeeType = "OfficeEmployee";
      } else {
        const site = await EmployeModel.findById(employeeId)
          .select("_id name email")
          .lean();
        if (site) {
          employeeModel = EmployeModel;
          employeeType = "Employee";
        }
      }

      if (!employeeModel)
        return { success: false, message: "Employee not found" };

      // aggregate that employee and lookup latest clock record from ClockRecordModel
      const [record] = await employeeModel.aggregate([
        { $match: { _id: createObjectId(employeeId) } },
        {
          $lookup: {
            from: ClockRecordModel.collection.name, // unified collection name
            let: { eid: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$employeeId", "$$eid"] },
                      { $eq: ["$isDeleted", false] },
                      { $gte: ["$date", start] },
                      { $lte: ["$date", end] },
                      // optional: if siteId provided and you want to filter by site where the clock happened:
                      ...(siteId
                        ? [{ $eq: ["$siteId", createObjectId(siteId)] }]
                        : []),
                    ],
                  },
                },
              },
              { $sort: { date: -1, createdAt: -1 } }, // ensure latest
              { $limit: 1 },
            ],
            as: "clockRecords",
          },
        },
        {
          $unwind: { path: "$clockRecords", preserveNullAndEmptyArrays: true },
        },
        { $project: projectClockShape(employeeType) },
      ]);

      return {
        success: true,
        data: JSON.stringify(record || {}),
        totalCount: record ? 1 : 0,
      };
    }

    // Admin view: need to return combined employees of both types with their latest ClockRecord.
    // Approach: run two pipelines (office + site) then merge in JS and page the result.
    // This is simpler and safe for small->medium orgs. For huge orgs, consider server-side union & DB-side pagination.

    const queryObj = {};
    if (query) {
      queryObj.$or = [
        { name: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ];
    }

    // pipeline factory to attach latest clock record to each employee doc
    const buildPipeline = (employeeTypeLiteral) => [
      { $match: queryObj },
      {
        $lookup: {
          from: ClockRecordModel.collection.name,
          let: { eid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employeeId", "$$eid"] },
                    { $eq: ["$isDeleted", false] },
                    { $gte: ["$date", start] },
                    { $lte: ["$date", end] },
                    // optionally filter by siteId if provided
                    ...(siteId
                      ? [{ $eq: ["$siteId", createObjectId(siteId)] }]
                      : []),
                  ],
                },
              },
            },
            { $sort: { date: -1, createdAt: -1 } },
            { $limit: 1 },
          ],
          as: "clockRecords",
        },
      },
      { $unwind: { path: "$clockRecords", preserveNullAndEmptyArrays: true } },
      { $project: projectClockShape(employeeTypeLiteral) },
    ];

    const [officeRows, siteRows] = await Promise.all([
      OfficeEmployeeModel.aggregate(buildPipeline("OfficeEmployee")),
      EmployeModel.aggregate(buildPipeline("SiteEmployee")),
    ]);

    // Merge both arrays, sort by date (latest record first), but keep employees without clocks at the end
    const merged = [...officeRows, ...siteRows].sort((a, b) => {
      const ad = a.date ? new Date(a.date).getTime() : 0;
      const bd = b.date ? new Date(b.date).getTime() : 0;
      return bd - ad;
    });

    const totalCount = merged.length;
    // apply pagination in JS
    const skip = (page - 1) * pageSize;
    const paged = merged.slice(skip, skip + pageSize);

    return {
      success: true,
      data: JSON.stringify(paged || []),
      totalCount,
    };
  } catch (error) {
    console.error("Error fetching live clock records:", error);
    return { success: false, message: "Something went wrong" };
  }
}

// KPI Metrics
export async function fetchPunctualityRate({ employeeId = null }) {
  try {
    const { props } = await getServerSideProps();
    const { user } = props?.session || {};
    const isAdmin = user?.role === "admin" || user?.role === "superAdmin";
    const empId = isAdmin ? decrypt(employeeId) : user?._id;
    if (!empId) {
      return { success: false, message: "Invalid employee ID" };
    }
    await connect();

    const today = getWorkingDate();
    // UTC, to match how a working day is stored. Built from local parts, a
    // January 1st west of Greenwich lands in the previous year.
    const startOfYear = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const endOfYear = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
    const gracePeriodMinutes = 5;

    // Reads clockrecords. It used to read `clocks`, which nothing has written
    // to since the app moved to clockrecords — so this chart showed whatever
    // was in that collection the day writing stopped, and nothing since.
    // scripts/migrate-legacy-clocks.mjs brings the history across.
    const [punctualityResult] = await ClockRecordModel.aggregate([
      {
        $match: {
          employeeId: createObjectId(empId),
          date: { $gte: startOfYear, $lte: endOfYear },
          isDeleted: false,
          // A day with no clock-in is not a day they were late for.
          clockIn: { $type: "string", $ne: "" },
        },
      },
      {
        $addFields: {
          // Convert the "HH:mm" clockIn string to minutes from midnight
          // Assumes a start time of 9:00 AM (540 minutes from midnight)
          clockInMinutes: {
            $add: [
              { $multiply: [{ $toInt: { $substr: ["$clockIn", 0, 2] } }, 60] },
              { $toInt: { $substr: ["$clockIn", 3, 2] } },
            ],
          },
        },
      },
      {
        $addFields: {
          // Compare the clockIn time in minutes to the scheduled start time (e.g., 9:00 AM) plus a grace period
          isLate: {
            $gt: [
              "$clockInMinutes",
              540 + gracePeriodMinutes, // 9:00 AM is 540 minutes from midnight
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalWorkDays: { $sum: 1 },
          totalLateDays: { $sum: { $cond: ["$isLate", 1, 0] } },
        },
      },
    ]);

    const totalWorkDays = punctualityResult?.totalWorkDays || 0;
    const totalLateDays = punctualityResult?.totalLateDays || 0;

    const punctualityRate =
      totalWorkDays === 0
        ? 0
        : Math.round(((totalWorkDays - totalLateDays) / totalWorkDays) * 100);

    console.log("Punctuality Rate Calculation:", {
      totalWorkDays,
      totalLateDays,
      punctualityRate,
    });

    return {
      success: true,
      data: JSON.stringify({
        totalWorkDays,
        totalLateDays,
        punctualityRate,
      }),
    };
  } catch (error) {
    console.error("Error fetching punctuality rate:", error);
    return { success: false, message: "Something went wrong" };
  }
}

// Average Daily Hours KPI
