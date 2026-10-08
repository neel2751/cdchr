"use server";

import SiteAssignmentModel from "@/models/siteAssignmentModel";
import { getServerSideProps } from "../session/session";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { getWorkingDate, toWorkingDate } from "@/lib/clockTime";
import { connect } from "@/db/db";
import { getCurrentTimeAndDate } from "../2FAServer/qrcodeServer";
import EmployeModel from "@/models/employeModel";
import { decrypt } from "@/lib/algo";
import { fetchLiveOfficeClock } from "../timeOffServer/timeOffServer";
import ClockRecordModel from "@/models/clockInModel";
import WorkSettingModel from "@/models/workSettingModel";
import {
  DEFAULT_DAYS_PER_WEEK,
  DEFAULT_FIXED_WEEKLY_HOURS,
} from "@/lib/workHours";
import { withAudit, recordAudit } from "@/lib/audit";
import { featureRefusal } from "@/lib/requireFeature";
import { toDayKey } from "@/lib/bankHolidays";
import { getWorkSettings } from "../settingsServer/workSettings";
import { getBankHolidays } from "../holidayServer/holidayServer";

// Assign or update today's site assignment
export const assignEmployeesToSite = withAudit(
  "SiteAssignment.assign",
  async (data) => {
  try {
    const refusal = await featureRefusal("siteProjects");
    if (refusal) return refusal;

    const { props } = await getServerSideProps();
    const { _id: adminId } = props?.session?.user;

    if (!adminId) {
      return {
        success: false,
        message: "You are not authorized to assign Site",
      };
    }

    const {
      siteId,
      employee: employeeIds,
      assignDate,
      moveExisting = false,
    } = data;

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return { success: false, message: "Select at least one employee" };
    }

    const today = new Date(assignDate).toISOString().split("T")[0];
    const date = new Date(`${today}T00:00:00.000Z`);
    const uniqueEmployeeIds = [...new Set(employeeIds)];

    // Step 1: Check existing same-date assignments for the selected employees
    const conflictingAssignments = await SiteAssignmentModel.find({
      assignDate: date,
      "assignedEmployees.employeeId": {
        $in: uniqueEmployeeIds.map(createObjectId),
      },
    });

    const assignedInOtherSite = new Set();
    const assignedInSameSite = new Set();
    const lockedForMove = new Set();
    const employeesToMove = [];

    for (const doc of conflictingAssignments) {
      for (const ae of doc.assignedEmployees) {
        const eid = ae.employeeId.toString();
        if (!uniqueEmployeeIds.includes(eid)) continue;

        if (doc.siteId.toString() === siteId.toString()) {
          assignedInSameSite.add(eid);
          continue;
        }

        assignedInOtherSite.add(eid);

        if (ae.isLocked) {
          lockedForMove.add(eid);
          continue;
        }

        employeesToMove.push({
          fromSiteId: doc.siteId,
          employeeId: eid,
        });
      }
    }

    if (assignedInOtherSite.size > 0 && !moveExisting) {
      return {
        success: false,
        message:
          "Some employees are already assigned to another site on this date. Enable move option to reassign them.",
      };
    }

    if (lockedForMove.size > 0) {
      return {
        success: false,
        message: `Cannot move locked employees on ${today}: ${[
          ...lockedForMove,
        ].join(", ")}`,
      };
    }

    if (moveExisting && employeesToMove.length > 0) {
      for (const moveItem of employeesToMove) {
        await SiteAssignmentModel.updateOne(
          {
            siteId: moveItem.fromSiteId,
            assignDate: date,
          },
          {
            $pull: {
              assignedEmployees: {
                employeeId: createObjectId(moveItem.employeeId),
              },
            },
          },
        );

        await SiteAssignmentModel.deleteOne({
          siteId: moveItem.fromSiteId,
          assignDate: date,
          assignedEmployees: { $size: 0 },
        });
      }
    }

    // Step 2: Create/update target site assignment
    const existingAssignment = await SiteAssignmentModel.findOne({
      siteId,
      assignDate: date,
    });

    if (!existingAssignment) {
      const newAssignment = new SiteAssignmentModel({
        siteId,
        assignDate: date,
        assignedEmployees: uniqueEmployeeIds.map((id) => ({
          employeeId: createObjectId(id),
          assignedBy: adminId,
        })),
      });

      const res = await newAssignment.save();
      if (!res)
        return { success: false, message: "Problem while assigning site" };

      recordAudit({
        entityId: res._id,
        after: res.toObject(),
        description: `Assigned ${uniqueEmployeeIds.length} employee(s) to site ${siteId} on ${today}`,
      });

      if (moveExisting && employeesToMove.length > 0) {
        return {
          success: true,
          message: "Site assigned and employee(s) moved successfully",
        };
      }

      return { success: true, message: "Site assigned successfully" };
    }

    const alreadyInTarget = new Set(
      existingAssignment.assignedEmployees.map((ae) =>
        ae.employeeId.toString(),
      ),
    );

    const beforeAssignment = existingAssignment.toObject();

    const employeesToAdd = uniqueEmployeeIds.filter(
      (id) => !alreadyInTarget.has(id),
    );

    employeesToAdd.forEach((id) => {
      existingAssignment.assignedEmployees.push({
        employeeId: createObjectId(id),
        assignedBy: adminId,
      });
    });

    const res = await existingAssignment.save();
    if (!res)
      return { success: false, message: "Problem while assigning site" };

    recordAudit({
      entityId: existingAssignment._id,
      before: beforeAssignment,
      after: res.toObject(),
      description: `Assigned ${employeesToAdd.length} employee(s) to site ${siteId} on ${today}`,
    });

    if (moveExisting && employeesToMove.length > 0) {
      return {
        success: true,
        message: "Site assigned and employee(s) moved successfully",
      };
    }

    if (employeesToAdd.length === 0 && assignedInSameSite.size > 0) {
      return {
        success: true,
        message: "Selected employees are already assigned to this site",
      };
    }

    return { success: true, message: "Site assigned successfully" };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something went wrong" };
  }
  },
  { module: "SiteAssignment" },
);

export const getTodayAssignedEmployeesBySite = async (siteId) => {
  // Returns a bare array, not the usual { success } envelope, so a refusal
  // object would be read as one assigned employee. Empty list is the refusal.
  if (await featureRefusal("siteProjects")) return [];

  const today = new Date().setHours(0, 0, 0, 0);
  const assignment = await SiteAssignmentModel.findOne({
    siteId,
    date: today,
  }).populate("assignedEmployees.employeeId"); // optional to populate

  return assignment?.assignedEmployees || [];
};

export const getTodayAssignedEmployees = async () => {
  const refusal = await featureRefusal("siteProjects");
  if (refusal) return refusal;

  const today = new Date().toISOString().split("T")[0];
  const date = new Date(`${today}T00:00:00.000Z`);

  const assignment = await SiteAssignmentModel.find({
    assignDate: date,
  })
    .populate({
      path: "assignedEmployees.employeeId",
      select: "firstName",
    })
    .populate({
      path: "siteId",
      select: "siteName",
    });

  return { success: true, data: JSON.stringify(assignment) };
};

export async function fetchClockRecordsTest({
  siteId = null,
  employeeId = null,
  fromDate = null,
  toDate = null,
  page = 1,
  pageSize = 10,
  search = "",
  paymentType = null,
}) {
  await connect();

  // normalize dates (your helper)
  const today = getWorkingDate();
  const start = fromDate ? toWorkingDate(fromDate) : today;
  const end = toDate ? toWorkingDate(toDate) : today;

  // validate optional siteId/employeeId
  if (siteId && siteId !== "All" && !isValidObjectId(siteId)) {
    return { success: false, message: "Invalid siteId" };
  }
  if (employeeId && !isValidObjectId(employeeId)) {
    return { success: false, message: "Invalid employeeId" };
  }

  // Build facet pipelines:
  // assigned facet -> list of assigned employeeIds within date range (for given site if provided)
  const assignedFacetPipeline = [
    // match assignments by site (if provided) and assignDate in range
    {
      $match: {
        ...(siteId && siteId !== "All"
          ? { siteId: createObjectId(siteId) }
          : {}),
        assignDate: { $gte: start, $lte: end },
      },
    },
    { $unwind: "$assignedEmployees" },
    {
      $project: {
        employeeId: "$assignedEmployees.employeeId",
      },
    },
    // dedupe in facet
    {
      $group: {
        _id: "$employeeId",
      },
    },
    { $project: { employeeId: "$_id", _id: 0 } },
  ];

  // clocked facet -> list of employeeIds who have a clock record in date range (optionally filtered by site)
  const clockedFacetPipeline = [
    {
      $match: {
        isDeleted: false,
        date: { $gte: start, $lte: end },
        ...(siteId && siteId !== "All"
          ? { siteId: createObjectId(siteId) }
          : {}),
        ...(employeeId ? { employeeId: createObjectId(employeeId) } : {}),
      },
    },
    {
      $group: {
        _id: "$employeeId",
      },
    },
    { $project: { employeeId: "$_id", _id: 0 } },
  ];

  // Top-level pipeline: get both id arrays, union them, unwind, then fetch details per employee
  const pipeline = [
    {
      $facet: {
        assigned: assignedFacetPipeline,
        clocked: clockedFacetPipeline,
      },
    },

    // Merge assigned.employeeId[] and clocked.employeeId[] into one set of unique ids
    {
      $project: {
        mergedIds: {
          $setUnion: [
            { $map: { input: "$assigned", as: "a", in: "$$a.employeeId" } },
            { $map: { input: "$clocked", as: "c", in: "$$c.employeeId" } },
          ],
        },
      },
    },

    // Turn mergedIds into result records (one doc per employeeId)
    { $unwind: { path: "$mergedIds", preserveNullAndEmptyArrays: false } },
    { $project: { employeeId: "$mergedIds" } },

    // If caller passed employeeId, filter here (helps when siteId omitted)
    ...(employeeId
      ? [{ $match: { employeeId: createObjectId(employeeId) } }]
      : []),

    // Lookup employee info from both collections (site + office)
    {
      $lookup: {
        from: "employes",
        localField: "employeeId",
        foreignField: "_id",
        as: "siteEmp",
      },
    },
    {
      $lookup: {
        from: "officeemployes",
        localField: "employeeId",
        foreignField: "_id",
        as: "officeEmp",
      },
    },

    // Convert employee arrays to single employee object
    {
      $addFields: {
        employee: {
          $cond: [
            { $gt: [{ $size: "$officeEmp" }, 0] },
            { $arrayElemAt: ["$officeEmp", 0] },
            { $arrayElemAt: ["$siteEmp", 0] },
          ],
        },
      },
    },

    { $unset: ["siteEmp", "officeEmp"] },

    // Determine if this employee is assigned to the requested site/date range (boolean)
    {
      $lookup: {
        from: "siteassignments",
        let: { eid: "$employeeId" },
        pipeline: [
          {
            $match: {
              ...(siteId && siteId !== "All"
                ? { siteId: createObjectId(siteId) }
                : {}),
              assignDate: { $gte: start, $lte: end },
            },
          },
          { $unwind: "$assignedEmployees" },
          {
            $match: {
              $expr: { $eq: ["$assignedEmployees.employeeId", "$$eid"] },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "assignmentForSite",
      },
    },

    {
      $addFields: {
        isAssigned: { $gt: [{ $size: "$assignmentForSite" }, 0] },
      },
    },

    { $unset: ["assignmentForSite"] },

    // Lookup aggregated clockRecords for this employee in the date range & site (to compute lastClock + totalHours)
    {
      $lookup: {
        from: "clockrecords",
        let: { eid: "$employeeId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$employeeId", "$$eid"] },
              isDeleted: false,
              date: { $gte: start, $lte: end },
              ...(siteId && siteId !== "All"
                ? { siteId: createObjectId(siteId) }
                : {}),
            },
          },
          { $sort: { date: -1 } },

          // For totalHours we need to sum (clockOut - clockIn) per record (in hours)
          {
            $project: {
              clockIn: 1,
              clockOut: 1,
              date: 1,
              // compute hours for this record (clockOut can be null -> treat as 0)
              hours: {
                $cond: [
                  { $and: ["$clockIn", "$clockOut"] },
                  {
                    $divide: [
                      {
                        $subtract: [
                          {
                            $toDate: {
                              $concat: [
                                {
                                  $dateToString: {
                                    date: "$date",
                                    format: "%Y-%m-%d",
                                  },
                                },
                                "T",
                                { $ifNull: ["$clockOut", "$clockIn"] },
                                ":00",
                              ],
                            },
                          },
                          {
                            $toDate: {
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
                        ],
                      },
                      1000 * 60 * 60,
                    ],
                  },
                  0,
                ],
              },
              raw: "$$ROOT",
            },
          },

          // Group per employee to compute totalHours and lastClock (we sorted desc so first is last)
          {
            $group: {
              _id: "$employeeId", // note: $employeeId is in outer scope, but grouping by constant keeps one group
              totalHours: { $sum: "$hours" },
              lastClockRecord: { $first: "$raw" },
            },
          },

          { $project: { totalHours: 1, lastClockRecord: 1, _id: 0 } },
        ],
        as: "clockAgg",
      },
    },

    // Unwrap the clockAgg result (may be empty)
    {
      $addFields: {
        totalHours: {
          $ifNull: [{ $arrayElemAt: ["$clockAgg.totalHours", 0] }, 0],
        },
        lastClockRecord: { $arrayElemAt: ["$clockAgg.lastClockRecord", 0] },
      },
    },
    { $unset: ["clockAgg"] },

    {
      $lookup: {
        from: "projectsites",
        localField: "lastClockRecord.siteId",
        foreignField: "_id",
        as: "site",
      },
    },
    { $unwind: { path: "$site", preserveNullAndEmptyArrays: true } },

    // Project fields we want to use for filtering/sorting & response
    {
      $project: {
        employeeId: 1,
        employee: 1,
        isAssigned: 1,
        totalHours: 1,
        lastClockRecord: 1,
        // expose some common employee fields for search/sort convenience
        _employeeFirstName: "$employee.firstName",
        _employeeLastName: "$employee.lastName",
        _employeeName: "$employee.name", // office employees
        _employeePaymentType: "$employee.paymentType",

        site: 1,
      },
    },

    // Search filter (name)
    ...(search
      ? [
          {
            $match: {
              $or: [
                { _employeeFirstName: { $regex: search, $options: "i" } },
                { _employeeLastName: { $regex: search, $options: "i" } },
                { _employeeName: { $regex: search, $options: "i" } },
              ],
            },
          },
        ]
      : []),

    // Payment type filter
    ...(paymentType && paymentType !== "All"
      ? [
          {
            $match: {
              _employeePaymentType: paymentType,
            },
          },
        ]
      : []),

    // Sort - you can change to name / assigned / hours etc.
    { $sort: { _employeeFirstName: 1, _employeeLastName: 1 } },

    // Final pagination facet
    {
      $facet: {
        data: [
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },

          // ***** FLATTEN EVERYTHING *****
          {
            $project: {
              employeeId: 1,

              // employee fields
              firstName: "$employee.firstName",
              lastName: "$employee.lastName",
              name: "$employee.name",
              paymentType: "$employee.paymentType",
              payRate: "$employee.payRate",

              employeeType: {
                $cond: [
                  { $ifNull: ["$employee.firstName", false] },
                  "Employee",
                  "OfficeEmployee",
                ],
              },

              // assignment
              isAssigned: 1,

              // last clock record flattened
              clockRecordId: "$lastClockRecord._id",
              date: "$lastClockRecord.date",
              clockIn: "$lastClockRecord.clockIn",
              clockOut: "$lastClockRecord.clockOut",
              breaks: "$lastClockRecord.breaks",
              siteId: "$lastClockRecord.siteId",
              siteName: "$site.siteName",

              // hours
              totalHours: 1,
            },
          },
        ],
        totalCount: [{ $count: "count" }],
      },
    },
  ];

  // Run aggregation on an appropriate collection.
  // We used only lookups and no direct docs from primary collection after facet
  // but you must run the pipeline on any existing collection. Use SiteAssignmentModel or ClockRecordModel;
  // we run it on SiteAssignmentModel.aggregate([]) just to execute pipeline. Using ClockRecordModel also works.
  // Use ClockRecordModel.aggregate to honor read preferences of that collection:
  const [result] = await SiteAssignmentModel.aggregate(pipeline);

  const data = result?.data || [];
  const total = result?.totalCount?.[0]?.count || 0;

  return {
    success: true,
    data: JSON.stringify(data),
    total,
  };
}

// export async function fetchAssignedWithClocksNew({
//   siteId = null,
//   employeeId = null,
//   fromDate = null,
//   toDate = null,
//   page = 1,
//   pageSize = 10,
//   query = null,
//   paymentType = null,
// }) {
//   await connect();

//   const today = getWorkingDate();
//   const start = fromDate ? toWorkingDate(fromDate) : today;
//   const end = toDate ? toWorkingDate(toDate) : today;

//   const filter = {};
//   if (siteId && siteId !== "All") {
//     if (!isValidObjectId(siteId)) {
//       return { success: false, message: "Invalid site ID" };
//     }
//     filter.siteId = createObjectId(siteId);
//   }

//   const basePipeline = [
//     { $match: filter },
//     { $unwind: "$assignedEmployees" },

//     {
//       $match: {
//         assignDate: { $gte: start, $lte: end },
//       },
//     },

//     // 🔍 Filter by employeeId (stored inside assignedEmployees.employee._id)
//     ...(employeeId
//       ? [
//           {
//             $match: {
//               "assignedEmployees.employee._id": createObjectId(employeeId),
//             },
//           },
//         ]
//       : []),

//     // 🔍 Filter by name
//     ...(query
//       ? [
//           {
//             $match: {
//               $or: [
//                 {
//                   "assignedEmployees.employee.firstName": {
//                     $regex: query,
//                     $options: "i",
//                   },
//                 },
//                 {
//                   "assignedEmployees.employee.lastName": {
//                     $regex: query,
//                     $options: "i",
//                   },
//                 },
//                 {
//                   "assignedEmployees.employee.name": {
//                     // For office employee (full name)
//                     $regex: query,
//                     $options: "i",
//                   },
//                 },
//               ],
//             },
//           },
//         ]
//       : []),

//     // 🔍 Filter by payment type
//     ...(paymentType && paymentType !== "All"
//       ? [
//           {
//             $match: {
//               "assignedEmployees.employee.paymentType": paymentType,
//             },
//           },
//         ]
//       : []),

//     // ⚡ Lookup clock record
//     {
//       $lookup: {
//         from: "clockrecords",
//         let: {
//           eid: "$assignedEmployees.employee._id",
//           sid: "$siteId",
//         },
//         pipeline: [
//           {
//             $match: {
//               $expr: {
//                 $and: [
//                   { $eq: ["$employeeId", "$$eid"] },
//                   { $eq: ["$isDeleted", false] },
//                   { $gte: ["$date", start] },
//                   { $lte: ["$date", end] },
//                   { $eq: ["$siteId", "$$sid"] },
//                 ],
//               },
//             },
//           },
//           { $sort: { date: -1 } },
//           { $limit: 1 },
//         ],
//         as: "clockRecord",
//       },
//     },

//     { $unwind: { path: "$clockRecord", preserveNullAndEmptyArrays: true } },

//     // Join Site info
//     {
//       $lookup: {
//         from: "projectsites",
//         localField: "siteId",
//         foreignField: "_id",
//         as: "site",
//       },
//     },
//     { $unwind: "$site" },

//     // 🎯 Final shape
//     {
//       $project: {
//         _id: 1,
//         assignDate: 1,
//         siteId: "$site._id",
//         siteName: "$site.siteName",

//         employee: "$assignedEmployees.employee",
//         isLocked: "$assignedEmployees.isLocked",
//         assignedAt: "$assignedEmployees.assignedAt",

//         // 👇 Unified name for office + site employee
//         displayName: {
//           $cond: [
//             { $ifNull: ["$assignedEmployees.employee.firstName", false] },
//             {
//               $concat: [
//                 "$assignedEmployees.employee.firstName",
//                 " ",
//                 "$assignedEmployees.employee.lastName",
//               ],
//             },
//             "$assignedEmployees.employee.name",
//           ],
//         },

//         clockRecordId: "$clockRecord._id",
//         date: "$clockRecord.date",
//         clockIn: "$clockRecord.clockIn",
//         clockOut: "$clockRecord.clockOut",
//         breaks: "$clockRecord.breaks",
//       },
//     },
//   ];

//   const pipeline = [
//     {
//       $facet: {
//         data: [
//           ...basePipeline,
//           { $skip: (page - 1) * pageSize },
//           { $limit: pageSize },
//         ],
//         totalCount: [...basePipeline, { $count: "count" }],
//       },
//     },
//     {
//       $addFields: {
//         total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
//       },
//     },
//     {
//       $project: {
//         data: 1,
//         total: 1,
//       },
//     },
//   ];

//   const [result] = await SiteAssignmentModel.aggregate(pipeline);

//   console.log("fetchAssignedWithClocksNew result:", result);

//   return {
//     success: true,
//     data: JSON.stringify(result?.data || []),
//     totalCount: result?.total || 0,
//   };
// }

export async function fetchClockRecordsTestOffice({
  siteId = null,
  employeeId = null,
  fromDate = null,
  toDate = null,
  page = 1,
  pageSize = 10,
  search = "",
  paymentType = null,
}) {
  await connect();
  const today = getWorkingDate();
  const start = fromDate ? toWorkingDate(fromDate) : today;
  const end = toDate ? toWorkingDate(toDate) : today;

  const pipeline = [
    // 1️⃣ FILTER CLOCK RECORDS
    {
      $match: {
        isDeleted: false,
        date: { $gte: start, $lte: end },

        ...(employeeId ? { employeeId: createObjectId(employeeId) } : {}),

        ...(siteId && siteId !== "All"
          ? { siteId: createObjectId(siteId) }
          : {}),
      },
    },

    // 2️⃣ SORT (latest first)
    { $sort: { date: -1 } },

    // 3️⃣ GROUP BY EMPLOYEE → GET LAST ENTRY + TOTAL HOURS
    {
      $group: {
        _id: "$employeeId",
        employeeId: { $first: "$employeeId" },
        employeeType: { $first: "$employeeType" },

        lastClockRecord: { $first: "$$ROOT" },

        totalHours: {
          $sum: {
            $divide: [
              {
                $subtract: [
                  {
                    $toDate: {
                      $concat: [
                        {
                          $dateToString: { date: "$date", format: "%Y-%m-%d" },
                        },
                        "T",
                        { $ifNull: ["$clockOut", "$clockIn"] },
                        ":00",
                      ],
                    },
                  },
                  {
                    $toDate: {
                      $concat: [
                        {
                          $dateToString: { date: "$date", format: "%Y-%m-%d" },
                        },
                        "T",
                        "$clockIn",
                        ":00",
                      ],
                    },
                  },
                ],
              },
              1000 * 60 * 60,
            ],
          },
        },
      },
    },

    // 4️⃣ LOOKUP EMPLOYEE DATA (BOTH)
    {
      $lookup: {
        from: "employes",
        localField: "employeeId",
        foreignField: "_id",
        as: "siteEmp",
      },
    },
    {
      $lookup: {
        from: "officeemployes",
        localField: "employeeId",
        foreignField: "_id",
        as: "officeEmp",
      },
    },

    // we have to find the site name as well
    {
      $lookup: {
        from: "projectsites",
        localField: "lastClockRecord.siteId",
        foreignField: "_id",
        as: "site",
      },
    },
    { $unwind: { path: "$site", preserveNullAndEmptyArrays: true } },

    {
      $addFields: {
        employee: {
          $cond: [
            { $gt: [{ $size: "$officeEmp" }, 0] },
            { $arrayElemAt: ["$officeEmp", 0] },
            { $arrayElemAt: ["$siteEmp", 0] },
          ],
        },
      },
    },

    { $unset: ["siteEmp", "officeEmp"] },

    // 5️⃣ SEARCH
    ...(search
      ? [
          {
            $match: {
              $or: [
                { "employee.firstName": { $regex: search, $options: "i" } },
                { "employee.lastName": { $regex: search, $options: "i" } },
                { "employee.name": { $regex: search, $options: "i" } }, // office
              ],
            },
          },
        ]
      : []),

    // 6️⃣ PAYMENT TYPE FILTER
    ...(paymentType && paymentType !== "All"
      ? [
          {
            $match: {
              "employee.paymentType": paymentType,
            },
          },
        ]
      : []),

    // 7️⃣ PAGINATION
    {
      $facet: {
        data: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
        totalCount: [{ $count: "count" }],
      },
    },
  ];

  const [result] = await ClockRecordModel.aggregate(pipeline);

  return {
    success: true,
    data: JSON.stringify(result?.data || []),
    total: result?.totalCount?.[0]?.count || 0,
  };
}

// Site Employee only for assigned with clocks
export async function fetchAssignedWithClocksNew({
  siteId = null,
  employeeId = null,
  fromDate = null,
  toDate = null,
  page = 1,
  pageSize = 10,
  query = null,
  paymentType = null,
}) {
  await connect();

  const today = getWorkingDate();
  const start = fromDate ? toWorkingDate(fromDate) : today;
  const end = toDate ? toWorkingDate(toDate) : today;

  const filter = {};
  if (siteId && siteId !== "All") {
    if (!isValidObjectId(siteId)) {
      return { success: false, message: "Invalid site ID" };
    }
    filter.siteId = createObjectId(siteId);
  }

  const basePipeline = [
    { $match: filter },
    { $unwind: "$assignedEmployees" },

    ...(employeeId
      ? [
          {
            $match: {
              "assignedEmployees.employeeId": createObjectId(employeeId),
            },
          },
        ]
      : []),

    {
      $match: {
        assignDate: { $gte: start, $lte: end },
      },
    },

    // -------------------------------------------
    // Lookup office and site employees
    // -------------------------------------------
    {
      $lookup: {
        from: "employes",
        localField: "assignedEmployees.employeeId",
        foreignField: "_id",
        as: "siteEmp",
      },
    },
    {
      $lookup: {
        from: "officeemployes",
        localField: "assignedEmployees.employeeId",
        foreignField: "_id",
        as: "officeEmp",
      },
    },

    {
      $addFields: {
        employee: {
          $cond: [
            { $gt: [{ $size: "$officeEmp" }, 0] },
            { $arrayElemAt: ["$officeEmp", 0] },
            { $arrayElemAt: ["$siteEmp", 0] },
          ],
        },
        employeeType: {
          $cond: [{ $gt: [{ $size: "$officeEmp" }, 0] }, "office", "site"],
        },
      },
    },

    { $unset: ["officeEmp", "siteEmp"] },

    ...(paymentType && paymentType !== "All"
      ? [{ $match: { "employee.paymentType": paymentType } }]
      : []),

    ...(query
      ? [
          {
            $match: {
              $or: [
                { "employee.firstName": { $regex: query, $options: "i" } },
                { "employee.lastName": { $regex: query, $options: "i" } },
                { "employee.name": { $regex: query, $options: "i" } },
              ],
            },
          },
        ]
      : []),

    // -------------------------------------------
    // Correct realEmployeeId
    // -------------------------------------------
    {
      $addFields: {
        realEmployeeId: {
          $cond: [
            { $eq: ["$employeeType", "office"] },
            "$employee._id",
            "$assignedEmployees.employeeId",
          ],
        },
      },
    },

    // -------------------------------------------
    // FIXED CLOCK LOOKUP (no range match!)
    // -------------------------------------------
    {
      $addFields: {
        assignedSiteId: "$siteId", // store original
      },
    },
    // REPLACE your existing clockRecord $lookup with this block
    {
      $lookup: {
        from: "clockrecords",
        let: {
          rid: "$realEmployeeId",
          sid: "$siteId",
        },
        pipeline: [
          // 1) find any clockrecords for this employee in the date range
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$employeeId", "$$rid"] },
                  { $eq: ["$isDeleted", false] },

                  // keep your date filter (range or exact date depending on your system)
                  { $gte: ["$date", start] },
                  { $lte: ["$date", end] },
                ],
              },
            },
          },

          // 2) compute a priority score:
          //    - score 3 if siteId equals assigned site
          //    - score 2 if siteId is null (office)
          //    - score 1 otherwise (other site)
          {
            $addFields: {
              _priority: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$$sid", null] },
                      { $eq: ["$siteId", "$$sid"] },
                    ],
                  },
                  3,
                  {
                    $cond: [{ $eq: ["$siteId", null] }, 2, 1],
                  },
                ],
              },
            },
          },

          // 3) sort by priority (site match first), then by latest date/time
          { $sort: { _priority: -1, date: -1, createdAt: -1 } },

          // 4) take the best one
          { $limit: 1 },

          // 5) optionally remove the helper field
          { $project: { _priority: 0 } },
        ],
        as: "clockRecord",
      },
    },

    { $unwind: { path: "$clockRecord", preserveNullAndEmptyArrays: true } },

    // -------------------------------------------
    // Lookup site
    // -------------------------------------------
    {
      $lookup: {
        from: "projectsites",
        localField: "siteId",
        foreignField: "_id",
        as: "site",
      },
    },
    { $unwind: "$site" },

    // -------------------------------------------
    // Final projection
    // -------------------------------------------
    {
      $project: {
        _id: 1,
        assignDate: 1,
        siteId: "$site._id",
        siteName: "$site.siteName",

        employeeId: "$realEmployeeId",
        employeeType: 1,

        firstName: {
          $cond: [
            { $eq: ["$employeeType", "office"] },
            "$employee.name",
            "$employee.firstName",
          ],
        },
        lastName: {
          $cond: [
            { $eq: ["$employeeType", "office"] },
            "",
            "$employee.lastName",
          ],
        },

        payRate: "$employee.payRate",
        paymentType: "$employee.paymentType",

        isLocked: "$assignedEmployees.isLocked",
        assignedAt: "$assignedEmployees.assignedAt",

        clockRecordId: { $ifNull: ["$clockRecord._id", null] },
        date: { $ifNull: ["$clockRecord.date", null] },
        clockIn: { $ifNull: ["$clockRecord.clockIn", null] },
        clockOut: { $ifNull: ["$clockRecord.clockOut", null] },
        breaks: { $ifNull: ["$clockRecord.breaks", []] },
      },
    },
  ];

  const pipeline = [
    {
      $facet: {
        data: [
          ...basePipeline,
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
        ],
        totalCount: [...basePipeline, { $count: "count" }],
        summary: [
          ...basePipeline,
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
                                        regex: "^([01]\\d|2[0-3]):([0-5]\\d)$",
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
              averageMinutes: 0,
            },
          ],
        },
      },
    },
    {
      $project: {
        data: 1,
        total: 1,
        summary: 1,
      },
    },
  ];

  const [result] = await SiteAssignmentModel.aggregate(pipeline);

  return {
    success: true,
    data: JSON.stringify(result?.data || []),
    totalCount: result?.total || 0,
    summary: result?.summary || {
      totalEmployees: 0,
      presentToday: 0,
      onBreak: 0,
      clockedOut: 0,
      averageMinutes: 0,
    },
  };
}

export const canEmployeeClockToday = async () => {
  try {
    const { props } = await getServerSideProps();
    const { _id: employeeId } = props?.session?.user;
    if (!employeeId)
      return { success: false, message: "Please contact the admin" };

    const assignDate = getWorkingDate();

    const result = await SiteAssignmentModel.findOne({
      assignDate,
      "assignedEmployees.employeeId": createObjectId(employeeId),
    }).populate({
      path: "siteId",
      select: "siteName",
    });

    if (result) return { success: true, data: JSON.stringify(result.siteId) };
    return { success: false, message: "Admin didn't assign site today" };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something went wrong" };
  }
};

/**
 * Attendance for the filter/export screen, across both workforces.
 *
 * Returns one row per employee-day, of three kinds:
 *   "work"        — a clock record, with its span, breaks and net worked time
 *   "paidLeave"   — an approved leave day the business pays for
 *   "unpaidLeave" — an approved leave day it does not
 *
 * Leave is unioned in rather than looked up per row, because a leave day has
 * no clock record at all: without it a fortnight off simply disappears from
 * the report instead of being visible as leave.
 *
 * Every duration is computed in the database so the summary covers the whole
 * filtered range, not just the page being displayed.
 *
 * @param {object} args
 * @param {"office"|"site"|null} args.employeeType narrow to one workforce
 */
export async function fetchFilterClockRecordData({
  siteId = null,
  employeeId = null,
  employeeType = null,
  fromDate = null,
  toDate = null,
  page = 1,
  pageSize = 10,
  query = null,
  paymentType = null,
}) {
  await connect();

  const today = getWorkingDate();
  const start = fromDate ? toWorkingDate(fromDate) : today;
  const end = toDate ? toWorkingDate(toDate) : today;
  // Leave dates are not guaranteed to sit on UTC midnight, so the upper bound
  // is exclusive of the next day rather than inclusive of `end`.
  const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);

  // Company defaults, read once and injected into the pipeline as constants.
  // Employees on "fixed" weekly hours inherit these, so paid leave re-values
  // itself when a super admin changes the figure — nothing is copied onto the
  // employee records.
  const workSetting = await WorkSettingModel.findOne().lean();
  const fixedWeeklyHours =
    Number(workSetting?.fixedWeeklyHours) || DEFAULT_FIXED_WEEKLY_HOURS;
  const defaultDaysPerWeek =
    Number(workSetting?.defaultDaysPerWeek) || DEFAULT_DAYS_PER_WEEK;

  const hasSite = Boolean(siteId && siteId !== "All" && siteId !== "");
  if (hasSite && !isValidObjectId(siteId)) {
    return { success: false, message: "Invalid site ID" };
  }
  if (employeeId && !isValidObjectId(employeeId)) {
    return { success: false, message: "Invalid employee ID" };
  }

  /** "HH:mm" -> minutes since midnight. */
  const toMin = (field) => ({
    $let: {
      vars: { t: { $ifNull: [field, "00:00"] } },
      in: {
        $add: [
          { $multiply: [{ $toInt: { $substrBytes: ["$$t", 0, 2] } }, 60] },
          { $toInt: { $substrBytes: ["$$t", 3, 2] } },
        ],
      },
    },
  });

  const breakMinutesExpr = {
    $sum: {
      $map: {
        input: { $ifNull: ["$breaks", []] },
        as: "b",
        in: {
          $cond: [
            {
              $and: [
                { $ne: [{ $ifNull: ["$$b.breakIn", null] }, null] },
                { $ne: [{ $ifNull: ["$$b.breakOut", null] }, null] },
              ],
            },
            { $subtract: [toMin("$$b.breakOut"), toMin("$$b.breakIn")] },
            0,
          ],
        },
      },
    },
  };

  // --- worked days -------------------------------------------------------
  const workPipeline = [
    {
      $match: {
        isDeleted: false,
        date: { $gte: start, $lte: end },
        ...(employeeId ? { employeeId: createObjectId(employeeId) } : {}),
        ...(hasSite ? { siteId: createObjectId(siteId) } : {}),
      },
    },
    {
      $lookup: {
        from: "employes",
        localField: "employeeId",
        foreignField: "_id",
        as: "siteEmp",
      },
    },
    {
      $lookup: {
        from: "officeemployes",
        localField: "employeeId",
        foreignField: "_id",
        as: "officeEmp",
      },
    },
    {
      $lookup: {
        from: "projectsites",
        localField: "siteId",
        foreignField: "_id",
        as: "site",
      },
    },
    { $unwind: { path: "$site", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        isOffice: { $gt: [{ $size: "$officeEmp" }, 0] },
        employee: {
          $cond: [
            { $gt: [{ $size: "$officeEmp" }, 0] },
            { $arrayElemAt: ["$officeEmp", 0] },
            { $arrayElemAt: ["$siteEmp", 0] },
          ],
        },
      },
    },
    { $unset: ["siteEmp", "officeEmp"] },
    {
      $addFields: {
        spanMinutes: {
          $cond: [
            {
              $and: [
                { $ne: [{ $ifNull: ["$clockIn", null] }, null] },
                { $ne: [{ $ifNull: ["$clockOut", null] }, null] },
              ],
            },
            { $subtract: [toMin("$clockOut"), toMin("$clockIn")] },
            0,
          ],
        },
        breakMinutes: breakMinutesExpr,
      },
    },
    {
      $project: {
        kind: { $literal: "work" },
        employeeId: 1,
        workforce: { $cond: ["$isOffice", "Office", "Site"] },
        name: {
          $cond: [
            { $ifNull: ["$employee.firstName", false] },
            { $concat: ["$employee.firstName", " ", "$employee.lastName"] },
            "$employee.name",
          ],
        },
        paymentType: "$employee.paymentType",
        date: 1,
        siteName: "$site.siteName",
        clockIn: 1,
        clockOut: 1,
        breaks: 1,
        spanMinutes: 1,
        breakMinutes: 1,
        netMinutes: { $subtract: ["$spanMinutes", "$breakMinutes"] },
        leaveType: { $literal: null },
        isHalfDay: { $literal: false },
        halfDayType: { $literal: null },
        dayUnits: { $literal: 0 },
      },
    },
  ];

  // --- leave days --------------------------------------------------------
  // A site filter narrows worked time, and leave is not attributable to a
  // site, so leave is left out entirely whenever one is applied.
  const leavePipeline = hasSite
    ? null
    : [
        {
          $match: {
            leaveStatus: "Approved",
            ...(employeeId ? { employeeId: createObjectId(employeeId) } : {}),
          },
        },
        { $unwind: "$leaveDates" },
        { $match: { leaveDates: { $gte: start, $lt: endExclusive } } },
        {
          $lookup: {
            from: "employes",
            localField: "employeeId",
            foreignField: "_id",
            as: "siteEmp",
          },
        },
        {
          $lookup: {
            from: "officeemployes",
            localField: "employeeId",
            foreignField: "_id",
            as: "officeEmp",
          },
        },
        {
          $addFields: {
            isOffice: { $gt: [{ $size: "$officeEmp" }, 0] },
            employee: {
              $cond: [
                { $gt: [{ $size: "$officeEmp" }, 0] },
                { $arrayElemAt: ["$officeEmp", 0] },
                { $arrayElemAt: ["$siteEmp", 0] },
              ],
            },
          },
        },
        {
          $addFields: {
            // What one leave day is worth for this employee:
            //   weekly hours / days per week, halved for a half day.
            // Payroll's own figure wins when a request carries one, since that
            // is what was actually paid; the contract is the fallback.
            perDayMinutes: {
              $let: {
                vars: {
                  weekly: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$employee.weeklyHourType", "custom"] },
                          { $gt: [{ $ifNull: ["$employee.weeklyHours", 0] }, 0] },
                        ],
                      },
                      "$employee.weeklyHours",
                      fixedWeeklyHours,
                    ],
                  },
                  days: {
                    $cond: [
                      { $gt: [{ $ifNull: ["$employee.dayPerWeek", 0] }, 0] },
                      "$employee.dayPerWeek",
                      defaultDaysPerWeek,
                    ],
                  },
                },
                in: {
                  $let: {
                    vars: {
                      contractMinutes: {
                        $round: [
                          {
                            $divide: [
                              { $multiply: ["$$weekly", 60] },
                              "$$days",
                            ],
                          },
                          0,
                        ],
                      },
                      payrollMinutes: {
                        $cond: [
                          {
                            $and: [
                              { $gt: [{ $ifNull: ["$leaveTotalHours", 0] }, 0] },
                              { $gt: [{ $ifNull: ["$leaveDays", 0] }, 0] },
                            ],
                          },
                          {
                            $round: [
                              {
                                $divide: [
                                  { $multiply: ["$leaveTotalHours", 60] },
                                  "$leaveDays",
                                ],
                              },
                              0,
                            ],
                          },
                          0,
                        ],
                      },
                    },
                    in: {
                      $let: {
                        vars: {
                          base: {
                            $cond: [
                              { $gt: ["$$payrollMinutes", 0] },
                              "$$payrollMinutes",
                              "$$contractMinutes",
                            ],
                          },
                        },
                        in: {
                          $cond: [
                            { $eq: ["$isHalfDay", true] },
                            { $round: [{ $divide: ["$$base", 2] }, 0] },
                            "$$base",
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        { $unset: ["siteEmp", "officeEmp"] },
        {
          $project: {
            kind: {
              $cond: [
                { $eq: ["$isPaid", false] },
                { $literal: "unpaidLeave" },
                { $literal: "paidLeave" },
              ],
            },
            employeeId: 1,
            workforce: { $cond: ["$isOffice", "Office", "Site"] },
            name: {
              $cond: [
                { $ifNull: ["$employee.firstName", false] },
                { $concat: ["$employee.firstName", " ", "$employee.lastName"] },
                "$employee.name",
              ],
            },
            paymentType: "$employee.paymentType",
            date: "$leaveDates",
            siteName: { $literal: null },
            clockIn: { $literal: null },
            clockOut: { $literal: null },
            breaks: { $literal: [] },
            spanMinutes: { $literal: 0 },
            breakMinutes: { $literal: 0 },
            netMinutes: { $literal: 0 },
            leaveMinutes: "$perDayMinutes",
            leaveType: 1,
            isHalfDay: { $ifNull: ["$isHalfDay", false] },
            halfDayType: { $ifNull: ["$halfDayType", null] },
            isPaid: { $ne: ["$isPaid", false] },
            // A half day counts as half a day against the totals, so a
            // fortnight of half days does not read as ten full days off.
            dayUnits: {
              $cond: [{ $eq: ["$isHalfDay", true] }, 0.5, 1],
            },
          },
        },
      ];

  const pipeline = [
    ...workPipeline,
    ...(leavePipeline
      ? [{ $unionWith: { coll: "leaverequests", pipeline: leavePipeline } }]
      : []),

    // Workforce filter runs after the union so it applies to leave rows too.
    ...(employeeType === "office" || employeeType === "site"
      ? [{ $match: { workforce: employeeType === "office" ? "Office" : "Site" } }]
      : []),

    ...(query
      ? [{ $match: { name: { $regex: query, $options: "i" } } }]
      : []),
    ...(paymentType && paymentType !== "All"
      ? [{ $match: { paymentType } }]
      : []),

    { $sort: { date: -1, name: 1 } },

    {
      $facet: {
        data: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
        totalCount: [{ $count: "count" }],
        summary: [
          {
            $group: {
              _id: null,
              workDays: {
                $sum: { $cond: [{ $eq: ["$kind", "work"] }, 1, 0] },
              },
              totalSpanMinutes: { $sum: "$spanMinutes" },
              totalBreakMinutes: { $sum: "$breakMinutes" },
              totalNetMinutes: { $sum: "$netMinutes" },
              paidLeaveDays: {
                $sum: {
                  $cond: [
                    { $eq: ["$kind", "paidLeave"] },
                    { $ifNull: ["$dayUnits", 1] },
                    0,
                  ],
                },
              },
              paidLeaveMinutes: {
                $sum: {
                  $cond: [
                    { $eq: ["$kind", "paidLeave"] },
                    { $ifNull: ["$leaveMinutes", 0] },
                    0,
                  ],
                },
              },
              unpaidLeaveDays: {
                $sum: {
                  $cond: [
                    { $eq: ["$kind", "unpaidLeave"] },
                    { $ifNull: ["$dayUnits", 1] },
                    0,
                  ],
                },
              },
              unpaidLeaveMinutes: {
                $sum: {
                  $cond: [
                    { $eq: ["$kind", "unpaidLeave"] },
                    { $ifNull: ["$leaveMinutes", 0] },
                    0,
                  ],
                },
              },
              employees: { $addToSet: "$employeeId" },
            },
          },
          {
            $project: {
              _id: 0,
              workDays: 1,
              totalSpanMinutes: 1,
              totalBreakMinutes: 1,
              totalNetMinutes: 1,
              paidLeaveDays: 1,
              paidLeaveMinutes: 1,
              unpaidLeaveDays: 1,
              unpaidLeaveMinutes: 1,
              employeeCount: { $size: "$employees" },
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
              workDays: 0,
              totalSpanMinutes: 0,
              totalBreakMinutes: 0,
              totalNetMinutes: 0,
              paidLeaveDays: 0,
              paidLeaveMinutes: 0,
              unpaidLeaveDays: 0,
              unpaidLeaveMinutes: 0,
              employeeCount: 0,
            },
          ],
        },
      },
    },
    { $project: { data: 1, total: 1, summary: 1 } },
  ];

  const [result] = await ClockRecordModel.aggregate(pipeline);

  // Bank holidays cannot be unioned into the pipeline above — they come from
  // gov.uk, not from a collection — so the ones inside the filtered range are
  // returned alongside the rows for the screen to annotate with.
  //
  // This is what stops a quiet fortnight reading as absence: when the company
  // closes on bank holidays there is no clock record and no leave request for
  // those days, so without naming them the hours simply look low.
  const bankHolidays = await bankHolidaysInRange(startDate, endDate);

  return {
    success: true,
    data: JSON.stringify(result?.data || []),
    totalCount: result?.total || 0,
    summary: result?.summary || null,
    leaveExcluded: hasSite,
    workSetting: { fixedWeeklyHours, defaultDaysPerWeek },
    bankHolidays,
  };
}

/**
 * The company's bank holidays falling inside a reported range.
 *
 * Empty when the company does not observe them — they are ordinary working
 * days then, and the report should say nothing about them. Empty too if the
 * setting or gov.uk cannot be read: a report that silently omits context is
 * better than one that invents it.
 *
 * @returns {Promise<Array<{date: string, title: string}>>}
 */
async function bankHolidaysInRange(startDate, endDate) {
  try {
    const settingsRes = await getWorkSettings();
    const settings = settingsRes?.success
      ? JSON.parse(settingsRes.data || "{}")
      : {};
    if (!settings?.observesBankHolidays) return [];

    const res = await getBankHolidays(settings.bankHolidayRegion);
    if (!res?.success) return [];

    const from = toDayKey(startDate);
    const to = toDayKey(endDate);
    return JSON.parse(res.data || "[]").filter((event) => {
      const key = toDayKey(event?.date);
      if (key === null) return false;
      if (from !== null && key < from) return false;
      if (to !== null && key > to) return false;
      return true;
    });
  } catch (error) {
    console.log("Bank holidays skipped for report:", error?.message);
    return [];
  }
}
