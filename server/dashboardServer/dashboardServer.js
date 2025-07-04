"use server";
import { connect } from "@/db/db";
import AttendanceModel from "@/models/attendanceModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import ProjectSiteModel from "@/models/siteProjectModel";

/*
@description: This function is used to get all function for promises
@params: none
@returns: 4 promises Data
* 1. get all employee summary Data like total, active, inactive, VisaExp. Employee Function Name : getEmployeeSummary
* 2. get all offices employee summary Data  like total, active, inactive, VisaExp. Employee  Function Name : getOfficeEmployeeSummary
* 3. get last 90 days attendance data like date, totalpay, totalhours for Chart  Function Name : getLast90DaysDataForChart
* 4. get Today total Pay  and total hours for only for report...  Function Name : getTodayTotalPayAndHours
*/
export async function fetchCardDataold() {
  try {
    const emploeyeeData = await getEmpSummaryData();
    const officeEmployeeData = await getOfficeEmpSummaryData();
    const totalFullSiteData = await getTotalSiteWorkingRightCount();
    const last90DaysDataForChart = await getLast90DaysDataForChart();
    const currentDateTotalPay = await getTodayTotalPayAndHours();

    const data = await Promise.all([
      emploeyeeData,
      officeEmployeeData,
      totalFullSiteData,
      last90DaysDataForChart,
      currentDateTotalPay,
    ]); // wait for both promises to resolve

    const NumberOfEmployeeData = data[0];
    const NumberOfficeEmployeeData = data[1];
    const NumbertotalFullSiteData = data[2]; // 2th element of the array
    const last90DaysDataForChartData = data[3]; // 3nd element of the array
    const CurrentDayTotalPay = data[4];

    return {
      NumberOfEmployeeData,
      NumberOfficeEmployeeData,
      NumbertotalFullSiteData,
      last90DaysDataForChartData,
      CurrentDayTotalPay,
    };
  } catch (error) {
    console.error(error);
    return { status: false, message: "Server Error" };
  }
}

export async function fetchCardData() {
  try {
    const [
      NumberOfEmployeeData,
      NumberOfficeEmployeeData,
      NumbertotalFullSiteData,
      last90DaysDataForChartData,
      CurrentDayTotalPay,
    ] = await Promise.all([
      getEmpSummaryData(),
      getOfficeEmpSummaryData(),
      getTotalSiteWorkingRightCount(),
      getLast90DaysDataForChart(),
      getTodayTotalPayAndHours(),
    ]);

    return {
      NumberOfEmployeeData,
      NumberOfficeEmployeeData,
      NumbertotalFullSiteData,
      last90DaysDataForChartData,
      CurrentDayTotalPay,
    };
  } catch (error) {
    console.error(error);
    return { status: false, message: "Server Error" };
  }
}

// Get All the Employee data form Once like active, inactive, total, enddate
export const getEmpSummaryData = async () => {
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
export const getOfficeEmpSummaryData = async () => {
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

// Get Last 3 Month Data for Chart
export async function getLast90DaysDataForChart() {
  const startDate = new Date();
  const endDate = new Date();
  let daysToSubtract = 90;
  startDate.setDate(endDate.getDate() - daysToSubtract);
  const pipeline = [
    { $unwind: "$employeAttendance" },
    {
      $project: {
        day: { $dayOfMonth: "$employeAttendance.aDate" },
        month: { $month: "$employeAttendance.aDate" },
        year: { $year: "$employeAttendance.aDate" },
        totalHours: "$employeAttendance.totalHours",
        totalPay: "$employeAttendance.totalPay",
        aDate: "$employeAttendance.aDate", // Include aDate for filtering
      },
    },
    {
      $match: {
        aDate: {
          $gte: startDate,
          $lte: endDate,
        },
      },
    },
    {
      $group: {
        _id: { day: "$day", month: "$month", year: "$year" },
        totalHours: { $sum: "$totalHours" },
        // totalPay: { $sum: "$totalPay" }, // Include totalPay for filtering
        totalPay: { $sum: { $round: ["$totalPay", 2] } },
      },
    },
  ];
  try {
    const result = await AttendanceModel.aggregate(pipeline);
    // make a date  string for the result
    const formattedResult = result.map((item) => {
      return {
        TotalHours: item.totalHours, // Remove the _id field
        TotalPay: item.totalPay, // Remove the _id field
        date: `${item._id.year}-${item._id.month}-${item._id.day}`,
      };
    }); // format the date
    //send a date like Asc order
    return formattedResult.sort((a, b) => {
      return new Date(a.date) - new Date(b.date);
    }); // sort the result by date in descending order
  } catch (error) {
    return { status: false, message: "Error in fetching data" };
  }
}

// Get  total hours and pay for a specific date Now for Only today and top 7 total high pay employee
export async function getTodayTotalPayAndHours() {
  await connect();
  // const now = new Date("2024-08-15" + "T" + "00:00:00.000Z");
  const today = new Date().toISOString().split("T")[0];
  const now = new Date(today + "T" + "00:00:00.000Z"); // get today date
  const pipeline = [
    { $match: { attendanceDate: now } },
    { $unwind: "$employeAttendance" },
    // { $match: { "employeAttendance.aDate": { $eq: now } } }, // Filter by today's date
    {
      $group: {
        _id: "$employeAttendance.employeeId", // Group by employeeId
        totalHours: { $sum: "$employeAttendance.totalHours" },
        totalPay: { $sum: "$employeAttendance.totalPay" },
      },
    },
    {
      $lookup: {
        from: "employes", // Replace with your employee collection name
        localField: "_id",
        foreignField: "_id",
        as: "employeeData",
      },
    },
    {
      $unwind: "$employeeData", // Unwind the employee data array
    },
    {
      $project: {
        employeeId: "$_id",
        firstName: "$employeeData.firstName",
        lastName: "$employeeData.lastName",
        payRate: "$employeeData.payRate",
        paymentType: "$employeeData.paymentType",
        totalHours: 1,
        totalPay: 1,
      },
    },
    {
      $sort: { totalPay: -1 },
    },
    {
      $group: {
        _id: null,
        employees: { $push: "$$ROOT" }, // Group by null to get all employees
        totalHours: { $sum: "$totalHours" },
        totalPay: { $sum: { $round: ["$totalPay", 2] } },
      },
    }, // Group by total hours and total pay
    // we need only three employee under the employess  array , add totalPays  and totalHours
    {
      $project: {
        _id: 0,
        employees: { $slice: ["$employees", 3] },
        // employees: 1,
        totalHours: 1,
        totalPay: { $round: ["$totalPay", 2] }, // Round total pay to 2 decimal places
      },
    }, // Project the desired fields
  ];

  try {
    let totalPay = 0;
    const result = await AttendanceModel.aggregate(pipeline); // Aggregate the data
    totalPay = result[0]?.totalPay || 0;
    return {
      totalPay,
      totalHours: result[0]?.totalHours || 0,
      employees: JSON.stringify(result[0]?.employees || []),
    }; // Return the total pay and hours
    // console.log("Total pay for all employees today:", totalPay);
  } catch (error) {
    console.error("Error getting current date total pay: ", error);
    return { status: false, message: "Error calculating total pay" };
  }
}

// Get Total Site Working Right count total Site, active, complete, on hold, no status
export async function getTotalSiteWorkingRightCount() {
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
