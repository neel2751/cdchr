"use server";

import { connect } from "@/db/db";
import LeaveSettingModel from "@/models/leaveSettingModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { getServerSideProps } from "./session/session";
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

/**
 * This company's leave settings.
 *
 * NOTE THE SHAPE: `{ success, data }`, where `data` is the document. Four call
 * sites read `settings.leaveYearStartMonth` straight off the wrapper, which is
 * always `undefined`, and every one of them then fell back to April — so a
 * company on a January–December leave year had its bookings, its payroll locks
 * and its entitlement sync all filed under the wrong twelve months while the
 * screens showing them computed the right ones. Unwrap `.data` first.
 *
 * Creates the document with April defaults if there is none, so its existence
 * says nothing about whether anybody chose these settings — `configuredAt` is
 * what says that.
 */
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

/**
 * Save the company's leave settings.
 *
 * TWO THINGS THIS DID NOT DO.
 *
 * It had no authorisation of any kind. Every exported "use server" function is
 * an addressable endpoint whether or not a button points at it, so any signed-in
 * account could move the company's leave year start month — the date every
 * entitlement and every booking is measured from — or switch carry-forward on
 * for everybody. Same bar as the setup screen: super admin only.
 *
 * And it `Object.assign`-ed the caller's payload straight onto the document, so
 * a request could set any field on it, including `configuredAt` (which decides
 * whether a company is sent to the setup wizard) and `tenantId`. Only the four
 * settings this screen actually edits are copied across now.
 */
export async function updateLeaveSettings(data) {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { success: false, message: "Not signed in" };
  if (user.role !== "superAdmin") {
    return {
      success: false,
      message: "Only a super admin can change leave settings",
    };
  }

  await connect();

  const payload = pickLeaveSettings(data);
  if (payload.leaveYearStartMonth !== undefined) {
    const month = Number(payload.leaveYearStartMonth);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { success: false, message: "Choose a valid leave year start month" };
    }
    payload.leaveYearStartMonth = month;
  }

  let settings = await LeaveSettingModel.findOne({});
  if (!settings) {
    settings = new LeaveSettingModel(payload);
  } else {
    Object.assign(settings, payload);
  }

  await settings.save();
  return { success: true, data: JSON.parse(JSON.stringify(settings)) };
}

/**
 * The fields this screen is allowed to write, and nothing else.
 *
 * `configuredAt`, `configuredBy` and `tenantId` are deliberately absent: the
 * first decides whether a company is sent to the setup wizard, and the last
 * would move its settings into another company.
 */
function pickLeaveSettings(data = {}) {
  const payload = {};
  for (const key of [
    "leaveYearStartMonth",
    "carryForwardEnabled",
    "carryForwardRules",
    "accrualEnabled",
  ]) {
    if (data[key] !== undefined) payload[key] = data[key];
  }

  // The rules array comes from the browser, so each entry is rebuilt from the
  // keys the schema has rather than trusted wholesale.
  if (Array.isArray(payload.carryForwardRules)) {
    payload.carryForwardRules = payload.carryForwardRules
      .filter((rule) => rule?.leaveType)
      .map((rule) => ({
        leaveType: String(rule.leaveType),
        allowed: rule.allowed === true,
        maxDays: Math.max(Number(rule.maxDays) || 0, 0),
        expireAfterMonths: Math.max(Number(rule.expireAfterMonths) || 0, 0),
        proRated: rule.proRated === true,
        minMonthsService: Math.max(Number(rule.minMonthsService) || 0, 0),
        minDaysRemaining: Math.max(Number(rule.minDaysRemaining) || 0, 0),
        appliesTo: {
          employeeTypes: (rule.appliesTo?.employeeTypes || [])
            .filter((value) => typeof value === "string" && value)
            .map(String),
          departments: (rule.appliesTo?.departments || [])
            .filter((value) => isValidObjectId(String(value)))
            .map((value) => createObjectId(String(value))),
        },
      }));
  }

  return payload;
}

export async function checkPayrollLockForLeave(leaveDates) {
  const settings = await getLeaveSettings();
  // `.data`, not the wrapper — see the note on getLeaveSettings above. Read off
  // the wrapper this was undefined, so the dates were grouped into April-based
  // leave years and the lock for the company's real leave year was never found:
  // a locked year still accepted new leave.
  const startMonth = settings?.data?.leaveYearStartMonth || 4;

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
