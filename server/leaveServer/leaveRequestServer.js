"use server";
import { connect } from "@/db/db";
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
  splitLeaveDatesByYear,
  splitLeaveWithYearRules,
  splitLeaveWithYearRulesByDates,
  updateLeaveBalance,
  validateLeaveData,
  validateOverlap,
  validateOverlappingHalfDayLeave,
  validateOverlappingLeave,
} from "./helper/helper";
import { normalizeDateToUTC } from "@/lib/formatDate";
import { getLeaveYearString } from "@/helper/getLeaveYearString";
import { getLeaveSettings } from "../leaveSettingServer";
import { create } from "lodash";

export async function storeEmployeeLeaveData(data, requestId) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;

    if (requestId) {
      // console.log("update leave data");
      // const response = await editLeaveRequest({
      //   data,
      //   requestId,
      //   employeeId,
      // });
      // return response;

      const response = await editLeaveRequestAdvanced({
        requestIds: [requestId],
        employeeId: data.employeeId || employeeId,
        newLeaveDates: data.leaveDates,
        leaveType:
          data.leaveType === "Half Day" ? "Annual Leave" : data.leaveType,
        isHalfDay: data.leaveType === "Half Day",
        halfDayType: data.halfDayType || null,
        leaveReason: data.leaveReason || "",
        submitBy: employeeId,
      });
      return response;
    } else {
      if (data?.leaveType === "Half Day") {
        const validatedOverlap = await validateOverlappingHalfDayLeave(
          employeeId,
          leaveDates,
          halfDayType,
          session
        );

        if (!validatedOverlap.success) {
          return validatedOverlap;
        }
        const response = await addHalfDayLeave({
          data: { ...data, totalCount: 0.5 },
          employeeId,
        });
        return response;
      } else {
        const overlapCheck = await validateOverlappingLeave(
          employeeId,
          data.leaveDates
        );

        if (!overlapCheck.success) {
          return overlapCheck;
        }
        const response = await addLeaveRequest({ data, employeeId });
        return response;
      }
    }
  } catch (error) {
    console.log(" Error fetching employee leave data", error);
    return { success: false, message: "Error fetching employee leave data" };
  }
}

// Add Leave Request
export async function addLeaveRequestOld({ data, employeeId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();
    // const { leaveType, leaveStartDate, leaveEndDate } = data;
    const { leaveType, leaveDates } = data;

    const leaveYear = getLeaveYearString(new Date());
    // const countDays = differenceInDays(leaveEndDate, leaveStartDate) + 1;

    const { leaveData } = await validateLeaveData({
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

      // Ensure Correct Order of Leave Dates
      const sortedDates = [...leaveDates].sort(
        (a, b) => new Date(a) - new Date(b)
      );
      entry.leaveDates = sortedDates;
      entry.leaveStartDate = sortedDates[0];
      entry.leaveEndDate = sortedDates[sortedDates.length - 1];

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
export async function addLeaveRequestNew({ data, employeeId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();
    // const { leaveType, leaveStartDate, leaveEndDate } = data;
    const { leaveType, leaveDates } = data;

    const settings = await getLeaveSettings();
    const startMonth = settings?.leaveYearStartMonth || 4;

    const groupedByYear = splitLeaveDatesByYear(leaveDates, startMonth);

    const finalDeductions = [];

    // 3. VALIDATE EACH YEAR FIRST (NO DEDUCTION YET)
    for (const [leaveYear, dates] of Object.entries(groupedByYear)) {
      let remainingDaysToDeduct = dates.length;

      const commonLeave = await CommonLeaveModel.findOne({
        employeeId,
        leaveYear,
      });

      if (!commonLeave) {
        return {
          success: false,
          message: `Leave year ${leaveYear} is not generated yet. Contact HR.`,
        };
      }

      const leaveDataList = commonLeave.leaveData;

      // Find Annual
      const annual = leaveDataList.find((l) => l.leaveType === leaveType);
      // const unpaid = leaveDataList.find((l) => l.leaveType === "Unpaid Leave");

      if (!annual) {
        return {
          success: false,
          message: `${leaveType} not configured for ${leaveYear}`,
        };
      }

      // 🟡 First deduct from Annual
      if (annual.remaining > 0) {
        const useAnnual = Math.min(annual.remaining, remainingDaysToDeduct);

        finalDeductions.push({
          commonLeaveId: commonLeave._id,
          leaveYear,
          leaveType: leaveType,
          days: useAnnual,
          dates: dates.slice(0, useAnnual),
        });

        remainingDaysToDeduct -= useAnnual;
      }

      // 🔴 Remaining → go to Unpaid
      if (remainingDaysToDeduct > 0) {
        // if (!unpaid || unpaid.remaining < remainingDaysToDeduct) {
        //   return {
        //     success: false,
        //     message: `Not enough leave balance in ${leaveYear}. Need ${remainingDaysToDeduct} more days.`,
        //   };
        // }

        finalDeductions.push({
          commonLeaveId: commonLeave._id,
          leaveYear,
          leaveType: "Unpaid Leave",
          days: remainingDaysToDeduct,
          dates: dates.slice(-remainingDaysToDeduct),
        });

        remainingDaysToDeduct = 0;
      }
    }

    // 5️⃣ APPLY ALL DEDUCTIONS (TRANSACTION STYLE)
    for (const item of finalDeductions) {
      await CommonLeaveModel.updateOne(
        {
          _id: item.commonLeaveId,
          "leaveData.leaveType": item.leaveType,
        },
        {
          $inc: {
            "leaveData.$.used": item.days,
            "leaveData.$.remaining": -item.days,
          },
          $push: {
            leaveHistory: {
              leaveType: item.leaveType,
              leaveYear: item.leaveYear,
              leaveDays: item.days,
              leaveDates: item.dates,
              createdAt: new Date(),
              createdBy: session?.user?._id,
            },
          },
        }
      );
    }

    // Build entries for insertion
    const requestsToInsert = [];
    const leaveBreakdown = []; // store how many days per type
    for (const item of finalDeductions) {
      const { leaveYear, leaveType, days: leaveDays, dates: leaveDates } = item;
      // Ensure Correct Order of Leave Dates
      const sortedDates = [...leaveDates].sort(
        (a, b) => new Date(a) - new Date(b)
      );
      const leaveStartDate = sortedDates[0];
      const leaveEndDate = sortedDates[sortedDates.length - 1];
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
        isPaid: leaveType !== "Unpaid Leave",
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
export async function addHalfDayLeaveNew({ data, employeeId, adminId }) {
  return await withTransaction(async (session) => {
    await connect();
    const { leaveType, leaveDates, halfDayType } = data;

    const validatedOverlap = await validateOverlappingHalfDayLeave(
      employeeId,
      leaveDates,
      halfDayType
    );
    if (!validatedOverlap.success) {
      throw new Error(validatedOverlap.message);
    }

    const settings = await getLeaveSettings();

    // 2️⃣ Split dates by leave year
    const splitByYear = splitLeaveDatesByYear(
      leaveDates,
      settings?.data?.leaveYearStartMonth
    );

    const leaveRequestsToInsert = [];

    // 3️⃣ Process YEAR → DATE → ONE RECORD EACH
    for (const leaveYear of Object.keys(splitByYear)) {
      const yearDates = splitByYear[leaveYear];

      const commonLeave = await CommonLeaveModel.findOne({
        employeeId,
        leaveYear,
      });

      if (!commonLeave) {
        return {
          success: false,
          message: `Leave entitlement not generated for ${leaveYear}`,
        };
      }

      const annual = commonLeave.leaveData.find(
        (l) => l.leaveType === "Annual Leave"
      );
      const unpaid = commonLeave.leaveData.find(
        (l) => l.leaveType === "Unpaid Leave"
      );

      if (!annual || !unpaid) {
        return { success: false, message: "Leave categories not configured" };
      }

      // 4️⃣ LOOP EACH DATE SEPARATELY (🔥 THIS IS THE FIX 🔥)
      for (const date of yearDates) {
        let deducted = false;

        // ---- Try Annual Leave first
        if (annual.remaining >= 0.5) {
          annual.remaining -= 0.5;
          annual.used += 0.5;

          leaveRequestsToInsert.push({
            employeeId,
            leaveYear,
            leaveType,
            leaveSubmitDate: new Date(),
            leaveStatus: "Pending",
            leaveReason: "Half Day Leave",
            leaveDates: [date], // 🔥 SINGLE DATE ONLY
            leaveStartDate: date,
            leaveEndDate: date,
            leaveDays: 0.5,
            leaveStatus: adminId ? "Approved" : "Pending",
            isPaid: true,
            isHalfDay: true,
            halfDayType,
            submitBy: adminId || employeeId,
            leaveBreakdown: [{ leaveType, leaveYear, leaveDays: 0.5 }],
          });

          deducted = true;
        }

        // ---- Try Carry Forward
        if (
          !deducted &&
          settings?.data?.carryForwardEnabled &&
          annual.carryForwardAllowed &&
          annual.carryForwardRemaining >= 0.5
        ) {
          annual.carryForwardRemaining -= 0.5;

          leaveRequestsToInsert.push({
            employeeId,
            leaveYear,
            leaveType,
            leaveSubmitDate: new Date(),
            leaveStatus: adminId ? "Approved" : "Pending",
            leaveReason: "Half Day Leave (Carry Forward)",
            leaveDates: [date],
            leaveStartDate: date,
            leaveEndDate: date,
            leaveDays: 0.5,
            isPaid: true,
            isHalfDay: true,
            halfDayType,
            submitBy: adminId || employeeId,
            leaveBreakdown: [{ leaveType, leaveYear, leaveDays: 0.5 }],
          });

          deducted = true;
        }

        // ---- Fallback → Unpaid Leave (unlimited ✅)
        if (!deducted) {
          unpaid.used += 0.5;

          leaveRequestsToInsert.push({
            employeeId,
            leaveYear,
            leaveType: "Unpaid Leave",
            leaveSubmitDate: new Date(),
            leaveStatus: adminId ? "Approved" : "Pending",
            leaveReason: "Half Day Leave",
            leaveDates: [date],
            leaveStartDate: date,
            leaveEndDate: date,
            leaveDays: 0.5,
            isPaid: false,
            isHalfDay: true,
            halfDayType,
            submitBy: adminId || employeeId,
            leaveBreakdown: [
              { leaveType: "Unpaid Leave", leaveYear, leaveDays: 0.5 },
            ],
          });
        }
        commonLeave.markModified("leaveData");
      }
      await commonLeave.save({ session });
    }
    await LeaveRequestModel.insertMany(leaveRequestsToInsert, { session });
    return { success: true, message: "Leave added successfully." };
  });
}
//Add Half Day Request
export async function addHalfDayLeaveOld({ data, employeeId, adminId }) {
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

export async function addLeaveRequest({
  data,
  employeeId,
  adminId,
  session, // 🔥 REQUIRED for edit flow
}) {
  await connect();

  const { leaveType, leaveDates, leaveReason } = data;

  const settings = await getLeaveSettings();
  const startMonth = settings?.leaveYearStartMonth || 4;

  // 1️⃣ Overlap Validation (inside same transaction)

  // 2️⃣ Split dates by leave year
  const groupedByYear = splitLeaveDatesByYear(leaveDates, startMonth);

  const finalDeductions = [];

  // 3️⃣ VALIDATE + PLAN DEDUCTIONS (NO UPDATE YET)
  for (const [leaveYear, dates] of Object.entries(groupedByYear)) {
    let remainingDaysToDeduct = dates.length;

    const commonLeave = await CommonLeaveModel.findOne({
      employeeId,
      leaveYear,
    }).session(session);

    if (!commonLeave) {
      return {
        success: false,
        message: `Leave year ${leaveYear} is not generated yet. Contact HR.`,
      };
    }

    const leaveDataList = commonLeave.leaveData;

    const annual = leaveDataList.find((l) => l.leaveType === leaveType);

    if (!annual) {
      return {
        success: false,
        message: `${leaveType} not configured for ${leaveYear}`,
      };
    }
    // 🟡 Deduct from paid leave first
    if (annual.remaining > 0) {
      const useAnnual = Math.min(annual.remaining, remainingDaysToDeduct);

      finalDeductions.push({
        commonLeaveId: commonLeave._id,
        leaveYear,
        leaveType: leaveType,
        days: useAnnual,
        dates: dates.slice(0, useAnnual),
      });

      remainingDaysToDeduct -= useAnnual;
    }

    // 🔴 Remaining → Unpaid (unlimited)
    if (remainingDaysToDeduct > 0) {
      finalDeductions.push({
        commonLeaveId: commonLeave._id,
        leaveYear,
        leaveType: "Unpaid Leave",
        days: remainingDaysToDeduct,
        dates: dates.slice(-remainingDaysToDeduct),
      });

      remainingDaysToDeduct = 0;
    }
  }

  // 4️⃣ APPLY ALL DEDUCTIONS (ATOMIC, SAME SESSION)
  for (const item of finalDeductions) {
    await CommonLeaveModel.updateOne(
      {
        _id: item.commonLeaveId,
        "leaveData.leaveType": item.leaveType,
      },
      {
        $inc: {
          "leaveData.$.used": item.days,
          ...(item.leaveType !== "Unpaid Leave"
            ? { "leaveData.$.remaining": -item.days }
            : {}),
        },
        $push: {
          leaveHistory: {
            leaveType: item.leaveType,
            leaveYear: item.leaveYear,
            leaveDays: item.days,
            leaveDates: item.dates,
            createdAt: new Date(),
          },
        },
      },
      { session }
    );
  }

  // 5️⃣ BUILD REQUEST DOCUMENTS (ONE PER TYPE/YEAR/BLOCK)
  const requestsToInsert = [];

  for (const item of finalDeductions) {
    const { leaveYear, leaveType, days: leaveDays, dates: leaveDates } = item;

    const sortedDates = [...leaveDates].sort(
      (a, b) => new Date(a) - new Date(b)
    );

    const leaveStartDate = sortedDates[0];
    const leaveEndDate = sortedDates[sortedDates.length - 1];

    const approved = adminId
      ? { approvedBy: adminId, approvedDate: new Date() }
      : {};

    requestsToInsert.push({
      employeeId: createObjectId(employeeId),
      leaveYear,
      leaveType,
      leaveDates,
      leaveDays,
      leaveStartDate,
      leaveEndDate,
      leaveReason,
      leaveSubmitDate: normalizeDateToUTC(new Date()),
      leaveStatus: adminId ? "Approved" : "Pending",
      isPaid: leaveType !== "Unpaid Leave",
      leaveBreakdown: [{ leaveType, leaveYear, leaveDays }],
      ...approved,
      addByAdmin: !!adminId,
    });
  }

  // 6️⃣ INSERT ALL REQUESTS
  await LeaveRequestModel.insertMany(requestsToInsert, { session });

  return { success: true, message: "Leave added successfully." };
}

export async function addHalfDayLeave({
  data,
  employeeId,
  adminId,
  session, // 🔥 REQUIRED (from edit or normal flow)
}) {
  await connect();

  const { leaveType, leaveDates, halfDayType, leaveReason } = data;

  const settings = await getLeaveSettings();
  const startMonth = settings?.leaveYearStartMonth || 4;

  // 1️⃣ Overlap validation (inside transaction)

  // 2️⃣ Split by leave year
  const splitByYear = splitLeaveDatesByYear(leaveDates, startMonth);

  const finalDeductions = [];

  // 3️⃣ PLAN DEDUCTIONS (NO UPDATE YET 🔥)
  for (const [leaveYear, yearDates] of Object.entries(splitByYear)) {
    const commonLeave = await CommonLeaveModel.findOne({
      employeeId,
      leaveYear,
    }).session(session);

    if (!commonLeave) {
      return {
        success: false,
        message: `Leave entitlement not generated for ${leaveYear}`,
      };
    }

    const annual = commonLeave.leaveData.find(
      (l) => l.leaveType === "Annual Leave"
    );

    const unpaid = commonLeave.leaveData.find(
      (l) => l.leaveType === "Unpaid Leave"
    );

    if (!annual || !unpaid) {
      return {
        success: false,
        message: "Leave categories not configured",
      };
    }

    // 🔥 EACH DATE IS INDEPENDENT ENTRY
    for (const date of yearDates) {
      let deducted = false;

      // 🟡 Annual first
      if (annual.remaining >= 0.5) {
        finalDeductions.push({
          commonLeaveId: commonLeave._id,
          leaveYear,
          leaveType: leaveType,
          days: 0.5,
          date,
          isPaid: true,
        });

        annual.remaining -= 0.5;
        annual.used += 0.5;

        deducted = true;
      }

      // 🟠 Carry Forward (if enabled)
      else if (
        settings?.carryForwardEnabled &&
        annual.carryForwardAllowed &&
        annual.carryForwardRemaining >= 0.5
      ) {
        finalDeductions.push({
          commonLeaveId: commonLeave._id,
          leaveYear,
          leaveType: leaveType,
          days: 0.5,
          date,
          isPaid: true,
          isCarryForward: true,
        });

        annual.carryForwardRemaining -= 0.5;
        deducted = true;
      }

      // 🔴 Fallback → Unpaid (UNLIMITED)
      if (!deducted) {
        finalDeductions.push({
          commonLeaveId: commonLeave._id,
          leaveYear,
          leaveType: "Unpaid Leave",
          days: 0.5,
          date,
          isPaid: false,
        });

        unpaid.used += 0.5;
      }
    }

    commonLeave.markModified("leaveData");
    await commonLeave.save({ session });
  }

  console.log(finalDeductions);

  // 4️⃣ BUILD REQUEST DOCS (ONE PER DATE 🔥)
  const requestsToInsert = [];

  for (const item of finalDeductions) {
    const approved = adminId
      ? { approvedBy: adminId, approvedDate: new Date() }
      : {};

    requestsToInsert.push({
      employeeId: createObjectId(employeeId),
      leaveYear: item.leaveYear,
      leaveType: item.leaveType,
      leaveSubmitDate: normalizeDateToUTC(new Date()),
      leaveStatus: adminId ? "Approved" : "Pending",
      leaveReason,
      leaveDates: [item.date], // 🔥 SINGLE DATE
      leaveStartDate: item.date,
      leaveEndDate: item.date,
      leaveDays: 0.5,
      isPaid: item.isPaid,
      isHalfDay: true,
      halfDayType,
      submitBy: adminId || employeeId,
      leaveBreakdown: [
        {
          leaveType: item.leaveType,
          leaveYear: item.leaveYear,
          leaveDays: 0.5,
        },
      ],
      ...approved,
      addByAdmin: !!adminId,
    });
  }

  // 5️⃣ INSERT ALL
  await LeaveRequestModel.insertMany(requestsToInsert, { session });

  return { success: true, message: "Half-day leave added successfully." };
}

export async function editLeaveRequestAdvanced({
  requestIds, // array of old LeaveRequest IDs
  employeeId,
  newLeaveDates,
  leaveType,
  isHalfDay,
  halfDayType,
  leaveReason,
  submitBy,
}) {
  return await withTransaction(async (session) => {
    const mongooseId = createObjectId(employeeId);

    // 1️⃣ Fetch old leaves
    const oldLeaves = await LeaveRequestModel.find({
      _id: { $in: requestIds },
      leaveStatus: { $in: ["Pending", "Approved"] },
      isDeleted: false,
    }).session(session);

    if (!oldLeaves.length) {
      throw new Error("No valid leave requests found to edit");
    }

    // 4️⃣ Overlap validation for new dates
    const overlap = await LeaveRequestModel.find({
      employeeId: mongooseId,
      leaveDates: { $in: newLeaveDates },
      leaveStatus: { $in: ["Pending", "Approved"] },
      isDeleted: false,
      _id: { $nin: requestIds }, // exclude old requests
    }).session(session);

    if (overlap.length > 0) {
      throw new Error("Some selected dates already have leave");
    }

    // 2️⃣ Rollback old leave balances
    for (const old of oldLeaves) {
      const commonLeave = await CommonLeaveModel.findOne({
        employeeId: old.employeeId,
        leaveYear: old.leaveYear,
      });

      const leaveItem = commonLeave.leaveData.find((l) => {
        if (old.leaveType === "Half Day") {
          return (
            l.leaveType === "Annual Leave" || l.leaveType === "Unpaid Leave"
          );
        } else {
          return l.leaveType === old.leaveType;
        }
      });

      if (leaveItem) {
        leaveItem.used -= old.leaveDays;
        if (old.leaveType !== "Unpaid Leave") {
          leaveItem.remaining += old.leaveDays;
        }
      }
      commonLeave.markModified("leaveData");
      await commonLeave.save({ session });
    }

    // 3️⃣ Cancel old leave requests (keep history)
    await LeaveRequestModel.updateMany(
      { _id: { $in: requestIds } },
      {
        $set: {
          leaveStatus: "Cancelled",
          wasExpired: true,
        },
      },
      { session }
    );

    // 5️⃣ Apply new leave using SAME ENGINE
    let result;

    if (isHalfDay) {
      result = await addHalfDayLeave({
        data: {
          leaveDates: newLeaveDates,
          leaveType,
          halfDayType,
          leaveReason,
        },
        employeeId,
        adminId: submitBy !== employeeId ? submitBy : null,
        session,
      });
    } else {
      result = await addLeaveRequest({
        data: {
          leaveDates: newLeaveDates,
          leaveType,
          leaveReason,
        },
        employeeId,
        adminId: submitBy !== employeeId ? submitBy : null,
        session,
      });
    }

    if (!result.success) {
      return result;
    }

    return {
      success: true,
      message: "Leave edited successfully",
    };
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
    console.log("New Leave Data:", newLeaveData);

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

    // 2️⃣ Restore old balance based on leaveDates
    if (originalRequest.leaveDates && originalRequest.leaveDates.length > 0) {
      const oldLeaveDays = originalRequest.leaveDates.length;
      await updateLeaveBalance({
        employeeId,
        leaveYear: originalRequest.leaveYear,
        leaveType: originalRequest.leaveType,
        leaveDays: -oldLeaveDays,
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

    const sortedDates = [...leaveDates].sort(
      (a, b) => new Date(a) - new Date(b)
    );
    // Ensure Correct Order of Leave Dates

    // 7️⃣ Update main request
    const mainEntry = entries[0];
    originalRequest.leaveStartDate = sortedDates[0];
    originalRequest.leaveEndDate = sortedDates[sortedDates.length - 1];
    originalRequest.leaveReason = leaveReason;
    originalRequest.leaveDates = sortedDates;
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
