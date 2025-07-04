"use server";

import AttendanceModel from "@/models/attendanceModel";
import mongoose from "mongoose";

export async function getAssignSiteData(filterData) {
  const siteQuery = filterData?.siteId ? { siteId: filterData.siteId } : {};
  const monthQuery = filterData?.month
    ? { $expr: { $eq: [{ $month: "$attendanceDate" }, filterData.month] } }
    : {};

  const sanitizedSearch = filterData?.query?.trim() || "";
  const validPage = parseInt(filterData?.page || 1);
  const validLimit = parseInt(filterData?.limit || 10);
  const skip = (validPage - 1) * validLimit;
  const query = { $and: [siteQuery, monthQuery] };
  //   const query2 = {
  //     $and: [
  //       siteQuery,
  //       monthQuery,
  //       {
  //         $or: [
  //           { name: { $regex: sanitizedSearch, $options: "i" } },
  //           { description: { $regex: sanitizedSearch, $options: "i" } },
  //         ],
  //       },
  //     ],
  //   };
  const query2 = sanitizedSearch
    ? {
        $or: [
          { "employee.firstName": { $regex: sanitizedSearch, $options: "i" } },
          { "employee.lastName": { $regex: sanitizedSearch, $options: "i" } },
        ],
      }
    : {};

  const pipeline = [
    {
      $match: query,
    },
    {
      //lookup from employe collection
      $lookup: {
        from: "employes",
        localField: "employeAttendance.employeeId",
        foreignField: "_id",
        as: "employee",
      },
    },
    {
      $unwind: "$employee",
    },
    {
      $lookup: {
        from: "projectsites",
        localField: "siteId",
        foreignField: "_id",
        as: "site",
      },
    },
    {
      $unwind: "$site",
    },
    {
      $match: query2,
    },
    {
      $sort: {
        "employeeAttendance.attendanceDate": -1,
      },
    },
    {
      $skip: skip,
    },
    {
      $limit: validLimit,
    },
    {
      $group: {
        _id: "$_id", // Group by document ID (or another relevant field)
        attendance: { $push: "$$ROOT" },
        employeInfo: {
          $push: {
            label: {
              $concat: ["$employee.firstName", " ", "$employee.lastName"],
            },
            value: "$employee._id",
          },
        },
        siteInfo: {
          $push: {
            label: "$site.siteName",
            value: "$site._id",
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        employeInfo: 1,
        siteInfo: 1,
        attendance: 1,
      },
    },
  ];

  try {
    const totalCount = await AttendanceModel.countDocuments({
      ...query,
      ...query2,
    });
    const response = await AttendanceModel.aggregate(pipeline);
    return {
      data: JSON.stringify(response),
      totalCount: totalCount,
    };
  } catch (error) {
    console.log(error);
  }
}

export async function getEmployeeAttendanceData(filterData) {
  const siteId = filterData?.siteId;
  const month = filterData?.month;

  const sanitizedSearch = filterData?.query?.trim() || "";
  const validPage = parseInt(filterData?.page || 1);
  const validLimit = parseInt(filterData?.pageSize || 10);
  const skip = (validPage - 1) * validLimit;

  const query2 = sanitizedSearch
    ? {
        $or: [
          {
            "employeeDetails.firstName": {
              $regex: sanitizedSearch,
              $options: "i",
            },
          },
          {
            "employeeDetails.lastName": {
              $regex: sanitizedSearch,
              $options: "i",
            },
          },
        ],
      }
    : {};

  const siteMatch = siteId
    ? { siteId: new mongoose.Types.ObjectId(siteId) }
    : {};
  const monthMatch = month
    ? {
        $expr: { $eq: [{ $month: "$attendanceDate" }, month] },
      }
    : {};

  try {
    // Establish database connection
    // await connect();

    // Aggregation pipeline

    const countDocuments = await AttendanceModel.countDocuments({
      ...siteMatch,
      ...monthMatch,
    });

    const result = await AttendanceModel.aggregate([
      {
        $match: {
          $and: [siteMatch, monthMatch],
        },
      },

      {
        //lookup from employe collection
        $lookup: {
          from: "employes",
          localField: "employeAttendance.employeeId",
          foreignField: "_id",
          as: "employeeDetails",
        },
      },
      {
        $lookup: {
          from: "projectsites",
          localField: "siteId",
          foreignField: "_id",
          as: "siteDetails",
        },
      },
      {
        $unwind: {
          path: "$siteDetails",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $group: {
          _id: {
            originalId: "$_id", // Preserve the original document's _id
            siteId: "$siteId",
            date: "$attendanceDate",
          },
          siteInfo: {
            $first: {
              label: "$siteDetails.siteName",
              value: "$siteDetails._id",
              siteType: "$siteDetails.siteType",
              siteStatus: "$siteDetails.status",
            },
          },
          employeeInfo: {
            $push: {
              $map: {
                input: "$employeeDetails",
                as: "employee",
                in: {
                  label: {
                    $concat: [
                      "$$employee.firstName",
                      " ",
                      "$$employee.lastName",
                    ],
                  },
                  value: "$$employee._id",
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          employeeInfo: {
            $reduce: {
              input: "$employeeInfo",
              initialValue: [],
              in: { $concatArrays: ["$$value", "$$this"] },
            },
          },
          date: "$_id.date",
        },
      },
      {
        $project: {
          _id: 0, // Exclude the _id field
          siteInfo: 1,
          employeeInfo: 1,
          id: "$_id.originalId", // Include the original _id
          date: 1,
        },
      },
      {
        $facet: {
          paginatedResults: [{ $skip: skip }, { $limit: validLimit }],
        },
      },
    ]);

    const paginatedResults = result[0]?.paginatedResults || [];
    const totalCount = countDocuments || 0;

    return {
      status: true,
      data: JSON.stringify(paginatedResults),
      totalCount,
    };
  } catch (error) {
    console.error(error);
    return { status: false, message: "Failed to Get Site Assign" };
  }
}
