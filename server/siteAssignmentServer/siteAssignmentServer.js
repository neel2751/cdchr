"use server";

import SiteAssignmentModel from "@/models/siteAssignmentModel";
import { getServerSideProps } from "../session/session";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { normalizeDateToUTC } from "@/lib/formatDate";
import { connect } from "@/db/db";
import SiteClockModel from "@/models/siteClockModel";
import { getCurrentTimeAndDate } from "../2FAServer/qrcodeServer";
import EmployeModel from "@/models/employeModel";
import { decrypt } from "@/lib/algo";
import { fetchLiveOfficeClock } from "../timeOffServer/timeOffServer";
import ClockRecordModel from "@/models/clockInModel";
import { withAudit, recordAudit } from "@/lib/audit";

// Assign or update today's site assignment
export const assignEmployeesToSite = withAudit(
  "SiteAssignment.assign",
  async (data) => {
  try {
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
  const today = new Date().setHours(0, 0, 0, 0);
  const assignment = await SiteAssignmentModel.findOne({
    siteId,
    date: today,
  }).populate("assignedEmployees.employeeId"); // optional to populate

  return assignment?.assignedEmployees || [];
};

export const getTodayAssignedEmployees = async () => {
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

export const getLiveSiteClocks = async (siteId) => {
  const filter = {
    assignDate: normalizeDateToUTC(new Date()),
    isDeleted: false,
  };

  if (siteId) {
    filter["siteId"] = createObjectId(siteId);
  }

  const clocks = await SiteClockModel.aggregate([
    // { $match: filter },
    {
      $lookup: {
        from: "employes",
        localField: "employeeId",
        foreignField: "_id",
        as: "employee",
      },
    },
    { $unwind: "$employee" },
    {
      $lookup: {
        from: "projectsites",
        localField: "siteId",
        foreignField: "_id",
        as: "site",
      },
    },
    { $unwind: "$site" },
    {
      $project: {
        _id: 1,
        date: 1,
        clockIn: 1,
        clockOut: 1,
        breakIn: 1,
        breakOut: 1,
        "employee._id": 1,
        "employee.firstName": 1,
        "employee.lastName": 1,
        "site.name": 1,
      },
    },
  ]);
  return clocks;
};

export async function fetchLiveSiteClocksOld({
  siteId = null,
  employeeId = null,
}) {
  const filter = {
    date: normalizeDateToUTC(new Date()),
    isDeleted: false,
  };

  if (siteId) {
    filter["siteId"] = createObjectId(siteId);
  }

  if (employeeId) {
    filter["employeeId"] = createObjectId(employeeId);
  }

  await connect();

  const clocks = await SiteClockModel.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: "employes",
        localField: "employeeId",
        foreignField: "_id",
        as: "employee",
      },
    },
    { $unwind: "$employee" },
    {
      $lookup: {
        from: "projectsites",
        localField: "siteId",
        foreignField: "_id",
        as: "site",
      },
    },
    { $unwind: "$site" },
    {
      $project: {
        _id: 1,
        date: 1,
        clockIn: 1,
        clockOut: 1,
        breakIn: 1,
        breakOut: 1,
        siteId: 1,
        isLocked: 1,
        status: 1,
        "employee._id": 1,
        "employee.firstName": 1,
        "employee.lastName": 1,
        "employee.payRate": 1,
        "site.siteName": 1,
      },
    },
  ]);

  console.log(clocks);

  return { data: JSON.stringify(clocks) };
}

export async function fetchLiveSiteClocks({
  siteId = null,
  employeeId = null,
  fromDate = null,
  toDate = null,
  page = 1,
  pageSize = 10,
  query,
}) {
  await connect();

  const today = normalizeDateToUTC(new Date());
  const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
  const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;

  const match = {
    isDeleted: false,
    date: { $gte: start, $lte: end },
  };

  if (siteId) match.siteId = createObjectId(siteId);
  if (employeeId) match.employeeId = createObjectId(employeeId);

  const skip = (page - 1) * pageSize;
  const limit = pageSize;

  const clocks = await SiteClockModel.aggregate([
    { $match: match },
    {
      $addFields: {
        clockInDate: {
          $dateFromParts: {
            year: { $year: "$date" },
            month: { $month: "$date" },
            day: { $dayOfMonth: "$date" },
            hour: { $toInt: { $substr: ["$clockIn", 0, 2] } },
            minute: { $toInt: { $substr: ["$clockIn", 3, 2] } },
          },
        },
        clockOutDate: {
          $dateFromParts: {
            year: { $year: "$date" },
            month: { $month: "$date" },
            day: { $dayOfMonth: "$date" },
            hour: { $toInt: { $substr: ["$clockOut", 0, 2] } },
            minute: { $toInt: { $substr: ["$clockOut", 3, 2] } },
          },
        },
        breakInDate: {
          $cond: [
            { $ifNull: ["$breakIn", false] },
            {
              $dateFromParts: {
                year: { $year: "$date" },
                month: { $month: "$date" },
                day: { $dayOfMonth: "$date" },
                hour: { $toInt: { $substr: ["$breakIn", 0, 2] } },
                minute: { $toInt: { $substr: ["$breakIn", 3, 2] } },
              },
            },
            null,
          ],
        },
        breakOutDate: {
          $cond: [
            { $ifNull: ["$breakOut", false] },
            {
              $dateFromParts: {
                year: { $year: "$date" },
                month: { $month: "$date" },
                day: { $dayOfMonth: "$date" },
                hour: { $toInt: { $substr: ["$breakOut", 0, 2] } },
                minute: { $toInt: { $substr: ["$breakOut", 3, 2] } },
              },
            },
            null,
          ],
        },
      },
    },
    {
      $addFields: {
        workedMinutes: {
          $subtract: [
            { $subtract: ["$clockOutDate", "$clockInDate"] },
            {
              $subtract: [
                { $ifNull: ["$breakOutDate", "$clockOutDate"] },
                { $ifNull: ["$breakInDate", "$clockInDate"] },
              ],
            },
          ],
        },
      },
    },
    {
      $lookup: {
        from: "employees",
        localField: "employeeId",
        foreignField: "_id",
        as: "employee",
      },
    },
    { $unwind: "$employee" },
    ...(query
      ? [
          {
            $match: {
              $or: [
                { "employee.firstName": { $regex: query, $options: "i" } },
                { "employee.lastName": { $regex: query, $options: "i" } },
                { "site.siteName": { $regex: query, $options: "i" } },
              ],
            },
          },
        ]
      : []),
    {
      $lookup: {
        from: "projectsites",
        localField: "siteId",
        foreignField: "_id",
        as: "site",
      },
    },
    { $unwind: "$site" },
    {
      $project: {
        _id: 1,
        date: 1,
        clockIn: 1,
        clockOut: 1,
        breakIn: 1,
        breakOut: 1,
        workedMinutes: 1,
        "employee._id": 1,
        "employee.firstName": 1,
        "employee.lastName": 1,
        "site._id": 1,
        "site.siteName": 1,
      },
    },
    { $skip: skip },
    { $limit: limit },
  ]);

  console.log(clocks);

  return { data: JSON.stringify(clocks) };
}

export async function fetchAssignedWithClocks({
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

  const today = normalizeDateToUTC(new Date());
  const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
  const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;

  const filter = {};

  if (siteId && siteId !== "All") {
    console.log("siteId", siteId);
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
    {
      $lookup: {
        from: "employes",
        localField: "assignedEmployees.employeeId",
        foreignField: "_id",
        as: "employee",
      },
    },
    { $unwind: "$employee" },
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
              ],
            },
          },
        ]
      : []),
    {
      $lookup: {
        from: "siteclocks",
        let: {
          eid: "$assignedEmployees.employeeId",
          sid: siteId ? createObjectId(siteId) : null,
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $gte: ["$date", start] },
                  { $lte: ["$date", end] },
                  { $eq: ["$isDeleted", false] },
                  {
                    $or: [
                      { $eq: ["$$sid", null] },
                      { $eq: ["$siteId", "$$sid"] },
                    ],
                  },
                  { $eq: ["$employeeId", "$$eid"] },
                ],
              },
            },
          },
        ],
        as: "clockRecords",
      },
    },
    { $unwind: { path: "$clockRecords", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "projectsites",
        localField: "siteId",
        foreignField: "_id",
        as: "site",
      },
    },
    { $unwind: "$site" },
    {
      $project: {
        _id: 1, // SiteAssignment document ID
        assignDate: 1,
        employeeId: "$assignedEmployees.employeeId",
        assignedAt: "$assignedEmployees.assignedAt",
        isLocked: "$assignedEmployees.isLocked",

        firstName: "$employee.firstName",
        lastName: "$employee.lastName",
        payRate: "$employee.payRate",
        paymentType: "$employee.paymentType",

        siteId: "$site._id",
        siteName: "$site.siteName",

        clockRecordId: { $ifNull: ["$clockRecords._id", null] },
        clockIn: { $ifNull: ["$clockRecords.clockIn", null] },
        clockOut: { $ifNull: ["$clockRecords.clockOut", null] },
        breakIn: { $ifNull: ["$clockRecords.breakIn", null] },
        breakOut: { $ifNull: ["$clockRecords.breakOut", null] },
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
    data: JSON.stringify(result.data),
    totalCount: result.total,
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

//   // ✅ Normalize dates
//   const today = normalizeDateToUTC(new Date());
//   const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
//   const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;

//   // ✅ Build base filter
//   const filter = {};
//   if (siteId && siteId !== "All") {
//     if (!isValidObjectId(siteId)) {
//       return { success: false, message: "Invalid site ID" };
//     }
//     filter.siteId = createObjectId(siteId);
//   }

//   // ✅ Base aggregation pipeline
//   const basePipeline = [
//     { $match: filter },
//     { $unwind: "$assignedEmployees" },

//     ...(employeeId
//       ? [
//           {
//             $match: {
//               "assignedEmployees.employeeId": createObjectId(employeeId),
//             },
//           },
//         ]
//       : []),

//     {
//       $match: {
//         assignDate: { $gte: start, $lte: end },
//       },
//     },

//     // 🔍 Dual lookup for both employee types
//     {
//       $lookup: {
//         from: "employes", // ✅ site employees collection
//         localField: "assignedEmployees.employeeId",
//         foreignField: "_id",
//         as: "siteEmp",
//       },
//     },
//     {
//       $lookup: {
//         from: "officeemployes", // ✅ office employees collection
//         localField: "assignedEmployees.employeeId",
//         foreignField: "_id",
//         as: "officeEmp",
//       },
//     },

//     // ✅ Merge whichever matched
//     {
//       $addFields: {
//         employee: {
//           $cond: [
//             { $gt: [{ $size: "$officeEmp" }, 0] },
//             { $arrayElemAt: ["$officeEmp", 0] },
//             { $arrayElemAt: ["$siteEmp", 0] },
//           ],
//         },
//         employeeType: {
//           $cond: [{ $gt: [{ $size: "$officeEmp" }, 0] }, "office", "site"],
//         },
//       },
//     },
//     { $unset: ["officeEmp", "siteEmp"] },

//     ...(paymentType && paymentType !== "All"
//       ? [{ $match: { "employee.paymentType": paymentType } }]
//       : []),

//     ...(query
//       ? [
//           {
//             $match: {
//               $or: [
//                 { "employee.firstName": { $regex: query, $options: "i" } },
//                 { "employee.lastName": { $regex: query, $options: "i" } },
//               ],
//             },
//           },
//         ]
//       : []),

//     // ✅ Lookup from unified "clocks" collection
//     {
//       $lookup: {
//         from: "clockrecords",
//         let: {
//           eid: "$assignedEmployees.employeeId",
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
//                   {
//                     $or: [
//                       { $eq: ["$siteId", "$$sid"] },
//                       {
//                         $and: [
//                           { $eq: ["$$sid", null] },
//                           { $eq: ["$siteId", null] },
//                         ],
//                       },
//                     ],
//                   },
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

//     // ✅ Join site info
//     {
//       $lookup: {
//         from: "projectsites",
//         localField: "siteId",
//         foreignField: "_id",
//         as: "site",
//       },
//     },
//     { $unwind: "$site" },

//     // ✅ Final projection
//     {
//       $project: {
//         _id: 1,
//         assignDate: 1,
//         siteId: "$site._id",
//         siteName: "$site.siteName",

//         employeeId: "$assignedEmployees.employeeId",
//         employeeType: 1,
//         firstName: {
//           $cond: [
//             { $eq: ["$employeeType", "office"] },
//             "$employee.name",
//             "$employee.firstName",
//           ],
//         },
//         lastName: {
//           $cond: [
//             { $eq: ["$employeeType", "office"] },
//             "", // office employees don't have lastName
//             "$employee.lastName",
//           ],
//         },
//         payRate: "$employee.payRate",
//         paymentType: "$employee.paymentType",

//         isLocked: "$assignedEmployees.isLocked",
//         assignedAt: "$assignedEmployees.assignedAt",

//         // ✅ Clock data
//         clockRecordId: { $ifNull: ["$clockRecord._id", null] },
//         date: { $ifNull: ["$clockRecord.date", null] },
//         clockIn: { $ifNull: ["$clockRecord.clockIn", null] },
//         clockOut: { $ifNull: ["$clockRecord.clockOut", null] },
//         breaks: { $ifNull: ["$clockRecord.breaks", []] },
//       },
//     },
//   ];

//   // ✅ Pagination facet
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

//   // ✅ Run aggregation
//   const [result] = await SiteAssignmentModel.aggregate(pipeline);

//   return {
//     success: true,
//     data: JSON.stringify(result?.data || []),
//     totalCount: result?.total || 0,
//   };
// }

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
  const today = normalizeDateToUTC(new Date());
  const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
  const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;

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

//   const today = normalizeDateToUTC(new Date());
//   const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
//   const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;

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
  const today = normalizeDateToUTC(new Date());
  const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
  const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;

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

  const today = normalizeDateToUTC(new Date());
  const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
  const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;

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

    const assignDate = normalizeDateToUTC(new Date());

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

export async function storeSiteEmployeeClockTime(decode) {
  try {
    const employeeId = decode.employeeId;
    const action = decode.action;
    const siteId = decode?.siteId;

    const { success, date, currentTime } = await getCurrentTimeAndDate();
    if (!success) return { success: false, message: "Error getting time" };

    const employeeOid = createObjectId(employeeId);
    await connect();

    const existing = await EmployeModel.findById(employeeOid);
    if (!existing) return { success: false, message: "Employee not found" };

    const existingAttendance = await SiteClockModel.findOne({
      employeeId: employeeOid,
      siteId: createObjectId(siteId),
      date: date,
    });

    const MIN_BREAK_DURATION_MINUTES = 30;
    const MIN_WORK_HOURS_TO_CLOCK_OUT = 2;
    const MIN_BREAK_TIME_HOURS = 2;

    if (!existingAttendance && action !== "clockIn") {
      return { success: false, message: "You must clock in first." };
    }

    if (!existingAttendance && action === "clockIn") {
      await new SiteClockModel({
        employeeId: employeeOid,
        date: date,
        siteId,
        clockIn: currentTime,
        status: "checked-in",
        isLocked: true,
        clockInStatus: true,
        // actions: [
        //   {
        //     action: "clockIn",
        //     time: currentTime,
        //     source: "scanner",
        //   },
        // ],
      }).save();
      return { success: true, message: "Clocked In", employeeId };
    }

    if (
      action === "breakIn" &&
      !existingAttendance.breakIn &&
      !existingAttendance.clockOut
    ) {
      const timeSinceClockIn =
        (currentTime - existingAttendance.clockIn) / (1000 * 60 * 60); // in hours

      if (timeSinceClockIn < MIN_BREAK_TIME_HOURS) {
        return {
          success: false,
          message: `Cannot take break within ${MIN_BREAK_TIME_HOURS} hours of clocking in.`,
        };
      }
      console.log("Storing break in at", currentTime);
      await SiteClockModel.updateOne(
        { employeeId: employeeOid, date: date },
        {
          $set: { breakIn: currentTime, status: "break-in" },
          // $push: {
          //   actions: {
          //     action: "breakIn",
          //     time: currentTime,
          //     source: "scanner",
          //   },
          // },
        },
      );
      return { success: true, message: "Break In", employeeId };
    }

    if (
      action === "breakOut" &&
      existingAttendance.breakIn &&
      !existingAttendance.breakOut &&
      !existingAttendance.clockOut
    ) {
      const breakDuration =
        (currentTime - existingAttendance.breakIn) / (1000 * 60); // in minutes
      if (breakDuration < MIN_BREAK_DURATION_MINUTES) {
        return {
          success: false,
          message: `Break must be at least ${MIN_BREAK_DURATION_MINUTES} minutes.`,
        };
      }

      await SiteClockModel.updateOne(
        { employeeId: employeeOid, date: date },
        {
          $set: { breakOut: currentTime, status: "break-out" },
          // $push: {
          //   actions: {
          //     action: "breakOut",
          //     time: currentTime,
          //     source: "scanner",
          //   },
          // },
        },
      );
      return { success: true, message: "Break Out", employeeId };
    }

    if (action === "clockOut" && !existingAttendance.clockOut) {
      const hoursSinceClockIn =
        (currentTime - existingAttendance.clockIn) / (1000 * 60 * 60); // in hours
      if (hoursSinceClockIn < MIN_WORK_HOURS_TO_CLOCK_OUT) {
        return {
          success: false,
          message: `You must work at least ${MIN_WORK_HOURS_TO_CLOCK_OUT} hours before clocking out.`,
        };
      }

      await SiteClockModel.updateOne(
        { employeeId: employeeOid, date: date },
        {
          $set: { clockOut: currentTime, status: "clocked-out" },
          // $push: {
          //   actions: {
          //     action: "clockOut",
          //     time: currentTime,
          //     source: "scanner",
          //   },
          // },
        },
      );

      const autoFlag =
        !existingAttendance.breakIn || !existingAttendance.breakOut;
      await SiteClockModel.updateOne(
        { employeeId: employeeOid, date: date },
        { $set: { clockInStatus: autoFlag } },
      );

      return {
        success: true,
        message: autoFlag ? "Clocked Out (No Break)" : "Clocked Out",
        employeeId,
      };
    }

    return {
      success: false,
      message: "Already clocked out or invalid action.",
    };
  } catch (error) {
    console.error("Error storing clock time:", error);
    return { success: false, message: "Error storing clock time" };
  }
}

export async function getSiteEmployeeTodayAttendanceData(employeeId) {
  try {
    await connect();
    const today = normalizeDateToUTC(new Date());

    // .lean() returns a plain JS object without Mongoose metadata
    const clockInfo = await SiteClockModel.findOne({
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
      error,
    );
    return { success: false, message: "Something went wrong" };
  }
}

// export async function fetchFilteredAttendanceData({
//   siteId = null,
//   employeeId = null,
//   fromDate = null,
//   toDate = null,
//   employeeType = null,
//   page = 1,
//   pageSize = 10,
//   query = null,
//   paymentType = null,
// }) {
//   console.log("Fetching filtered attendance data", employeeType);
//   if (employeeType !== "siteEmployee" && employeeType !== "officeEmployee") {
//     return { success: false, message: "Invalid employee type" };
//   }
//   if (employeeType === "siteEmployee") {
//     console.log("Fetching office employee clocks");
//     return fetchAssignedWithClocksNew({
//       siteId,
//       employeeId,
//       fromDate,
//       toDate,
//       page,
//       pageSize,
//       query,
//       paymentType,
//     });
//   } else {
//     return fetchLiveOfficeClock({
//       employeeId,
//       fromDate,
//       toDate,
//       query,
//       page,
//       pageSize,
//     });
//   }
// }

export async function fetchFilterClockRecordData({
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

  const today = normalizeDateToUTC(new Date());
  const start = fromDate ? normalizeDateToUTC(new Date(fromDate)) : today;
  const end = toDate ? normalizeDateToUTC(new Date(toDate)) : today;

  const filter = {};
  if (siteId && siteId !== "All") {
    if (!isValidObjectId(siteId)) {
      return { success: false, message: "Invalid site ID" };
    }
    filter.siteId = createObjectId(siteId);
  }

  const pipeline = [
    // Initial match filter
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
    // Lookup both site and office employees
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

    // add the site name as well
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
    // Search filter
    ...(query
      ? [
          {
            $match: {
              $or: [
                { "employee.firstName": { $regex: query, $options: "i" } },
                { "employee.lastName": { $regex: query, $options: "i" } },
                { "employee.name": { $regex: query, $options: "i" } }, // office
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
              "employee.paymentType": paymentType,
            },
          },
        ]
      : []),
    // Pagination facet

    {
      $project: {
        // we don't have to send the entire employee object back
        name: {
          $cond: [
            { $ifNull: ["$employee.firstName", false] },
            {
              $concat: ["$employee.firstName", " ", "$employee.lastName"],
            },
            "$employee.name",
          ],
        },
        paymentType: "$employee.paymentType",
        clockIn: 1,
        clockOut: 1,
        date: 1,
        breaks: 1,
        siteName: "$site.siteName",
      },
    },

    {
      $facet: {
        data: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
        totalCount: [{ $count: "count" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
      },
    },
    {
      $project: {
        data: 1,
        total: 1,
      },
    },
  ];
  const [result] = await ClockRecordModel.aggregate(pipeline);
  return {
    success: true,
    data: JSON.stringify(result?.data || []),
    totalCount: result?.total || 0,
  };
}
