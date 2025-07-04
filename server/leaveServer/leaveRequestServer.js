"use server";
import { connect } from "@/db/db";
import { getLeaveYearString } from "@/lib/getLeaveYear";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { getServerSideProps } from "../session/session";
import CommonLeaveModel from "@/models/commonLeaveModel";
import { addOneCommonLeaveToOneEmployee } from "./countLeaveServer";
import { daysToWeeks, differenceInDays, weeksToDays } from "date-fns";
import { createObjectId, withTransaction } from "@/lib/mongodb";
import {
  adjustLeaveData,
  hasSufficientLeaveBalance,
  splitHalfDayLeaveIntoAnnualOrUnpaid,
  splitHalfDayLeaveWithYearRules,
  splitLeaveWithYearRules,
  validateLeaveData,
  validateOverlap,
} from "./helper/helper";

export async function storeEmployeeLeaveData(data, requestId) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;

    if (requestId) {
      console.log("update leave data");
      const response = await editLeaveRequest(data, requestId, employeeId);
      console.log(response);
      return response;
    } else {
      if (data?.leaveType === "Half Day") {
        const response = await addHalfDayLeave({
          data: { ...data, totalCount: 0.5 },
          employeeId,
        });
        return response;
      } else {
        const response = await addLeaveRequest({ data, employeeId });
        console.log(response);
        return response;
      }
    }
  } catch (error) {
    console.log(" Error fetching employee leave data", error);
    return { success: false, message: "Error fetching employee leave data" };
  }
}

// Add Leave Request
export async function addLeaveRequest({ data, employeeId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();
    const { leaveType, leaveStartDate, leaveEndDate } = data;

    const leaveYear = getLeaveYearString(new Date());
    const countDays = differenceInDays(leaveEndDate, leaveStartDate) + 1;

    const { commonLeave, leaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
      adminId,
    });
    const entries = await splitLeaveWithYearRules(
      countDays,
      leaveData?.type === "weeks"
        ? weeksToDays(leaveData?.remaining)
        : leaveData.remaining,
      leaveStartDate,
      employeeId,
      leaveType,
      adminId ? "Approved" : "Pending",
      adminId
    );

    // Question --> For Peternity & Maternity Leave we have to check the overLap dates or not... eg:Annual Leave
    await validateOverlap(entries);

    const requestsToInsert = [];
    for (const entry of entries) {
      const { leaveYear, leaveType, leaveDays } = entry;
      const existingLeave = await CommonLeaveModel.findOne({
        employeeId: createObjectId(employeeId),
        leaveYear,
        "leaveData.leaveType": leaveType,
      }).session(session);

      if (existingLeave) {
        const idx = existingLeave.leaveData.findIndex(
          (l) => l.leaveType === leaveType
        );
        if (idx !== -1) {
          const unit = leaveData?.type || "days";

          // ✅ Validate balance before deducting
          const balanceCheck = hasSufficientLeaveBalance(
            existingLeave.leaveData[idx].remaining,
            leaveDays,
            leaveData?.type,
            leaveType === "Maternity Leave" || leaveType === "Paternity Leave"
              ? true
              : false
          );
          if (!balanceCheck.success) {
            throw new Error(balanceCheck.message);
          }
          // Apply leave adjustment if valid
          const modifiedFields = adjustLeaveData(
            existingLeave.leaveData[idx],
            leaveDays,
            existingLeave.leaveData[idx].type
          );
          modifiedFields.forEach((field) => existingLeave.markModified(field));
          await existingLeave.save({ session });
        }
      } else {
        await addOneCommonLeaveToOneEmployee({
          leaveType: leaveType,
          leaveYear: leaveYear,
          leaveDays: leaveDays,
          employeeId: createObjectId(employeeId),
        });
      }
      const approved = adminId
        ? { approvedBy: adminId, approvedDate: new Date() }
        : {};
      requestsToInsert.push({
        ...data,
        ...entry,
        ...approved,
        addByAdmin: adminId ? true : false,
      });
    }
    await LeaveRequestModel.insertMany(requestsToInsert, { session });
    return { success: true, message: "Leave added successfully." };
  });
}

//Add Half Day Request
export async function addHalfDayLeave({ data, employeeId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();
    const { leaveType, leaveStartDate } = data;

    const leaveYear = getLeaveYearString(new Date());
    const { commonLeave, leaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
      adminId,
    });
    const annualLeaveRemaining = commonLeave?.leaveData?.find(
      (item) => item?.leaveType === "Annual Leave"
    );
    const { breakdown } = splitHalfDayLeaveIntoAnnualOrUnpaid({
      halfDaysRequested: 1,
      annualLeaveRemaining: annualLeaveRemaining?.remaining,
    });
    const halfDayEntries = splitHalfDayLeaveWithYearRules({
      breakdown,
      startDate: leaveStartDate,
      employeeId,
      adminId,
    });

    // Question --> For Peternity & Maternity Leave we have to check the overLap dates or not... eg:Annual Leave
    await validateOverlap(halfDayEntries);
    const requestsToInsert = [];

    for (const entry of halfDayEntries) {
      // Push item to requestToInsert or split further per day if needed
      // You can mimic how splitLeaveWithYearRules works but using `item.days`
      const { leaveYear, leaveType, leaveDays } = entry;
      const existingLeave = await CommonLeaveModel.findOne({
        employeeId: createObjectId(employeeId),
        leaveYear,
        "leaveData.leaveType": leaveType,
      }).session(session);

      if (existingLeave) {
        const idx = existingLeave.leaveData.findIndex(
          (l) => l.leaveType === leaveType
        );
        if (idx !== -1) {
          const unit = leaveData?.type || "days";

          // Update CommonLeave record:
          const idx = existingLeave.leaveData.findIndex(
            (l) => l.leaveType === "Annual Leave"
          );
          if (idx !== -1) {
            existingLeave.leaveData[idx].used += leaveDays;
            existingLeave.leaveData[idx].remaining -= leaveDays;
            existingLeave.markModified(`leaveData.${idx}`);
            await existingLeave.save({ session });
          }
        }
      }
      const approved = adminId
        ? { approvedBy: adminId, approvedDate: new Date() }
        : {};
      requestsToInsert.push({
        ...data,
        ...entry,
        ...approved,
        addByAdmin: adminId ? true : false,
      });
    }
    await LeaveRequestModel.insertMany(requestsToInsert, { session });
    return { success: true, message: "Leave added successfully." };
  });
}

// Edit Leave Request
export async function editLeaveRequest(data, requestId, employeeId) {
  return await withTransaction(async (session) => {
    await connect();
    const { leaveType, leaveStartDate, leaveEndDate, leaveReason } = data;

    const originalRequest = await LeaveRequestModel.findById(requestId).session(
      session
    );
    if (!originalRequest) throw new Error("Leave request not found");

    if (["Approved", "Rejected"].includes(originalRequest.leaveStatus))
      throw new Error("Cannot edit approved or rejected request");

    const originalLeaveDays = originalRequest.leaveDays;
    const originalLeaveType = originalRequest.leaveType;
    const newLeaveDays = differenceInDays(leaveEndDate, leaveStartDate) + 1;
    const leaveYear = getLeaveYearString(new Date());

    // Step 1: Validate new leave type using utility
    const { commonLeave, leaveData: newLeaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
    });

    // Step 2: Rollback usage from the old leave type (if changed)
    if (originalLeaveType !== leaveType) {
      const oldLeaveData = commonLeave.leaveData.find(
        (l) => l.leaveType === originalLeaveType
      );
      if (oldLeaveData) {
        oldLeaveData.used -= originalLeaveDays;
        oldLeaveData.remaining += originalLeaveDays;
        if (oldLeaveData.used < 0) oldLeaveData.used = 0;
      }
    } else {
      // Just reset old usage if same type
      newLeaveData.used -= originalLeaveDays;
      newLeaveData.remaining += originalLeaveDays;
    }

    // Step 3: Split entries
    const entries = await splitLeaveWithYearRules(
      newLeaveDays,
      newLeaveData.remaining,
      leaveStartDate,
      employeeId,
      leaveType
    );

    // Step 4: Overlap check
    await validateOverlap(entries, requestId);

    // Step 5: Apply new leave usage
    const totalUsed = entries.reduce((sum, e) => sum + e.leaveDays, 0);
    if (newLeaveData.remaining < totalUsed)
      throw new Error(`Insufficient balance in ${leaveType}`);

    newLeaveData.used += totalUsed;
    newLeaveData.remaining -= totalUsed;

    commonLeave.markModified("leaveData");
    await commonLeave.save({ session });

    // Step 6: Update main request
    const main = entries[0];
    originalRequest.leaveStartDate = main.leaveStartDate;
    originalRequest.leaveEndDate = main.leaveEndDate;
    originalRequest.leaveType = leaveType;
    originalRequest.leaveReason = leaveReason;
    originalRequest.leaveDays = totalUsed;
    await originalRequest.save({ session });

    // Step 7: Insert any split entries
    const extraEntries = entries.slice(1).map((e) => ({
      ...e,
      employeeId,
      leaveStatus: "Pending",
      leaveReason,
    }));
    if (extraEntries.length > 0) {
      await LeaveRequestModel.insertMany(extraEntries, { session });
    }

    return { success: true, message: "Leave request updated successfully." };
  });
}
