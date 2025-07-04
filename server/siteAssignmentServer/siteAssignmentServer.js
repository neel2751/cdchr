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

// Assign or update today's site assignment
export const assignEmployeesToSite = async (data) => {
  try {
    const { props } = await getServerSideProps();
    const { _id: adminId } = props?.session?.user;

    if (!adminId) {
      return {
        success: false,
        message: "You are not authorized to assign Site",
      };
    }

    const { siteId, employee: employeeIds, assignDate } = data;

    const today = new Date(assignDate).toISOString().split("T")[0];
    const date = new Date(`${today}T00:00:00.000Z`);

    // 🔒 Step 1: Check if any of these employees are already assigned on that date
    const conflictingAssignments = await SiteAssignmentModel.find({
      assignDate: date,
      "assignedEmployees.employeeId": { $in: employeeIds.map(createObjectId) },
    });

    const alreadyAssignedEmployeeIds = new Set();

    for (const doc of conflictingAssignments) {
      for (const ae of doc.assignedEmployees) {
        if (employeeIds.includes(ae.employeeId.toString())) {
          alreadyAssignedEmployeeIds.add(ae.employeeId.toString());
        }
      }
    }

    if (alreadyAssignedEmployeeIds.size > 0) {
      return {
        success: false,
        message: `Employees already assigned on ${today}: ${[
          ...alreadyAssignedEmployeeIds,
        ].join(", ")}`,
      };
    }

    // 🔄 Step 2: Proceed to create or update the assignment
    const existingAssignment = await SiteAssignmentModel.findOne({
      siteId,
      assignDate: date,
    });

    if (!existingAssignment) {
      const newAssignment = new SiteAssignmentModel({
        siteId,
        assignDate: date,
        assignedEmployees: employeeIds.map((id) => ({
          employeeId: createObjectId(id),
          assignedBy: adminId,
        })),
      });

      const res = await newAssignment.save();
      if (!res)
        return { success: false, message: "Problem while assigning site" };
      return { success: true, message: "Site assigned successfully" };
    }

    // Add only new employees to existing document
    const newAssignments = employeeIds.filter(
      (id) =>
        !existingAssignment.assignedEmployees.some(
          (ae) => ae.employeeId.toString() === id
        )
    );

    newAssignments.forEach((id) => {
      existingAssignment.assignedEmployees.push({
        employeeId: createObjectId(id),
        assignedBy: adminId,
      });
    });

    const res = await existingAssignment.save();
    if (!res)
      return { success: false, message: "Problem while assigning site" };
    return { success: true, message: "Site assigned successfully" };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something went wrong" };
  }
};

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
    {
      $match: {
        ...(paymentType !== "All" && {
          "employee.paymentType": paymentType,
        }),
      },
    },
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

  const [result] = await SiteAssignmentModel.aggregate(pipeline);
  return {
    data: JSON.stringify(result.data),
    totalCount: result.total,
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
        actions: [
          {
            action: "clockIn",
            time: currentTime,
            source: "scanner",
          },
        ],
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
      await SiteClockModel.updateOne(
        { employeeId: employeeOid, date: date },
        {
          $set: { breakIn: currentTime, status: "break-in" },
          $push: {
            actions: {
              action: "breakIn",
              time: currentTime,
              source: "scanner",
            },
          },
        }
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
          $push: {
            actions: {
              action: "breakOut",
              time: currentTime,
              source: "scanner",
            },
          },
        }
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
          $push: {
            actions: {
              action: "clockOut",
              time: currentTime,
              source: "scanner",
            },
          },
        }
      );

      const autoFlag =
        !existingAttendance.breakIn || !existingAttendance.breakOut;
      await SiteClockModel.updateOne(
        { employeeId: employeeOid, date: date },
        { $set: { clockInStatus: autoFlag } }
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
      error
    );
    return { success: false, message: "Something went wrong" };
  }
}

export async function fetchFilteredAttendanceData({
  siteId = null,
  employeeId = null,
  fromDate = null,
  toDate = null,
  employeeType = null,
  page = 1,
  pageSize = 10,
  query = null,
  paymentType = null,
}) {
  console.log("Fetching filtered attendance data", employeeType);
  if (employeeType !== "siteEmployee" && employeeType !== "officeEmployee") {
    return { success: false, message: "Invalid employee type" };
  }
  if (employeeType === "siteEmployee") {
    console.log("Fetching office employee clocks");
    return fetchAssignedWithClocks({
      siteId,
      employeeId,
      fromDate,
      toDate,
      page,
      pageSize,
      query,
      paymentType,
    });
  } else {
    return fetchLiveOfficeClock({
      employeeId,
      fromDate,
      toDate,
      query,
      page,
      pageSize,
    });
  }
}
