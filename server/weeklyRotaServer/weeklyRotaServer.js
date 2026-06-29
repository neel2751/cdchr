"use server";

import { connect } from "@/db/db";
import WeeklyRotaModel from "@/models/weeklyRotaModel";
import WeeklyRotaVersionModel from "@/models/weeklyRotaVersionModel";
import { addDays, isMonday, parseISO, startOfWeek } from "date-fns";
import { getServerSideProps } from "../session/session";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { decrypt } from "@/lib/algo";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";

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

export const handleWeeklyRotaWithStatus = withAudit(
  "WeeklyRota.save",
  async function (data, weekStartDate, weekId, reason) {
    try {
      const { props } = await getServerSideProps();
      const actor = props?.session?.user;
      const approvedBy = actor?._id;
      const approvedStatus = "Approved";
      const validDate = isMonday(weekStartDate);
      if (!validDate) return { success: false, message: "Date is not valid" };

      const trimmedReason = typeof reason === "string" ? reason.trim() : "";

      if (weekId) {
        const existing = await WeeklyRotaModel.findById({ _id: weekId }).lean();
        if (!existing)
          return { success: false, message: "Week ID is not valid" };

        // Editing an already-submitted rota requires a documented reason (UK
        // data-accuracy: every correction to existing data must say why).
        if (!trimmedReason) {
          return {
            success: false,
            message: "A reason is required to change an existing rota",
          };
        }

        // Make sure the history has a baseline. Rotas created before versioning
        // existed have no v1 snapshot, so capture the current (pre-edit) content
        // as v1 before recording the new state — otherwise the prior content is
        // lost the first time someone edits an old rota.
        const existingVersionCount =
          await WeeklyRotaVersionModel.countDocuments({ rotaId: weekId });
        let nextVersion;
        if (existingVersionCount === 0) {
          await WeeklyRotaVersionModel.create({
            rotaId: weekId,
            weekStartDate: existing.weekStartDate,
            version: 1,
            changeType: "created",
            attendanceData: existing.attendanceData,
            approvedStatus: existing.approvedStatus,
            approvedCount: existing.approvedCount,
            changedById: existing.approvedBy,
            reason: "Initial snapshot (captured at first edit after versioning)",
          });
          nextVersion = 2;
        } else {
          nextVersion = existingVersionCount + 1;
        }

        const approvedCount = (existing.approvedCount || 0) + 1;
        await WeeklyRotaModel.findByIdAndUpdate(
          { _id: weekId },
          {
            attendanceData: data,
            weekStartDate,
            approvedStatus,
            approvedBy,
            approvedCount,
            approvedDate: new Date(),
            version: nextVersion,
          }
        );

        const summary = summarizeRotaChange(existing.attendanceData, data);
        await WeeklyRotaVersionModel.create({
          rotaId: weekId,
          weekStartDate: new Date(weekStartDate),
          version: nextVersion,
          changeType: "updated",
          attendanceData: data,
          approvedStatus,
          approvedCount,
          changedById: approvedBy,
          changedByName: actor?.name,
          changedByEmail: actor?.email,
          changedByRole: actor?.role,
          reason: trimmedReason,
          summary,
        });

        recordAudit({
          entityId: weekId,
          before: {
            version: existing.version || 1,
            weekStartDate: existing.weekStartDate,
            employeeCount: existing.attendanceData?.length || 0,
          },
          after: {
            version: nextVersion,
            weekStartDate,
            employeeCount: Array.isArray(data) ? data.length : 0,
            reason: trimmedReason,
          },
          description: `Weekly rota for week of ${weekStartDate} edited → v${nextVersion}. ${summary}. Reason: ${trimmedReason}`,
        });

        return { success: true, message: "Weekly Rota Updated" };
      } else {
        // we have to check if the week already exists
        const weekExist = await WeeklyRotaModel.findOne({ weekStartDate });
        if (weekExist) {
          return { success: false, message: "Week already exists" };
        }
        const response = await WeeklyRotaModel.create({
          attendanceData: data,
          weekStartDate,
          approvedStatus,
          approvedBy,
          approvedDate: new Date(),
          version: 1,
        });

        await WeeklyRotaVersionModel.create({
          rotaId: response._id,
          weekStartDate: new Date(weekStartDate),
          version: 1,
          changeType: "created",
          attendanceData: data,
          approvedStatus,
          approvedCount: 0,
          changedById: approvedBy,
          changedByName: actor?.name,
          changedByEmail: actor?.email,
          changedByRole: actor?.role,
          reason: trimmedReason || undefined,
          summary: `Rota created with ${
            Array.isArray(data) ? data.length : 0
          } employees`,
        });

        recordAudit({
          entityId: response._id,
          after: {
            version: 1,
            weekStartDate,
            employeeCount: Array.isArray(data) ? data.length : 0,
          },
          description: `Weekly rota for week of ${weekStartDate} created (v1) with ${
            Array.isArray(data) ? data.length : 0
          } employees`,
        });

        return { success: true, message: "Weekly Rota Stored" };
      }
    } catch (error) {
      console.log(error);
      return { success: false, message: "Something Went Wrong" };
    }
  },
  { module: "WeeklyRota" }
);

// Lightweight per-employee comparison so the version/audit trail can state how
// many employees' schedules actually changed in an edit.
function summarizeRotaChange(before, after) {
  try {
    const beforeArr = Array.isArray(before) ? before : [];
    const afterArr = Array.isArray(after) ? after : [];
    const keyOf = (e) => String(e?.employeeId || e?.employeeName || "");
    const beforeMap = new Map(
      beforeArr.map((e) => [keyOf(e), JSON.stringify(e?.schedule ?? null)])
    );
    let changed = 0;
    for (const e of afterArr) {
      const prev = beforeMap.get(keyOf(e));
      if (prev === undefined || prev !== JSON.stringify(e?.schedule ?? null)) {
        changed += 1;
      }
    }
    return `${changed} of ${afterArr.length} employees changed`;
  } catch {
    return "schedule updated";
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

// for autofill the we need last week rota so they don't need to fill again and again
export async function getLastWeekRotaForEmployee(params) {
  try {
    if (!params || !params.employeeId) {
      return { success: false, message: "Employee ID is required" };
    }
    const { employeeId } = params;
    let employee;
    // Connect to MongoDB
    await connect();
    // Fetch the last weekly rota for the employee
    const pipeline = [
      {
        $match: {
          "attendanceData.employeeId": createObjectId(employeeId),
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
                $eq: ["$$attendance.employeeId", createObjectId(employeeId)],
              },
            },
          },
        },
      },
      {
        $sort: { weekStartDate: -1 }, // Sort by weekStartDate in descending order
      },
      {
        $limit: 1, // Limit to the most recent document
      },
    ];
    const lastWeekRota = await WeeklyRotaModel.aggregate(pipeline).then(
      (result) => result[0] // Get the first matching document
    );
    if (!lastWeekRota) {
      return { success: false, message: "No weekly rota found" };
    }
    return {
      success: true,
      data: JSON.stringify(lastWeekRota),
    };
  } catch (error) {
    console.error("Error in getLastWeekRotaForEmployee:", error);
    return {
      success: false,
      message: "An error occurred while fetching data.",
    };
  }
}

// Fetch the immutable version history for a single weekly rota. Restricted to
// admin / superAdmin. Follows the standard useFetchQuery contract.
export async function getWeeklyRotaVersions(params) {
  try {
    const { props } = await getServerSideProps();
    const role = props?.session?.user?.role;
    if (role !== "admin" && role !== "superAdmin") {
      return { success: false, message: "Not authorized" };
    }
    const rotaId = params?.rotaId;
    if (!rotaId || !isValidObjectId(rotaId)) {
      return { success: false, message: "Valid rota id is required" };
    }
    const validPage = Number.isInteger(parseInt(params?.page))
      ? parseInt(params.page)
      : 1;
    const validLimit = Number.isInteger(parseInt(params?.pageSize))
      ? parseInt(params.pageSize)
      : 20;
    const skip = Math.max((validPage - 1) * validLimit, 0);

    await connect();
    const query = { rotaId: createObjectId(rotaId) };
    const [totalCount, versions] = await Promise.all([
      WeeklyRotaVersionModel.countDocuments(query),
      WeeklyRotaVersionModel.find(query)
        .sort({ version: -1 })
        .skip(skip)
        .limit(validLimit)
        .lean(),
    ]);

    return {
      success: true,
      data: JSON.stringify(versions),
      totalCount,
    };
  } catch (error) {
    console.error("Error in getWeeklyRotaVersions:", error);
    return {
      success: false,
      message: "An error occurred while fetching data.",
    };
  }
}
