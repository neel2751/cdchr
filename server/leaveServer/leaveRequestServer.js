"use server";
import { connect } from "@/db/db";
import { getLeaveYearString } from "@/lib/getLeaveYear";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { getServerSideProps } from "../session/session";
import CommonLeaveModel from "@/models/commonLeaveModel";
import { addOneCommonLeaveToOneEmployee } from "./countLeaveServer";
import { differenceInDays, weeksToDays } from "date-fns";
import { createObjectId, withTransaction } from "@/lib/mongodb";
import {
  adjustLeaveData,
  hasSufficientLeaveBalance,
  splitHalfDayLeaveIntoAnnualOrUnpaid,
  splitHalfDayLeaveWithYearRules,
  splitLeaveWithYearRules,
  splitLeaveWithYearRulesByDates,
  updateLeaveBalance,
  validateLeaveData,
  validateOverlap,
} from "./helper/helper";
import { normalizeDateToUTC } from "@/lib/formatDate";

export async function storeEmployeeLeaveData(data, requestId) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;

    if (requestId) {
      console.log("update leave data");
      const response = await editLeaveRequest({
        data,
        requestId,
        employeeId,
      });
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
    // const { leaveType, leaveStartDate, leaveEndDate } = data;
    const { leaveType, leaveDates } = data;

    const leaveYear = getLeaveYearString(new Date());
    // const countDays = differenceInDays(leaveEndDate, leaveStartDate) + 1;

    const { commonLeave, leaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
      adminId,
    });
    const entries = await splitLeaveWithYearRulesByDates(
      leaveDates,
      leaveData?.type === "weeks"
        ? weeksToDays(leaveData?.remaining)
        : leaveData.remaining,
      employeeId,
      leaveType,
      adminId ? "Approved" : "Pending",
      adminId
    );

    // Question --> For Peternity & Maternity Leave we have to check the overLap dates or not... eg:Annual Leave
    await validateOverlap(entries);

    // const requestsToInsert = [];
    // for (const entry of entries) {
    //   const { leaveYear, leaveType, leaveDays } = entry;
    //   const existingLeave = await CommonLeaveModel.findOne({
    //     employeeId: createObjectId(employeeId),
    //     leaveYear,
    //     "leaveData.leaveType": leaveType,
    //   }).session(session);

    //   if (existingLeave) {
    //     const idx = existingLeave.leaveData.findIndex(
    //       (l) => l.leaveType === leaveType
    //     );
    //     if (idx !== -1) {
    //       const unit = leaveData?.type || "days";

    //       // ✅ Validate balance before deducting
    //       const balanceCheck = hasSufficientLeaveBalance(
    //         existingLeave.leaveData[idx].remaining,
    //         leaveDays,
    //         leaveData?.type,
    //         leaveType === "Maternity Leave" || leaveType === "Paternity Leave"
    //           ? true
    //           : false
    //       );
    //       if (!balanceCheck.success) {
    //         throw new Error(balanceCheck.message);
    //       }
    //       // Apply leave adjustment if valid
    //       const modifiedFields = adjustLeaveData(
    //         existingLeave.leaveData[idx],
    //         leaveDays,
    //         existingLeave.leaveData[idx].type
    //       );
    //       modifiedFields.forEach((field) => existingLeave.markModified(field));
    //       await existingLeave.save({ session });
    //     }
    //   } else {
    //     await addOneCommonLeaveToOneEmployee({
    //       leaveType: leaveType,
    //       leaveYear: leaveYear,
    //       leaveDays: leaveDays,
    //       employeeId: createObjectId(employeeId),
    //     });
    //   }
    //   const approved = adminId
    //     ? { approvedBy: adminId, approvedDate: new Date() }
    //     : {};
    //   requestsToInsert.push({
    //     ...data,
    //     leaveSubmitDate: normalizeDateToUTC(new Date()),
    //     ...entry,
    //     ...approved,
    //     addByAdmin: adminId ? true : false,
    //   });
    // }
    // await LeaveRequestModel.insertMany(requestsToInsert, { session });
    // After you build entries[] from splitLeaveWithYearRules (max 2 segments)
    const requestsToInsert = [];
    const leaveBreakdown = []; // store how many days per type

    for (const entry of entries) {
      const {
        leaveYear,
        leaveType,
        leaveDays,
        leaveStartDate,
        leaveEndDate,
        leaveDates,
      } = entry;

      // 🔹 Update balances in CommonLeaveModel
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

          // ✅ Validate balance
          // const balanceCheck = hasSufficientLeaveBalance(
          //   existingLeave.leaveData[idx].remaining,
          //   leaveDays,
          //   leaveData?.type,
          //   ["Maternity Leave", "Paternity Leave"].includes(leaveType)
          // );
          // if (!balanceCheck.success) throw new Error(balanceCheck.message);

          // Apply adjustment
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
          leaveType,
          leaveYear,
          leaveDays,
          employeeId: createObjectId(employeeId),
        });
      }

      // store breakdown
      leaveBreakdown.push({ leaveType, leaveYear, leaveDays });

      const approved = adminId
        ? { approvedBy: adminId, approvedDate: new Date() }
        : {};

      requestsToInsert.push({
        ...data,
        leaveSubmitDate: normalizeDateToUTC(new Date()),
        leaveStartDate,
        leaveEndDate,
        leaveDays,
        leaveDates,
        leaveStatus: adminId ? "Approved" : "Pending",
        employeeId: createObjectId(employeeId),
        leaveYear,
        leaveType, // <- important: each request has its own type
        leaveBreakdown: [
          { leaveType, leaveYear, leaveDays }, // <- each request keeps its own breakdown
        ],
        ...approved,
        addByAdmin: !!adminId,
      });
    }
    await LeaveRequestModel.insertMany(requestsToInsert, { session });

    // 🔹 Now insert ONE request
    return { success: true, message: "Leave added successfully." };
  });
}

//Add Half Day Request
export async function addHalfDayLeave({ data, employeeId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();
    const { leaveType, leaveDates } = data;

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
      dates: leaveDates,
    });
    const halfDayEntries = splitHalfDayLeaveWithYearRules({
      breakdown,
      // startDate: leaveDates[0],
      employeeId,
      adminId,
    });

    // console.log(breakdown, halfDayEntries);

    // Question --> For Peternity & Maternity Leave we have to check the overLap dates or not... eg:Annual Leave
    await validateOverlap(halfDayEntries);
    const requestsToInsert = [];

    for (const entry of halfDayEntries) {
      let { leaveYear, leaveType, leaveDays } = entry;

      // Step 1: Always log Half Day entitlement
      await updateLeaveBalance({
        employeeId,
        leaveYear,
        leaveType: "Half Day",
        leaveDays,
        session,
        allowNegative: true,
      });

      // Step 2: Try Annual Leave first, fallback to Unpaid
      if (leaveType === "Annual Leave") {
        const success = await updateLeaveBalance({
          employeeId,
          leaveYear,
          leaveType: "Annual Leave",
          leaveDays,
          session,
        });

        if (!success) {
          leaveType = "Unpaid Leave";
        }
      }

      // Step 3: Always update unpaid if selected/fallback
      if (leaveType === "Unpaid Leave") {
        await updateLeaveBalance({
          employeeId,
          leaveYear,
          leaveType: "Unpaid Leave",
          leaveDays,
          session,
          allowNegative: true,
        });
      }

      // Step 4: Insert leave request
      const approved = adminId
        ? { approvedBy: adminId, approvedDate: new Date() }
        : {};

      requestsToInsert.push({
        ...entry,
        leaveType,
        leaveDays: 0.5, // always store half-day explicitly
        ...approved,
        addByAdmin: !!adminId,
        employeeId,
        createdAt: new Date(),
      });
    }

    await LeaveRequestModel.insertMany(requestsToInsert, { session });
    return { success: true, message: "Leave added successfully." };
  });
}

// Edit Leave Request
export async function editLeaveRequestOld(data, requestId, employeeId) {
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

// export async function editLeaveRequest({ data, requestId, adminId }) {
//   return await withTransaction(async (session) => {
//     await connect();

//     const { leaveDates, leaveReason, employeeId } = data;
//     if (!leaveDates || leaveDates.length === 0)
//       throw new Error("No leave dates provided");

//     // 1️⃣ Fetch the leave request to edit
//     const originalRequest = await LeaveRequestModel.findById(requestId).session(
//       session
//     );
//     if (!originalRequest) throw new Error("Leave request not found");

//     // Restrict editing if approved/rejected
//     if (
//       !adminId &&
//       ["Approved", "Rejected"].includes(originalRequest.leaveStatus)
//     ) {
//       throw new Error("Cannot edit approved or rejected request");
//     }

//     const leaveType = originalRequest.leaveType; // Leave type is fixed
//     const leaveYear = getLeaveYearString(new Date());

//     // 2️⃣ Rollback only this request's usage
//     await updateLeaveBalance({
//       employeeId,
//       leaveYear,
//       leaveType,
//       leaveDays: -originalRequest.leaveDays,
//       session,
//       allowNegative: true, // rollback always allowed
//     });

//     // 3️⃣ Get current leave data
//     const { commonLeave, leaveData } = await validateLeaveData({
//       employeeId,
//       leaveYear,
//       leaveType,
//       session,
//       adminId,
//     });

//     // 4️⃣ Split new dates into entries (Annual + fallback Unpaid, half-days)
//     const entries = await splitLeaveWithYearRulesByDates(
//       leaveDates,
//       leaveData?.type === "weeks"
//         ? weeksToDays(leaveData?.remaining)
//         : leaveData.remaining,
//       employeeId,
//       leaveType,
//       adminId ? "Approved" : "Pending"
//     );

//     console.log(entries);

//     // 5️⃣ Validate overlaps only against other requests
//     await validateOverlap(entries, requestId);

//     // 6️⃣ Apply allocation to CommonLeave only for this request
//     for (const entry of entries) {
//       await updateLeaveBalance({
//         employeeId,
//         leaveYear: entry.leaveYear,
//         leaveType: entry.leaveType,
//         leaveDays: entry.leaveDays,
//         session,
//         allowNegative: entry.leaveType !== "Annual Leave",
//       });
//     }

//     // 7️⃣ Update the main leave request
//     const mainEntry = entries[0];
//     originalRequest.leaveStartDate = mainEntry.leaveStartDate;
//     originalRequest.leaveEndDate = mainEntry.leaveEndDate;
//     originalRequest.leaveReason = leaveReason;
//     originalRequest.leaveDates = leaveDates;
//     originalRequest.leaveDays = entries.reduce(
//       (sum, e) => sum + e.leaveDays,
//       0
//     );
//     originalRequest.leaveBreakdown = entries.map((e) => ({
//       leaveType: e.leaveType,
//       leaveYear: e.leaveYear,
//       leaveDays: e.leaveDays,
//     }));
//     originalRequest.leaveStatus = adminId ? "Approved" : "Pending";
//     originalRequest.adminId = adminId || null;

//     await originalRequest.save({ session });

//     // 8️⃣ Insert additional segments if the split created more than one
//     const additionalEntries = entries.slice(1).map((entry) => ({
//       ...entry,
//       employeeId: createObjectId(employeeId),
//       leaveStatus: adminId ? "Approved" : "Pending",
//       leaveReason,
//       addByAdmin: !!adminId,
//       createdAt: new Date(),
//     }));

//     if (additionalEntries.length > 0) {
//       await LeaveRequestModel.insertMany(additionalEntries, { session });
//     }

//     return { success: true, message: "Leave request updated successfully." };
//   });
// }

// ---------------------- Half-Day Edit ----------------------
export async function editHalfDayLeave({ data, requestId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();
    const { leaveDates, leaveReason } = data;

    if (!leaveDates || leaveDates.length === 0) {
      throw new Error("No leave dates provided");
    }

    const originalRequest = await LeaveRequestModel.findById(requestId).session(
      session
    );
    if (!originalRequest) throw new Error("Leave request not found");

    const employeeId = originalRequest.employeeId;

    // Restrict editing if approved or rejected (for employees)
    if (
      !adminId &&
      ["Approved", "Rejected"].includes(originalRequest.leaveStatus)
    ) {
      throw new Error("Cannot edit approved or rejected request");
    }

    const leaveYear = getLeaveYearString(new Date());

    // Sets for easier comparison
    const existingDatesSet = new Set(
      originalRequest.leaveDates.map((d) => new Date(d).toISOString())
    );
    const newDatesSet = new Set(
      leaveDates.map((d) => new Date(d).toISOString())
    );

    // 1️⃣ Find unchanged dates (no action needed)
    const unchangedDates = leaveDates.filter((d) =>
      existingDatesSet.has(new Date(d).toISOString())
    );

    // 2️⃣ Find newly added dates → add new requests & deduct balance
    const datesToAdd = leaveDates.filter(
      (d) => !existingDatesSet.has(new Date(d).toISOString())
    );

    // 3️⃣ Find removed dates → delete requests & rollback balance
    const datesToRemove = originalRequest.leaveDates.filter(
      (d) => !newDatesSet.has(new Date(d).toISOString())
    );

    // 🔄 Handle newly added dates
    for (const date of datesToAdd) {
      await validateOverlap(
        [
          {
            employeeId,
            leaveDates: [date], // must be array
            leaveYear,
          },
        ],
        requestId // exclude the current one so self-overlap isn’t triggered
      );
      const entry = {
        employeeId,
        leaveDate: date,
        leaveDates: [date],
        leaveStartDate: date,
        leaveEndDate: date,
        leaveDays: 0.5,
        leaveYear,
        leaveReason,
        leaveStatus: adminId ? "Approved" : "Pending",
        addByAdmin: !!adminId,
        createdAt: new Date(),
        isHalfDay: true,
        parentRequestId: requestId,
      };

      // Always deduct Half Day entitlement
      await updateLeaveBalance({
        employeeId,
        leaveYear,
        leaveType: "Half Day",
        leaveDays: 0.5,
        session,
        allowNegative: true,
      });

      // Deduct from Annual Leave if possible, fallback to Unpaid
      let finalLeaveType = originalRequest.leaveType;
      if (finalLeaveType === "Annual Leave") {
        const success = await updateLeaveBalance({
          employeeId,
          leaveYear,
          leaveType: "Annual Leave",
          leaveDays: 0.5,
          session,
        });

        if (!success) {
          finalLeaveType = "Unpaid Leave";
          await updateLeaveBalance({
            employeeId,
            leaveYear,
            leaveType: "Unpaid Leave",
            leaveDays: 0.5,
            session,
            allowNegative: true,
          });
        }
      } else if (finalLeaveType === "Unpaid Leave") {
        await updateLeaveBalance({
          employeeId,
          leaveYear,
          leaveType: "Unpaid Leave",
          leaveDays: 0.5,
          session,
          allowNegative: true,
        });
      }

      entry.leaveType = finalLeaveType;
      await LeaveRequestModel.create([entry], { session });
    }

    // 🔄 Handle removed dates
    if (datesToRemove.length > 0) {
      await LeaveRequestModel.deleteMany({
        employeeId,
        leaveDate: { $in: datesToRemove },
        isHalfDay: true,
        parentRequestId: requestId,
      }).session(session);

      // rollback balances
      for (const d of datesToRemove) {
        const removed = await LeaveRequestModel.findOne({
          employeeId,
          leaveDate: d,
          isHalfDay: true,
          parentRequestId: requestId,
        }).session(session);

        if (removed) {
          await updateLeaveBalance({
            employeeId,
            leaveYear,
            leaveType: removed.leaveType,
            leaveDays: -0.5,
            session,
            allowNegative: true,
          });
          await updateLeaveBalance({
            employeeId,
            leaveYear,
            leaveType: "Half Day",
            leaveDays: -0.5,
            session,
            allowNegative: true,
          });
        }
      }
    }

    // 🔄 Update main request (just keep reason + status fresh)
    // Step 5️⃣ Update main request with first date (if exists)
    const mainEntryDate = leaveDates[0]; // pick the first selected date
    originalRequest.leaveDate = mainEntryDate;
    originalRequest.leaveReason = leaveReason;
    originalRequest.leaveType = originalRequest.leaveType; // keep same
    originalRequest.leaveDays = 0.5;
    originalRequest.leaveYear = leaveYear;
    originalRequest.leaveStatus = adminId ? "Approved" : "Pending";
    originalRequest.adminId = adminId || null;

    // ✅ Fix: for half-day, start and end date are the SAME
    originalRequest.leaveStartDate = mainEntryDate;
    originalRequest.leaveEndDate = mainEntryDate;

    await originalRequest.save({ session });

    return { success: true, message: "Half-day leave updated successfully." };
  });
}

// ---------------------- Main Edit ----------------------
export async function editLeaveRequest({ data, requestId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();

    const originalRequest = await LeaveRequestModel.findById(requestId).session(
      session
    );
    if (!originalRequest) throw new Error("Leave request not found");

    const employeeId = originalRequest?.employeeId;

    // 1️⃣ If this is a half-day request, call half-day edit
    if (originalRequest.isHalfDay) {
      return await editHalfDayLeave({
        data,
        requestId,
        employeeId,
        adminId,
        session,
      });
    }

    // ---------------- Full-Day Leave Logic ----------------
    const { leaveDates, leaveReason } = data;
    if (!leaveDates || leaveDates.length === 0)
      throw new Error("No leave dates provided");

    if (
      !adminId &&
      ["Approved", "Rejected"].includes(originalRequest.leaveStatus)
    )
      throw new Error("Cannot edit approved or rejected request");

    const leaveType = originalRequest.leaveType; // Fixed for full-day
    const leaveYear = getLeaveYearString(new Date());

    // 2️⃣ Rollback only this request's allocation
    for (const segment of originalRequest.leaveBreakdown || []) {
      await updateLeaveBalance({
        employeeId,
        leaveYear: segment.leaveYear,
        leaveType: segment.leaveType,
        leaveDays: -segment.leaveDays,
        session,
        allowNegative: true,
      });
    }

    // 3️⃣ Get current leave data
    const { commonLeave, leaveData } = await validateLeaveData({
      employeeId,
      leaveYear,
      leaveType,
      session,
      adminId,
    });

    // 4️⃣ Split new leave into segments (Annual + fallback Unpaid)
    const entries = await splitLeaveWithYearRulesByDates(
      leaveDates,
      leaveData?.type === "weeks"
        ? weeksToDays(leaveData?.remaining)
        : leaveData.remaining,
      employeeId,
      leaveType,
      adminId ? "Approved" : "Pending",
      adminId
    );

    // 5️⃣ Validate overlaps
    await validateOverlap(entries, requestId);

    // 6️⃣ Apply new allocation
    for (const entry of entries) {
      await updateLeaveBalance({
        employeeId,
        leaveYear: entry.leaveYear,
        leaveType: entry.leaveType,
        leaveDays: entry.leaveDays,
        session,
        allowNegative: entry.leaveType !== "Annual Leave",
      });
    }

    // 7️⃣ Update main request
    const mainEntry = entries[0];
    originalRequest.leaveStartDate = mainEntry.leaveStartDate;
    originalRequest.leaveEndDate = mainEntry.leaveEndDate;
    originalRequest.leaveReason = leaveReason;
    originalRequest.leaveDates = leaveDates;
    originalRequest.leaveDays = entries.reduce(
      (sum, e) => sum + e.leaveDays,
      0
    );
    originalRequest.leaveBreakdown = entries.map((e) => ({
      leaveType: e.leaveType,
      leaveYear: e.leaveYear,
      leaveDays: e.leaveDays,
    }));
    originalRequest.leaveStatus = adminId ? "Approved" : "Pending";
    originalRequest.adminId = adminId || null;

    await originalRequest.save({ session });

    // 8️⃣ Insert additional segments if more than one
    const additionalEntries = entries.slice(1).map((entry) => ({
      ...entry,
      employeeId: createObjectId(employeeId),
      leaveStatus: adminId ? "Approved" : "Pending",
      leaveReason,
      addByAdmin: !!adminId,
      createdAt: new Date(),
    }));

    if (additionalEntries.length > 0) {
      await LeaveRequestModel.insertMany(additionalEntries, { session });
    }

    return { success: true, message: "Leave request updated successfully." };
  });
}
