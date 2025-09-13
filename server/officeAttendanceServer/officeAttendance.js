"use server";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import WeeklyRotaModel from "@/models/weeklyRotaModel";
import { getServerSideProps } from "../session/session";
import { addDays } from "date-fns";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { getSelectOfficeEmployee } from "../selectServer/selectServer";
import { createObjectId } from "@/lib/mongodb";
import { getUKTime } from "@/utils/time";

export async function getAllOfficeEmployee() {
  try {
    const allEmployees = await OfficeEmployeeModel.find({
      isActive: true,
      delete: false,
      $or: [
        { visaEndDate: { $lte: new Date() } },
        { endDate: { $lte: new Date() } },
      ],
    });
    return { success: true, data: allEmployees };
  } catch (error) {
    console.log("Get all office employee function", error);
    return { success: false };
  }
}

export async function getOfficeEmployeeAttendance(weekStartDate) {
  const { date } = weekStartDate;
  // await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    await connect();
    const { props } = await getServerSideProps();
    const loginId = props?.session?.user?._id;

    const allEmployees = await OfficeEmployeeModel.find({
      delete: false,
      isActive: true,
      $or: [
        { visaEndDate: { $lte: new Date() } },
        { endDate: { $lte: new Date() } },
      ],
    }).lean();

    const attendanceRecord = await WeeklyRotaModel.findOne({
      weekStartDate: date,
    });

    const attendanceData = attendanceRecord?.attendanceData || [];
    const attendanceMap = new Map(
      attendanceData.map((item) => [item?.employeeId?.toString(), item])
    );

    let allData = [];
    if (attendanceRecord) {
      allData = allEmployees
        .filter((employee) => attendanceMap.has(employee?._id.toString()))
        .map((employee) => {
          const existingAttendance = attendanceMap.get(
            employee?._id.toString()
          );
          return {
            employeeId: employee._id,
            employeeName: employee.name,
            schedule: existingAttendance?.schedule || {},
            weekStartDate: date,
          };
        });
    } else {
      allData = allEmployees.map((employee) => {
        return {
          employeeId: employee._id,
          employeeName: `${employee.name}`,
          schedule: attendanceMap.get(employee._id.toString())?.schedule || {},
          weekStartDate: date,
          // status: attendanceMap.get?.status || "Draft",
        };
      });
    }

    const approvedById = await OfficeEmployeeModel.findOne(
      { _id: createObjectId(attendanceRecord?.approvedBy) },
      { name: 1 }
    );
    const approvedBy =
      approvedById?._id?.toString() === loginId ? "You" : approvedById?.name;

    const withIdData = {
      attendanceData: allData,
      weekId: attendanceRecord?._id || null,
      approvedStatus: attendanceRecord?.approvedStatus || null,
      approvedDate: attendanceRecord?.approvedDate || null,
      approvedBy: approvedBy || null,
      rejectReason: attendanceRecord?.rejectedReason || null,
    };
    return { data: JSON.stringify(withIdData), totalCount: allData.length };
  } catch (error) {
    console.error("Error  fetching office employee attendance", error);
    return [];
  }
}

// export async function getOfficeEmployeeAttendanceWithLeave(weekStartDate) {
//   const { date } = weekStartDate;

//   try {
//     await connect();
//     const { props } = await getServerSideProps();
//     const loginId = props?.session?.user?._id;
//     const weekDates = Array.from({ length: 7 }, (_, i) => addDays(date, i));
//     const existingRota = await WeeklyRotaModel.findOne({
//       weekStartDate: date,
//     }).lean();
//     const now = getUKTime({ format: "iso" });

//     const allEmployees = await OfficeEmployeeModel.find({
//       isActive: true,
//       delete: false,
//       $or: [
//         { visaEndDate: { $gt: now } },
//         { visaEndDate: { $exists: false } },
//         { visaEndDate: null },
//         { endDate: { $gte: now } },
//         { endDate: { $exists: false } },
//         { endDate: null },
//       ],
//     });

//     const leaveRequests = await LeaveRequestModel.find({
//       leaveStatus: "Approved",
//       leaveStartDate: { $lte: weekDates[6] },
//       leaveEndDate: { $gte: weekDates[0] },
//     });

//     // 2️⃣ Fetch pending leave requests
// const pendingLeaveRequests = await LeaveRequestModel.find({
//   leaveStatus: "Pending",
//   leaveStartDate: { $lte: weekDates[6] },
//   leaveEndDate: { $gte: weekDates[0] },
// });

//     // // 🗺️ Map leaves by employeeId
//     // const leaveMap = new Map();
//     // leaveRequests.forEach((leave) => {
//     //   const days = [];
//     //   weekDates.forEach((date) => {
//     //     if (leave.leaveStartDate <= date && leave.leaveEndDate >= date) {
//     //       days.push(date.toISOString().split("T")[0]);
//     //     }
//     //   });

//     //   if (!leaveMap.has(leave.employeeId.toString())) {
//     //     leaveMap.set(leave.employeeId.toString(), new Set());
//     //   }
//     //   days.forEach((d) => leaveMap.get(leave.employeeId.toString()).add(d));
//     // });

//     // 🗺️ Map leaves by employeeId
//     const leaveMap = new Map();
//     leaveRequests.forEach((leave) => {
//       if (!leave.leaveDates || leave.leaveDates.length === 0) return;

//       if (!leaveMap.has(leave.employeeId.toString())) {
//         leaveMap.set(leave.employeeId.toString(), new Set());
//       }

//       leave.leaveDates.forEach((d) => {
//         const leaveDay = new Date(d).toISOString().split("T")[0];
//         // Only add if within the week
//         if (
//           leaveDay >= weekDates[0].toISOString().split("T")[0] &&
//           leaveDay <= weekDates[6].toISOString().split("T")[0]
//         ) {
//           leaveMap.get(leave.employeeId.toString()).add(leaveDay);
//         }
//       });
//     });
//     console.log("Leave Map:", leaveMap);

//     const existingAttendanceMap = new Map();
//     existingRota?.attendanceData?.forEach((att) =>
//       existingAttendanceMap.set(att.employeeId.toString(), att)
//     );

//     const attendanceData = allEmployees.map((employee) => {
//       const idStr = employee._id.toString();

//       if (existingAttendanceMap.has(idStr)) {
//         return existingAttendanceMap.get(idStr);
//       }

//       const leaveDays = leaveMap.get(idStr) || new Set();

//       const schedule = weekDates.map((date) => {
//         const formattedDate = date.toISOString().split("T")[0];
//         const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
//         // If it's Sunday
//         if (dayName === "Sunday") {
//           return {
//             date: formattedDate,
//             day: dayName,
//             category: "OFF",
//             startTime: "00:00",
//             endTime: "00:00",
//           };
//         }
//         if (leaveDays.has(formattedDate)) {
//           return {
//             date: formattedDate,
//             day: date.toLocaleDateString("en-US", { weekday: "long" }),
//             category: "Holiday",
//           };
//         }
//         return {
//           date: formattedDate,
//           day: date.toLocaleDateString("en-US", { weekday: "long" }),
//           // category: "OFFICE",
//           // startTime: "09:00",
//           // endTime: "17:00",
//         };
//       });

//       return {
//         employeeId: employee._id,
//         employeeName: employee.name,
//         schedule,
//       };
//     });

//     const approvedById = existingRota?.approvedBy
//       ? await OfficeEmployeeModel.findById(existingRota?.approvedBy, {
//           name: 1,
//         })
//       : null;

//     const withIdData = {
//       attendanceData,
//       weekId: existingRota?._id || null,
//       approvedStatus: existingRota?.approvedStatus || null,
//       approvedDate: existingRota?.approvedDate || null,
//       approvedBy:
//         approvedById?._id?.toString() === props?.session?.user?._id
//           ? "You"
//           : approvedById?.name || null,
//       rejectReason: existingRota?.rejectedReason || null,
//     };

//     return {
//       data: JSON.stringify(withIdData),
//       totalCount: attendanceData.length,
//     };
//   } catch (error) {
//     console.error("Error fetching attendance:", error);
//     return [];
//   }
// }

export async function getOfficeEmployeeAttendanceWithLeave(weekStartDate) {
  const { date } = weekStartDate;

  try {
    await connect();
    const { props } = await getServerSideProps();
    const loginId = props?.session?.user?._id;

    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(date, i));
    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];
    const now = getUKTime({ format: "iso" });

    // 🔹 Fetch existing rota
    const existingRota = await WeeklyRotaModel.findOne({
      weekStartDate: date,
    }).lean();

    // 🔹 Fetch all active employees
    const allEmployees = await OfficeEmployeeModel.find({
      isActive: true,
      delete: false,
      $or: [
        { visaEndDate: { $gt: now } },
        { visaEndDate: { $exists: false } },
        { visaEndDate: null },
        { endDate: { $gte: now } },
        { endDate: { $exists: false } },
        { endDate: null },
      ],
    });

    // 🔹 Fetch Approved + Pending leave requests in this week
    const leaveRequests = await LeaveRequestModel.find({
      leaveStatus: { $in: ["Approved", "Pending"] },
      leaveStartDate: { $lte: weekEnd },
      leaveEndDate: { $gte: weekStart },
    }).lean();

    // 🗺️ Map leaves by employeeId
    const leaveMap = new Map();
    leaveRequests.forEach((leave) => {
      if (!leave.leaveDates || leave.leaveDates.length === 0) return;

      if (!leaveMap.has(leave.employeeId.toString())) {
        leaveMap.set(leave.employeeId.toString(), []);
      }

      leave.leaveDates.forEach((d) => {
        const leaveDay = new Date(d).toISOString().split("T")[0];
        if (
          leaveDay >= weekStart.toISOString().split("T")[0] &&
          leaveDay <= weekEnd.toISOString().split("T")[0]
        ) {
          leaveMap.get(leave.employeeId.toString()).push({
            date: leaveDay,
            status: leave.leaveStatus, // only used for frontend warning
          });
        }
      });
    });

    // 🗺️ Existing rota data
    const existingAttendanceMap = new Map();
    existingRota?.attendanceData?.forEach((att) =>
      existingAttendanceMap.set(att.employeeId.toString(), att)
    );

    // 🔹 Build attendance data
    const attendanceData = allEmployees.map((employee) => {
      const idStr = employee._id.toString();

      if (existingAttendanceMap.has(idStr)) {
        return existingAttendanceMap.get(idStr);
      }

      const leaveDays = leaveMap.get(idStr) || [];
      const pendingLeaveDates = leaveDays
        .filter((l) => l.status === "Pending")
        .map((l) => l.date); // frontend can use this to show warning badge
      const approvedLeaveDates = leaveDays
        .filter((l) => l.status === "Approved")
        .map((l) => l.date);

      const schedule = weekDates.map((date) => {
        const formattedDate = date.toISOString().split("T")[0];
        const dayName = date.toLocaleDateString("en-US", { weekday: "long" });

        if (dayName === "Sunday") {
          return {
            date: formattedDate,
            day: dayName,
            category: "OFF",
            startTime: "00:00",
            endTime: "00:00",
          };
        }

        // Keep normal categories as-is, do NOT mark pending here
        return {
          date: formattedDate,
          day: dayName,
          // if on approved leave, mark as Holiday
          category: approvedLeaveDates.includes(formattedDate)
            ? "Holiday"
            : "OFFICE",
          startTime: "09:00",
          endTime: "17:00",
        };
      });

      return {
        employeeId: employee._id,
        employeeName: employee.name,
        schedule,
        pendingLeaveDates, // frontend can show a small warning badge
        approvedLeaveDates, // to quickly check if a date is on approved leave
      };
    });

    // 🔹 ApprovedBy info
    const approvedById = existingRota?.approvedBy
      ? await OfficeEmployeeModel.findById(existingRota?.approvedBy, {
          name: 1,
        })
      : null;

    const withIdData = {
      attendanceData,
      weekId: existingRota?._id || null,
      approvedStatus: existingRota?.approvedStatus || null,
      approvedDate: existingRota?.approvedDate || null,
      approvedBy:
        approvedById?._id?.toString() === loginId
          ? "You"
          : approvedById?.name || null,
      rejectReason: existingRota?.rejectedReason || null,
    };

    return {
      data: JSON.stringify(withIdData),
      totalCount: attendanceData.length,
    };
  } catch (error) {
    console.error("Error fetching attendance:", error);
    return [];
  }
}
