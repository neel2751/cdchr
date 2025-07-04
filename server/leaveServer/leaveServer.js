"use server";

import { connect } from "@/db/db";
import CommonLeaveModel from "@/models/commonLeaveModel";
import LeaveCategoryModel from "@/models/leaveCategoryModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInDays,
  differenceInWeeks,
  format,
  getYear,
  isPast,
} from "date-fns";
import mongoose from "mongoose";
import { getServerSideProps } from "../session/session";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { fetchLeaveCategory } from "../category/category";

export async function storeLeave(employeeId, data) {
  try {
    await connect();
    //check the employeeId is valid or not
    const monggoseId = mongoose.Types.ObjectId.isValid(employeeId)
      ? new mongoose.Types.ObjectId(employeeId)
      : null;
    if (!monggoseId) return { success: false, message: "Invalid employeeId" };
    // first we have to count a leave data
    const leaveData = await countLeave(monggoseId, data);
    if (!leaveData?.success)
      return { success: false, message: "Failed to count leave data" };
    const storeData = await CommonLeaveModel(leaveData?.data);
    const result = await storeData.save();
    return {
      success: true,
      message: "Leave data stored successfully",
      data: JSON.stringify(result),
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Failed to store leave data" };
  }
}

// give an option to update the leave data particaluallry

// if employee doesn't have any leave so give permission to generate leave depend on the current data
export async function fetchCommonLeave(filterData) {
  const MongooseId = mongoose.Types.ObjectId;
  const sanitizedSearch = filterData?.query?.trim() || ""; // Ensure search is a string
  // const searchRegex = new RegExp(sanitizedSearch, "i"); // Create a case-ins ensitive regex
  const validPage = parseInt(filterData?.page < 0 ? 1 : filterData?.page || 1);
  const validLimit = parseInt(filterData?.pageSize || 10);
  const roleTypeFilter = filterData?.filter?.role;
  const companyFilter = filterData?.filter?.company;
  const filterType = filterData?.filter?.type;
  const skip = (validPage - 1) * validLimit;
  const query = { delete: false };

  const roleTypeFilterQuery = roleTypeFilter
    ? { "departments._id": new MongooseId(roleTypeFilter) } // Field for department filter
    : {};

  const companyFilterQuery = companyFilter
    ? { "companys._id": new MongooseId(companyFilter) } // Field for company filter
    : {};

  if (filterType) {
    query.immigrationType = filterType;
  }
  if (sanitizedSearch) {
    query.$or = [
      { name: { $regex: sanitizedSearch, $options: "i" } },
      { email: { $regex: sanitizedSearch, $options: "i" } },
      // { phoneNumber: { $regex: sanitizedSearch, $options: "i" } },
    ];
  }

  // check if any employee overlap the dates if it is how many dates they are overlapping

  try {
    await connect();
    const pipeline = [
      {
        $match: query,
      },
      {
        $lookup: {
          from: "commonleaves",
          localField: "_id",
          foreignField: "employeeId",
          as: "commonLeave",
        },
      },
      {
        $lookup: {
          from: "roletypes",
          localField: "department",
          foreignField: "_id",
          as: "roleType",
        },
      },
      {
        $match: {
          ...roleTypeFilterQuery,
          ...companyFilterQuery,
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $addFields: {
          roleType: { $arrayElemAt: ["$roleType.roleTitle", 0] },
          hasCommonLeave: { $gt: [{ $size: "$commonLeave" }, 0] },
          leaveData: { $arrayElemAt: ["$commonLeave.leaveData", 0] },
          leaveYear: { $arrayElemAt: ["$commonLeave.leaveYear", 0] },
          leaveHistory: { $arrayElemAt: ["$commonLeave.leaveHistory", 0] },
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          joinDate: 1,
          employeType: 1,
          dayPerWeek: 1,
          hasCommonLeave: 1,
          leaveData: 1,
          roleType: 1,
          leaveYear: 1,
          leaveHistory: 1,
          password: 1, // Exclude sensitive field unless absolutely required
        },
      },
      {
        $facet: {
          totalCount: [{ $count: "count" }],
          result: [
            { $skip: skip > 0 ? skip : 0 },
            { $limit: validLimit > 0 ? validLimit : 10 },
          ],
        },
      },
      {
        $project: {
          totalCount: 1,
          result: 1, // Flatten the "result" array
        },
      },
    ];

    const employeeWithLeave = await OfficeEmployeeModel.aggregate(pipeline);
    const totalCount = employeeWithLeave[0].totalCount[0].count;
    const result = employeeWithLeave[0].result;
    return { success: true, data: JSON.stringify(result), totalCount };
  } catch (error) {
    console.log(" Error in fetchCommonLeave", error);
    return { success: false, message: "Failed to fetch common leave data" };
  }
}

export async function countLeave(employeeId, data) {
  try {
    const allCategory = await fetchLeaveCategory();
    if (!allCategory.success) return allCategory;
    const leaveCategories = JSON.parse(allCategory?.data);

    const STATUTORY_ANNUAL_LEAVE_DAYS = 28;
    const STATUTORY_SICK_WEEKS = 28; // Maximum SSP weeks
    const MATERNITY_WEEKS = 52;
    const MATERNITY_PAID_WEEKS = 39;
    const PATERNITY_WEEKS = 2;

    const startDateObj = new Date(data?.joinDate);
    const weeksWorked = differenceInWeeks(new Date(), startDateObj);
    const fullYearRatio = Math.min(weeksWorked / 52, 1);
    let sspEligibleWeeks = STATUTORY_SICK_WEEKS;
    //count 4 week after date of the startDateObj
    const fourWeeksAfter = addWeeks(new Date(startDateObj), 4);
    // count 26 week after date of the startDateObj
    const twentySixWeeksAfter = addWeeks(new Date(startDateObj), 26);

    // Calculate SSP eligibility and weeks
    const isEligibleForSSP = weeksWorked >= 4; // Need 4 weeks of employment
    if (!isEligibleForSSP) {
      sspEligibleWeeks = 0;
    }

    // Calculate maternity leave eligibility and weeks(26 weeks continous employment)
    const isEligibleForParental = weeksWorked >= 26;
    const sickLeave = {
      leaveType: "Sick Leave",
      total: 7,
      used: 0,
      remaining: STATUTORY_SICK_WEEKS,
      accrued: Math.round(STATUTORY_SICK_WEEKS * fullYearRatio),
      isEligible: isEligibleForSSP,
      eligibleDate: fourWeeksAfter,
      paid: sspEligibleWeeks,
      requireFitNote: true,
      type: "weeks",
    };
    const maternityLeave = {
      leaveType: "Maternity Leave",
      total: MATERNITY_WEEKS,
      used: 0,
      remaining: MATERNITY_WEEKS,
      accrued: Math.round(MATERNITY_WEEKS * fullYearRatio),
      isEligible: isEligibleForParental,
      eligibleDate: twentySixWeeksAfter,
      paid: MATERNITY_PAID_WEEKS,
      compulsory: 2,
      type: "weeks",
    };
    const paternityLeave = {
      // leaveType: 'Statutory Sick Pay',
      leaveType: "Paternity Leave",
      total: PATERNITY_WEEKS,
      used: 0,
      remaining: PATERNITY_WEEKS,
      accrued: Math.round(PATERNITY_WEEKS * fullYearRatio),
      isEligible: isEligibleForParental,
      paid: PATERNITY_WEEKS,
      type: "weeks",
    };
    // first count Full-Time
    const employmentType = data?.employeType;
    if (employmentType === "Full-Time") {
      console.log("-----Full Time------");
      const result = {
        employeeId: employeeId,
        leaveYear: getYear(new Date()),
        leaveData: [
          {
            leaveType: "Annual Leave",
            total: STATUTORY_ANNUAL_LEAVE_DAYS,
            used: 0,
            remaining: STATUTORY_ANNUAL_LEAVE_DAYS,
            accrued: Math.round(STATUTORY_ANNUAL_LEAVE_DAYS * fullYearRatio),
            type: "days",
            isEligible: true,
          },
          sickLeave,
          maternityLeave,
          paternityLeave,
        ],
      };
      const allLeaveType = result?.leaveData?.map(({ leaveType }) => leaveType);
      const leaveFilter = leaveCategories.filter(
        (leave) => !allLeaveType.includes(leave.leaveType)
      );
      const newData = leaveFilter.map((item) => {
        const isEligible =
          item?.ruleType === "days"
            ? addDays(new Date(startDateObj), item?.rule)
            : addMonths(new Date(startDateObj), item?.rule);
        return {
          leaveType: item?.leaveType,
          total: item?.total,
          used: 0,
          remaining: item?.total,
          rule: item?.rule,
          ruleType: item?.ruleType,
          eligibleDate: isEligible,
        };
      });
      const newLeavData = {
        ...result,
        leaveData: [...result.leaveData, ...newData],
      };
      return { success: true, data: newLeavData };
    } else {
      console.log("-----Part Time------");
      const result = {
        employeeId: employeeId,
        leaveYear: getYear(new Date()),
        leaveData: [
          {
            leaveType: "Annual Leave",
            total:
              Number(data?.partTimeDays) < 6
                ? Math.round(Number(data?.partTimeDays) * 5.6)
                : 28,
            used: 0,
            remaining:
              Number(data?.partTimeDays) < 6
                ? Math.round(Number(data?.partTimeDays) * 5.6)
                : 28,
            accrued: Math.round(STATUTORY_ANNUAL_LEAVE_DAYS * fullYearRatio),
            type: "days",
            isEligible: true,
          },
          sickLeave,
          maternityLeave,
          paternityLeave,
        ],
      };
      return result;
    }
  } catch (error) {
    console.error(error);
    return { success: false, message: "Error processing data" };
  }
}

export async function getEmployeeLeaveData() {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const leaveYear = getYear(new Date());
    const data = getLeaveData(employeeId, leaveYear);
    return data;
  } catch (error) {
    console.log(" Error fetching employee leave data:", error);
    return { success: false, message: "Error fetching employee leave data" }; // Return a default value
  }
}

export async function getLeaveData(employeeId, leaveYear, server) {
  try {
    const data = await CommonLeaveModel.findOne({ employeeId, leaveYear });
    if (data)
      return { success: true, data: server ? data : JSON.stringify(data) };
  } catch (e) {
    console.log(" Error fetching leave data", e);
    return { success: false, message: "Error fetching leave data" };
  }
}

export async function syncMissingLeaveTypes(employeeId, data) {
  try {
    const currentYear = new Date().getFullYear();
    const server = true;
    // check in the common leave data
    const leaveData = await getLeaveData(employeeId, currentYear, server);
    if (leaveData?.success) {
      await checkWithStoreLeaveType(leaveData, employeeId);
    } else {
      const storeLeaveData = await storeLeave(employeeId, data);
      if (!storeLeaveData?.success) return storeLeaveData;
      const checkData = { data: JSON.parse(storeLeaveData?.data) };
      await checkWithStoreLeaveType(checkData, employeeId);
      return { success: true, message: "Leave data synced successfully" };
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error syncing leave data" };
  }
}

async function checkWithStoreLeaveType(leaveData, employeeId) {
  try {
    const leaveYear = getYear(new Date());
    const allLeave = await LeaveCategoryModel.find();
    const existingLeave = leaveData?.data?.leaveData.map(
      (leave) => leave.leaveType
    );
    const missingLeaveTypes = allLeave.filter(
      (globalLeave) => !existingLeave?.includes(globalLeave.leaveType)
    );
    if (missingLeaveTypes.length > 0) {
      await CommonLeaveModel.updateOne(
        { employeeId, leaveYear },
        {
          $push: { leaveData: { $each: missingLeaveTypes } },
        }
      );
      return { success: true, message: "Missing leave types synced" };
    } else {
      return { success: true, message: "No missing leave types found" };
    }
  } catch (error) {
    console.log(error);
  }
}

export async function storeEmployeeLeave(data, id) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const leaveYear = getYear(new Date());
    await connect();
    const isEligible = await checkEligibility(employeeId, data, id);
    if (!isEligible?.success) return isEligible;
    if (id) {
      console.log("update leave data");
      const existingLeave = await editLeaveRequest(data, id);
      return existingLeave;
    } else {
      console.log("create new leave request");
      const leaveType = data?.leaveType;
      const remaining = isEligible?.data?.remaining
        ? -isEligible?.countDays
        : isEligible?.data?.total - isEligible?.countDays;
      const updateData = await CommonLeaveModel.updateOne(
        { employeeId, leaveYear, "leaveData.leaveType": leaveType },
        {
          $inc: {
            "leaveData.$.used": isEligible?.countDays,
            "leaveData.$.remaining": remaining,
          },
        }
      );
      if (!updateData?.matchedCount)
        return { success: false, message: "Error updating leave data" };
      const leaveRequestData = {
        ...data,
        employeeId,
        leaveYear,
        leaveDays: isEligible?.countDays,
        leaveSubmitDate: new Date(),
        submitBy: employeeId,
      };
      const requestLeaveResult = await LeaveRequestModel.create(
        leaveRequestData
      );
      if (!requestLeaveResult)
        return { success: false, message: "Error creating leave request" };
      return { success: true, message: "Leave request created successfully" }; // TODO: return leave request id
    }
  } catch (error) {
    console.log(" Error fetching employee leave data", error);
    return { success: false, message: "Error fetching employee leave data" };
  }
}

export async function isDateOverLapping(employeeId, data, id) {
  try {
    await connect();
    const requestId = id && { _id: { $ne: new mongoose.Types.ObjectId(id) } };
    const ObjectIdEmployee = new mongoose.Types.ObjectId(employeeId);
    // check only with status pending
    const overLappingRequests = await LeaveRequestModel.find({
      ObjectIdEmployee,
      requestId,
      $or: [{ leaveStatus: "Pending" }, { leaveStatus: "Approved" }],
      $or: [
        {
          leaveStartDate: { $lte: data.leaveEndDate },
          leaveEndDate: { $gte: data.leaveStartDate },
        },
      ],
    });
    return overLappingRequests.length > 0;
  } catch (error) {
    console.log("Error fetching overlapping leave requests", error);
    return true;
  }
}

async function checkEligibility(employeeId, data, id) {
  try {
    const isOverLapping = await isDateOverLapping(employeeId, data, id);
    if (isOverLapping)
      return { success: false, message: "Leave dates are overlapping" }; // Return error message

    const leaveData = await getLeaveData(employeeId, getYear(new Date()), true);
    if (!leaveData?.success)
      return { success: false, message: "Error fetching leave data" };

    // Fetch existing leave data
    const existingLeave = leaveData?.data?.leaveData.find(
      (leave) => leave.leaveType === data?.leaveType
    );
    if (!existingLeave)
      return { success: false, message: "Leave type not found Contact Admin" };

    // Calculate days of leave in the update request
    const updatedLeaveDays = differenceInDays(
      data?.leaveEndDate,
      data?.leaveStartDate
    );

    // const originalLeave = leaveData?.data?.leaveData.find(
    //   (leave) => leave._id === id
    // );
    // const originalLeaveDays = originalLeave
    //   ? differenceInDays(
    //       originalLeave.leaveEndDate,
    //       originalLeave.leaveStartDate
    //     )
    //   : 0;

    // Check the current stored leave (if any) begin updated

    const countDays = differenceInDays(
      data?.leaveEndDate,
      data?.leaveStartDate
    );
    if (countDays > existingLeave?.total)
      return {
        success: false,
        message: `${existingLeave?.leaveType} days exceeded`,
      };
    if (countDays > existingLeave?.remaining)
      return {
        success: false,
        message: `under ${existingLeave?.leaveType} ${existingLeave?.remaining} days remaining`,
      };
    if (existingLeave?.eligibleDate && !isPast(existingLeave?.eligibleDate)) {
      return {
        success: false,
        message: `Not eligible until ${format(
          existingLeave?.eligibleDate,
          "PPP"
        )} for ${existingLeave?.leaveType}`,
      };
    }
    return {
      success: true,
      message: "Eligible for leave",
      data: existingLeave,
      countDays,
    };
  } catch (error) {
    console.log("Error checking eligibility", error);
    return { success: false, message: "Error checking eligibility" };
  }
}

async function editLeaveRequest(data, requestId) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await connect();
    const { leaveType, leaveStartDate, leaveEndDate, leaveReason } = data;

    // Step 1: Fetch the leave request being edited
    const leaveRequest = await LeaveRequestModel.findById(requestId).session(
      session
    );
    if (!leaveRequest)
      return { success: false, message: "Leave request not found" };

    // Step 2: Check if editing is allowed
    if (
      leaveRequest?.leaveStatus === "Approved" ||
      leaveRequest?.leaveStatus === "Rejected"
    )
      return {
        success: false,
        message: "Cannot edit approved or rejected leave request",
      };

    // Step 3: Fetch total allowed, used, and remaining balance
    const commonLeave = await CommonLeaveModel.findOne({
      employeeId: leaveRequest?.employeeId,
      leaveYear: leaveRequest?.leaveYear,
    }).session(session);

    if (!commonLeave)
      return { success: false, message: "Leave balance not found" };

    const leaveData = commonLeave.leaveData.find(
      (leave) => leave.leaveType === leaveRequest.leaveType
    );
    if (!leaveData) return { success: false, message: "Leave data not found" };

    const { total, used, remaining } = leaveData;

    // Calculate the total approved days for this leave request type
    const approvedLeaveRequests = await LeaveRequestModel.find({
      employeeId: leaveRequest?.employeeId,
      leaveYear: leaveRequest?.leaveYear,
      leaveType: leaveType,
      leaveStatus: "Approved",
    }).session(session);

    const approvedDays = approvedLeaveRequests.reduce(
      (sum, req) => sum + req.leaveDays,
      0
    );

    // Count the days through the leave request
    const leaveDays = differenceInDays(
      new Date(leaveEndDate),
      new Date(leaveStartDate)
    );

    // Step 4: Validate against the updated request
    const originalLeaveDays = leaveRequest?.leaveDays;
    const leaveDaysDifference = leaveDays - originalLeaveDays;

    // New remaining balance if this edit is approved
    const newRemainingBalance = total - approvedDays - leaveDaysDifference;

    if (leaveDaysDifference > 0 && newRemainingBalance < 0)
      return {
        success: false,
        message: `Insufficient leave balance. You only have ${remaining} days left for ${leaveType}.`,
      };

    // Step 5: Update the common leave record
    const updatedCommonLeave = {
      ...leaveData,
      total: total,
      used:
        used +
        approvedDays +
        (leaveRequest?.leaveStatus === "Approved" ? 0 : leaveDaysDifference),
      remaining: remaining - leaveDaysDifference,
    };
    commonLeave.leaveData = commonLeave.leaveData.map((leave) =>
      leave.leaveType === leaveRequest.leaveType ? updatedCommonLeave : leave
    );
    await commonLeave.save({ session });

    // Step 6: Update the leave request with the new deatils
    leaveRequest.leaveType = leaveType;
    leaveRequest.leaveStartDate = leaveStartDate;
    leaveRequest.leaveEndDate = leaveEndDate;
    leaveRequest.leaveDays = leaveDays;
    leaveRequest.leaveReason = leaveReason;
    leaveRequest.leaveDays = leaveDays;

    await leaveRequest.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    return { success: true, message: "Leave request updated successfully" };
  } catch (error) {
    await session.abortTransaction();
    console.log(" Error editing leave request:", error);
    return { success: false, message: "Error editing leave request" };
  } finally {
    session.endSession();
  }
}
