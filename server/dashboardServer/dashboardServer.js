"use server";
import { connect } from "@/db/db";
import { permissionRefusal } from "@/lib/actionAccess";
import { getClockTime, getWorkingDate, toMinutes } from "@/lib/clockTime";
import { workedMinutes } from "@/server/clockServer/shiftCloser";
import ClockRecordModel from "@/models/clockInModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import ProjectSiteModel from "@/models/siteProjectModel";

const DAY_MS = 86400000;

/**
 * Everything the dashboard's headcount cards and hours chart show.
 *
 * Checked here because a server action is a POST endpoint anyone signed in can
 * call, whatever proxy.js lets them open. Unchecked, an ordinary employee
 * could read the company's headcounts and hours. The rule is the one the
 * dashboard's other card applies (getAttendancePulse): the dashboard is every
 * admin's landing page, so any admin or super admin, and nobody else.
 *
 * Only this function is exported. Each export of a "use server" file is an
 * endpoint of its own, so the queries below stay private to it — exported,
 * each would be a way round this check.
 *
 * Today's pay is no longer fetched. Nothing on the dashboard shows it, but it
 * was in the response all the same, with the names of the three best-paid
 * people, for anyone who opened the network tab.
 */
export async function fetchCardData() {
  const refusal = await permissionRefusal([], { roles: ["admin"] });
  if (refusal) return refusal;

  try {
    const [
      NumberOfEmployeeData,
      NumberOfficeEmployeeData,
      NumbertotalFullSiteData,
      hoursLastFortnight,
    ] = await Promise.all([
      getEmpSummaryData(),
      getOfficeEmpSummaryData(),
      getTotalSiteWorkingRightCount(),
      getHoursLastFortnight(),
    ]);

    return {
      NumberOfEmployeeData,
      NumberOfficeEmployeeData,
      NumbertotalFullSiteData,
      hoursLastFortnight,
    };
  } catch (error) {
    console.error(error);
    return { status: false, message: "Server Error" };
  }
}

// Get All the Employee data form Once like active, inactive, total, enddate
const getEmpSummaryData = async () => {
  try {
    await connect();
    const threeFromNow = new Date();
    threeFromNow.setMonth(threeFromNow.getMonth() + 3);
    const result = await EmployeModel.aggregate([
      {
        $group: {
          _id: null, // Group by null to get a single result for all employees
          totalEmployees: { $sum: 1 }, // Count total number of employees
          activeEmployees: {
            $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
          }, // Count active employees
          inactiveEmployees: {
            $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] },
          }, // Count inactive employees
          expiredEmployees: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$immigrationType", "British"] }, // Exclude owners
                    { $lte: ["$eVisaExp", new Date()] }, // Check if visaEndDate is expired
                  ],
                },
                1,
                0,
              ],
            },
          }, // Count only immigrants with expired visas
          // expiredEmployees: {
          //   $sum: { $cond: [{ $lte: ["$eVisaExp", new Date()] }, 1, 0] },
          // }, // Count expired employees (eVisaExp <= current date)
          reminderEmployees: {
            $push: { name: "$firstName", eVisaExp: "$eVisaExp" }, // List of employees for reminder purposes
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalEmployeeData: [
            {
              label: "Total Employee",
              value: "$totalEmployees",
              icon: "Users",
            },
            {
              label: "Active Employee",
              value: "$activeEmployees",
              icon: "BadgeCheck",
            },
            {
              label: "Inactive Employee",
              value: "$inactiveEmployees",
              icon: "BadgeX",
            },
            {
              label: "Visa Expired Employee",
              value: "$expiredEmployees",
              icon: "Ban",
            },
          ],
          reminderEmployeeData: "$reminderEmployees",
        },
      },
    ]).exec();
    if (result[0]) {
      // After Test remove explation mark
      return {
        status: true,
        data: JSON.stringify(result[0].totalEmployeeData),
      };
    } else {
      const data = {
        totalEmployeeData: [
          {
            label: "Total Employee",
            value: 0,
          },
          {
            label: "Active Employee",
            value: 0,
          },
          {
            label: "Inactive Employee",
            value: 0,
          },
          {
            label: "Visa Expired Employee",
            value: 0,
          },
        ],
        reminderEmployeeData: [], // send reminder data
      };
      return {
        status: false,
        message: "No Data Found!",
        data: JSON.stringify(data?.totalEmployeeData),
      };
    }
  } catch (error) {
    console.log("Error at getting employee summary data : ", error);
    return { status: false, message: "Internal Server Error" };
  }
};

// Get All the Office Employee data form Once like active, inactive, total, enddate
const getOfficeEmpSummaryData = async () => {
  try {
    await connect();
    const threeFromNow = new Date();
    threeFromNow.setMonth(threeFromNow.getMonth() + 3);
    const result = await OfficeEmployeeModel.aggregate([
      // if delete true don't  count
      { $match: { delete: false } }, // filter out deleted employees
      // { $match: { end_date: { $lte: threeFromNow } } }, // filter by end_date
      {
        $group: {
          _id: null, // Group by employeeId
          totalEmployees: { $sum: 1 }, // Count total number of employees
          activeEmployees: {
            $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] },
          }, // Count active employees
          inactiveEmployees: {
            $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] },
          }, // Count inactive employees
          expiredEmployees: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$immigrationType", "British"] }, // Exclude owners
                    { $lte: ["$visaEndDate", new Date()] }, // Check if visaEndDate is expired
                  ],
                },
                1,
                0,
              ],
            },
          }, // Count only immigrants with expired visas
          // expiredEmployees: {
          //   $sum: { $cond: [{ $lte: ["$visaEndDate", new Date()] }, 1, 0] },
          // }, // Count expired employees (endDate <= current date)
          reminderEmployees: {
            $push: { name: "$firstName", eVisaExp: "$endDate" }, // Push name and eVisaExp fields to an array
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalEmployeeData: [
            {
              label: "Total Employee",
              value: "$totalEmployees",
              icon: "Users",
            },
            {
              label: "Active Employee",
              value: "$activeEmployees",
              icon: "BadgeCheck",
            },
            {
              label: "Inactive Employee",
              value: "$inactiveEmployees",
              icon: "BadgeX",
            },
            {
              label: "Visa Expired Employee",
              value: "$expiredEmployees",
              icon: "Ban",
            },
          ],
          reminderEmployeeData: "$reminderEmployees",
        },
      },
    ]).exec();
    if (result[0]) {
      // After Test remove explation mark
      // send data into array);
      return {
        status: true,
        data: JSON.stringify(result[0].totalEmployeeData),
      };
    } else {
      const data = {
        totalEmployeeData: [
          {
            label: "Total Employee",
            value: 0,
          },
          {
            label: "Active Employee",
            value: 0,
          },
          {
            label: "Inactive Employee",
            value: 0,
          },
          {
            label: "Visa Expired Employee",
            value: 0,
          },
        ],
        reminderEmployees: [], // send reminder data
      };
      return {
        status: false,
        message: "No Data Found!",
        data: JSON.stringify(data.totalEmployeeData),
      };
    }
  } catch (error) {
    console.log("Error at getting employee summary data : ", error);
    return { status: false, message: "Internal Server Error" };
  }
};

/**
 * Hours worked on each of the last fourteen days, for the dashboard chart.
 *
 * Read from clock records. It used to sum `totalHours` out of the site
 * attendance collection, which nothing has written to since clocking in
 * replaced manual site attendance — so the chart said "0 hours over the last
 * fortnight" however many shifts had actually been worked.
 *
 * Hours are worked minutes — the shift less its breaks — the same figure
 * overtime is judged on, so the two cannot disagree.
 *
 * Today's open shifts count up to now, so today's bar climbs through the day
 * instead of sitting empty until people go home. An open shift from an earlier
 * day does not: nobody clocked out of it, the nightly job has flagged it, and
 * until a human fixes the finish time any length given to it is a guess.
 *
 * All fourteen days come back, keyed "YYYY-MM-DD" on the UK working day, so a
 * day nobody worked is a gap in the row and the browser never has to work out
 * dates in its own timezone. Today's carries `isToday` and how many shifts in
 * it are still running, so the chart can say the figure is not final.
 */
async function getHoursLastFortnight() {
  try {
    await connect();
    const today = getWorkingDate();
    const todayKey = today.toISOString().slice(0, 10);
    const now = getClockTime();
    const start = new Date(today.getTime() - 13 * DAY_MS);

    const records = await ClockRecordModel.find(
      { date: { $gte: start, $lte: today }, isDeleted: false },
      { date: 1, clockIn: 1, clockOut: 1, breaks: 1 },
    ).lean();

    const minutesByDay = new Map();
    let openShifts = 0;
    for (const record of records) {
      const key = record.date.toISOString().slice(0, 10);
      let minutes = workedMinutes(record);
      if (minutes === null && key === todayKey) {
        minutes = minutesSoFar(record, now);
        if (minutes !== null) openShifts++;
      }
      if (minutes === null) continue;
      minutesByDay.set(key, (minutesByDay.get(key) || 0) + minutes);
    }

    return Array.from({ length: 14 }, (_, i) => {
      const key = new Date(start.getTime() + i * DAY_MS)
        .toISOString()
        .slice(0, 10);
      return {
        date: key,
        TotalHours: Math.round(((minutesByDay.get(key) || 0) / 60) * 100) / 100,
        ...(key === todayKey && { isToday: true, openShifts }),
      };
    });
  } catch (error) {
    console.error("Error getting hours for the dashboard chart: ", error);
    return [];
  }
}

/**
 * Minutes worked so far on a shift nobody has clocked out of yet.
 *
 * The shift is closed at `now` for the sum, and so is a break still running:
 * somebody at lunch is not working, and counting their break would make the
 * bar climb while nobody is.
 *
 * Null when the clock-in is later than now. That is a mis-keyed record or a
 * wrong clock somewhere, and diffMinutes would read it as a shift crossing
 * midnight — twenty-three hours on the chart from one typo.
 */
function minutesSoFar(record, now) {
  const start = toMinutes(record?.clockIn);
  if (start === null || start > toMinutes(now)) return null;

  const breaks = (record.breaks || []).map((br) =>
    br?.breakIn && !br?.breakOut ? { ...br, breakOut: now } : br,
  );
  return workedMinutes({ ...record, clockOut: now, breaks });
}

// Get Total Site Working Right count total Site, active, complete, on hold, no status
async function getTotalSiteWorkingRightCount() {
  try {
    const pipeline = [
      {
        $facet: {
          total: [{ $count: "total" }], // Count total number of sites
          siteTypes: [
            {
              $group: {
                _id: "$siteType",
                count: { $sum: 1 },
              },
            },
          ],
          statuses: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                label: "$_id",
                value: "$count",
              },
            },
          ],
        },
      },
    ];
    const result = await ProjectSiteModel.aggregate(pipeline);
    return {
      total: result[0]?.total[0]?.total || 0, // Total number of sites
      siteTypes: result[0]?.siteTypes || [], // Site types with count
      data:
        result[0].statuses.length > 0
          ? JSON.stringify(result[0]?.statuses)
          : JSON.stringify([
              { label: "Active", value: 0 },
              { label: "On Hold", value: 0 },
              { label: "Completed", value: 0 },
              { label: "No status", value: 0 },
            ]), // Statuses with count
    };
  } catch (error) {
    return {
      status: false,
      message: "Error getting total site working right count",
    }; // Return error message
  }
}
