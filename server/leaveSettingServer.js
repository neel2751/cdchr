"use server";

import { connect } from "@/db/db";
import LeaveSettingModel from "@/models/leaveSettingModel";
import { splitLeaveDatesByYear } from "./leaveServer/helper/helper";
import PayrollLockModel from "@/models/payrollLockModel";

// export async function getLeaveSettings() {
//   try {
//     await connect();
//     let settings = await LeaveSettingModel.findOne();

//     if (!settings) {
//       settings = await LeaveSettingModel.create({
//         leaveYearStartMonth: 4,
//         carryFowardEnabled: false,
//       });
//     }
//     return { success: true, data: settings };
//   } catch (error) {
//     console.error("Error fetching leave settings:", error);
//     return { success: false, error: "Failed to fetch leave settings" };
//   }
// }

export async function getLeaveSettingsClient() {
  try {
    await connect();
    let settings = await LeaveSettingModel.findOne();

    if (!settings) {
      settings = await LeaveSettingModel.create({
        leaveYearStartMonth: 4,
        carryForwardEnabled: false,
      });
    }
    return { success: true, data: JSON.stringify(settings) };
  } catch (error) {
    console.log("Error fetching leave settings:", error);
    return { success: false, error: "Failed to fetch leave settings" };
  }
}

export async function getLeaveSettings() {
  try {
    await connect();
    let settings = await LeaveSettingModel.findOne();

    if (!settings) {
      settings = await LeaveSettingModel.create({
        leaveYearStartMonth: 4,
        carryForwardEnabled: false,
      });
    }
    return { success: true, data: settings };
  } catch (error) {
    console.log("Error fetching leave settings:", error);
    return { success: false, error: "Failed to fetch leave settings" };
  }
}

// export async function updateLeaveSettings(data) {
//   try {
//     await connect();

//     const { leaveYearStartMonth, carryForwardEnabled } = data;

//     let settings = await LeaveSettingModel.findOne();

//     if (!settings) {
//       settings = await LeaveSettingModel.create({
//         leaveYearStartMonth,
//         carryForwardEnabled,
//       });
//     } else {
//       settings.leaveYearStartMonth = leaveYearStartMonth;
//       settings.carryForwardEnabled = carryForwardEnabled;
//       await settings.save();
//     }

//     return {
//       success: true,
//       message: "Leave settings updated successfully",
//       data: JSON.parse(JSON.stringify(settings)),
//     };
//   } catch (error) {
//     console.log("updateLeaveSettings error:", error);
//     return { success: false, message: "Failed to update leave settings" };
//   }
// }

export async function updateLeaveSettings(data) {
  await connect();

  let settings = await LeaveSettingModel.findOne({});
  if (!settings) {
    settings = new LeaveSettingModel(data);
  } else {
    Object.assign(settings, data);
  }

  await settings.save();
  return { success: true, data: JSON.parse(JSON.stringify(settings)) };
}

export async function checkPayrollLockForLeave(leaveDates) {
  const settings = await getLeaveSettings();
  const startMonth = settings.leaveYearStartMonth;

  const grouped = splitLeaveDatesByYear(leaveDates, startMonth);

  for (const leaveYear of Object.keys(grouped)) {
    const lock = await PayrollLockModel.findOne({
      // companyId,
      lockType: "LEAVE_YEAR",
      lockKey: leaveYear,
      isLocked: true,
    });

    if (lock) {
      return {
        locked: true,
        message: `Leave year ${leaveYear} is locked because payroll is processed.`,
      };
    }
  }

  return { locked: false };
}
