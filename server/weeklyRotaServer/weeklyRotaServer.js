"use server";

import { connect } from "@/db/db";
import WeeklyRotaModel from "@/models/weeklyRotaModel";
import { addDays, isMonday, parseISO, startOfWeek } from "date-fns";
import { getServerSideProps } from "../session/session";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { decrypt } from "@/lib/algo";
import { createObjectId } from "@/lib/mongodb";

// Future to need this function for the Approved and Rejected rota right now this feature is not implemented
export async function handleWeeklyRota(data, weekStartDate, weekId) {
  try {
    const { props } = await getServerSideProps();
    const role = props?.session?.user?.role;
    const approvedStatus = role === "superAdmin" ? "Approve" : "Pending";
    const validDate = isMonday(weekStartDate);
    if (!validDate) return { success: false, message: "Date is not valid" };
    if (weekId) {
      const weekIdValidOrNot = await WeeklyRotaModel.findById(
        { _id: weekId },
        { approvedStatus: 1 }
      );
      if (
        (role === "admin" && weekIdValidOrNot?.approvedStatus === "Pending") ||
        !weekIdValidOrNot
      )
        return { success: false, message: "Status is Pending" };

      const updateData = await WeeklyRotaModel.findByIdAndUpdate(
        { _id: weekId },
        {
          attendanceData: data,
          weekStartDate,
          approvedStatus,
        }
      );
      return { success: true, message: "Weekly Rota Updated" };
    } else {
      const response = await WeeklyRotaModel.create({
        attendanceData: data,
        weekStartDate,
        approvedStatus,
      });
      return { success: true, message: "Weekly Rota Stored" };
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something Went Wrong" };
  }
}

export async function handleWeeklyRotaWithStatus(data, weekStartDate, weekId) {
  try {
    const { props } = await getServerSideProps();
    const approvedBy = props?.session?.user?._id;
    const approvedStatus = "Approved";
    const validDate = isMonday(weekStartDate);
    if (!validDate) return { success: false, message: "Date is not valid" };
    if (weekId) {
      const weekIdValidOrNot = await WeeklyRotaModel.findById({ _id: weekId });
      if (!weekIdValidOrNot)
        return { success: false, message: "Week ID is not valid" };
      const approvedCount = weekIdValidOrNot.approvedCount + 1;
      const updateData = await WeeklyRotaModel.findByIdAndUpdate(
        { _id: weekId },
        {
          attendanceData: data,
          weekStartDate,
          approvedStatus,
          approvedBy,
          approvedCount,
          approvedDate: new Date(),
        }
      );
      return { success: true, message: "Weekly Rota Updated" };
    } else {
      // we have to check if the week already exists
      const weekExist = await WeeklyRotaModel.findOne({
        weekStartDate,
      });
      if (weekExist) {
        return { success: false, message: "Week already exists" };
      }
      const response = await WeeklyRotaModel.create({
        attendanceData: data,
        weekStartDate,
        approvedStatus,
        approvedBy,
        approvedDate: new Date(),
      });
      return { success: true, message: "Weekly Rota Stored" };
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Something Went Wrong" };
  }
}

/*
 Step:1 Check the role SuperAdmin or not
 Step:2 Get the current week data up to 10 result for page 1
 Step:3 Filter wise data if pass the date on filter it date wise otherwise take current week date
 Step:4 Sort the date wise
*/
export async function getWeeklyRotaForSuperAdmin(filterData) {
  try {
    const validPage = Number.isInteger(parseInt(filterData?.page))
      ? parseInt(filterData.page)
      : 1;
    const validLimit = Number.isInteger(parseInt(filterData?.pageSize))
      ? parseInt(filterData.pageSize)
      : 10;
    const weekStartDate = filterData?.date;
    const skip = Math.max((validPage - 1) * validLimit, 0); // Avoid negative skip
    const approvedStatus = filterData?.status;

    // Validate date and ensure it is Monday
    if (weekStartDate) {
      const parsedDate = parseISO(weekStartDate);
      if (!isValid(parsedDate) || !isMonday(parsedDate)) {
        return { success: false, message: "Invalid date or not a Monday" };
      }
    }

    // Connect to MongoDB
    await connect();

    // Build query object
    const query = { isDeleted: false };
    if (weekStartDate) query.weekStartDate = weekStartDate;
    if (approvedStatus) query.approvedStatus = approvedStatus;

    // Aggregation pipeline
    const pipeline = [
      {
        $match: query,
      },
      {
        $lookup: {
          from: "officeemployees",
          localField: "approvedBy",
          foreignField: "_id",
          as: "result",
          pipeline: [
            {
              $project: {
                employeeId: "$_id",
                employeeName: "$name",
              },
            },
          ],
        },
      },
      {
        $sort: { weekStartDate: -1 },
      },
      {
        $skip: skip,
      },
      {
        $limit: validLimit,
      },
    ];

    // Fetch data and total count
    const [totalCountDocuments, weekRota] = await Promise.all([
      WeeklyRotaModel.countDocuments(query), // Count documents
      WeeklyRotaModel.aggregate(pipeline), // Run aggregation
    ]);
    // we have check the if result.employeeName is not empty if empty we have to fetch from officeEmployee
    const resultNew = await Promise.all(
      weekRota?.map(async (item) => {
        // we have to store this employee name in weekRota under result
        // first we have to find the employee name from officeEmployee
        const employeeName = await OfficeEmployeeModel.findOne({
          _id: item?.approvedBy,
        });
        return {
          ...item,
          result: {
            employeeId: employeeName?._id,
            employeeName: employeeName?.name,
          },
        };
      })
    );

    return {
      success: true,
      data: JSON.stringify(resultNew),
      totalCount: totalCountDocuments,
    };
  } catch (error) {
    console.error("Error in getWeeklyRotaForSuperAdmin:", error);
    return {
      success: false,
      message: "An error occurred while fetching data.",
    };
  }
}

// Future to need this function handle Status for weekly rota right now this feature is not implemented
export async function handleWeekApproveStatus(data) {
  try {
    const { props } = await getServerSideProps();
    const approvedBy = props?.session?.user?._id;

    const dbData = {
      ...data,
      approvedBy,
      approvedDate: new Date(),
    };
    const newData = await WeeklyRotaModel.findByIdAndUpdate(
      {
        _id: data?.weekId,
      },
      dbData
    );
    return {
      success: true,
      message: "Week rota approved successfully",
    };
  } catch (error) {
    console.log("Error While on handleWeekRotaStatus", error);
    return {
      success: false,
      message: "Error While on handleWeekRotaStatus",
    };
  }
}

// fetch for the week rota by week start date for per employee
export async function getWeeklyRotaByWeekStartDate(params) {
  try {
    // we have to find it out the monday based on the weekStartDate
    if (!params || !params.employeeId || !params.date) {
      return { success: false, message: "Employee ID and date are required" };
    }
    const { employeeId, date } = params;
    const { props } = await getServerSideProps();
    const role = props?.session?.user?.role;
    let employee;
    if (role !== "superAdmin" && role !== "admin") {
      employee = props?.session?.user?._id;
    } else {
      employee = decrypt(employeeId);
    }
    // based on the date we hve to find the weekStartDate
    const weekStartDate = date ? startOfWeek(date, { weekStartsOn: 1 }) : null;
    const weekEndDate = weekStartDate ? addDays(weekStartDate, 6) : null;
    if (!weekStartDate || !weekEndDate || !isMonday(weekStartDate)) {
      return { success: false, message: "Week start date is required" };
    }
    // Connect to MongoDB
    await connect();
    // Fetch the weekly rota by week start date
    const pipeline = [
      {
        $match: {
          weekStartDate: new Date(date),
          "attendanceData.employeeId": createObjectId(employee),
          isDeleted: false,
        },
      },
      {
        $project: {
          weekStartDate: 1,
          attendanceData: {
            $filter: {
              input: "$attendanceData",
              as: "attendance",
              cond: {
                $eq: ["$$attendance.employeeId", createObjectId(employee)],
              },
            },
          },
        },
      },
    ];
    const weekRota = await WeeklyRotaModel.aggregate(pipeline).then(
      (result) => result[0] // Get the first matching document
    );
    if (!weekRota) {
      return { success: false, message: "No weekly rota found for this date" };
    }
    // console.log("weekRota", weekRota);
    return { success: true, data: JSON.stringify(weekRota) };
  } catch (error) {
    console.error("Error in getWeeklyRotaByWeekStartDate:", error);
    return {
      success: false,
      message: "An error occurred while fetching data.",
    };
  }
}
