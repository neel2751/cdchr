"use server";

/**
 * Taking a leave type off one employee, and putting it back.
 *
 * A soft delete, because an entitlement is a record of what somebody was owed:
 * removing the row outright would also remove the history of the days they
 * already took under it, and `leaveHistory` on the same document refers to it by
 * name.
 *
 * "Soft" was the problem, though. `isDelete` was written here and read in
 * exactly one place — the entitlement sheet, to grey the row and offer a Restore
 * button that had no action behind it. Nothing else looked at it, so a leave type
 * an admin had removed was still offered in the employee's own booking dropdown
 * and still had a balance to book against. Removing it removed it from one
 * screen. Both halves are fixed: the readers now filter on it (see
 * getSelectLeaveRequestForEmployee and the booking guard in leaveRequestServer),
 * and Restore below is a real action.
 */

import CommonLeaveModel from "@/models/commonLeaveModel";
import { getCommonSpecificLeave } from "./getLeaveServer";
import { createObjectId } from "@/lib/mongodb";
import { connect } from "@/db/db";
import { requireEntitlementAccess } from "@/lib/employeeAccess";
import { getServerSideProps } from "../session/session";

/** One `leaveHistory` entry, so a removal is as traceable as a change of total. */
async function historyEntry({ leaveType, action }) {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  return {
    updateAt: new Date(),
    updatedBy: user?._id || "System",
    updatedByName: user?.name || "System",
    role: user?.role || "system",
    leaveType,
    action,
  };
}

/**
 * Mark one leave type on one employee's entitlement as removed.
 *
 * Refused when any of it has been taken: `used` days are bookings that exist,
 * and hiding the allowance they came out of would leave those days charged to a
 * type the employee no longer appears to have. Hiding it from the employee's own
 * summary is what the Hide switch is for.
 */
export async function deleteOneCommonLeaveToOneEmployee({
  employeeId,
  leaveYear,
  leaveType,
}) {
  try {
    const refusal = await requireEntitlementAccess(employeeId);
    if (refusal) return refusal;

    if (!leaveYear || !leaveType) {
      return { success: false, message: "Leave type and leave year are required" };
    }

    await connect();
    const employeeObjectId = createObjectId(employeeId);
    const commonLeave = await getCommonSpecificLeave({
      employeeId: employeeObjectId,
      leaveYear,
      specificLeave: leaveType,
    });
    if (!commonLeave) return { success: false, message: "Leave not found" };

    // getCommonSpecificLeave returns the matched entitlement ROW, not the
    // document that holds it — it unwinds `leaveData` and projects the element.
    // So this is already `{ leaveType, total, used, remaining, … }`.
    const used = Number(commonLeave.used) || 0;
    if (used > 0) {
      return {
        success: false,
        message:
          `${leaveType} already has ${used} day(s) booked against it. ` +
          "Roll those back first, or use Hide to keep it off the employee's summary.",
      };
    }

    const result = await CommonLeaveModel.updateOne(
      { employeeId: employeeObjectId, leaveYear },
      {
        $set: { [`leaveData.$[leave].isDelete`]: true },
        $push: { leaveHistory: await historyEntry({ leaveType, action: "removed" }) },
      },
      {
        arrayFilters: [{ "leave.leaveType": leaveType }],
      }
    );
    if (!result.matchedCount) {
      return { success: false, message: "Leave not found" };
    }
    return { success: true, message: `${leaveType} removed` };
  } catch (error) {
    console.log("Error deleting leave", error);
    return { success: false, message: "Error deleting leave" };
  }
}

/**
 * Put a removed leave type back.
 *
 * The Restore button on the entitlement sheet had no action behind it — it
 * rendered, it was clickable, and it did nothing. This is it.
 */
export async function restoreOneCommonLeaveToOneEmployee({
  employeeId,
  leaveYear,
  leaveType,
}) {
  try {
    const refusal = await requireEntitlementAccess(employeeId);
    if (refusal) return refusal;

    if (!leaveYear || !leaveType) {
      return { success: false, message: "Leave type and leave year are required" };
    }

    await connect();
    const employeeObjectId = createObjectId(employeeId);

    const result = await CommonLeaveModel.updateOne(
      { employeeId: employeeObjectId, leaveYear },
      {
        $set: { [`leaveData.$[leave].isDelete`]: false },
        $push: {
          leaveHistory: await historyEntry({ leaveType, action: "restored" }),
        },
      },
      {
        arrayFilters: [{ "leave.leaveType": leaveType }],
      }
    );
    if (!result.matchedCount) {
      return { success: false, message: "Leave not found" };
    }
    return { success: true, message: `${leaveType} restored` };
  } catch (error) {
    console.log("Error restoring leave", error);
    return { success: false, message: "Error restoring leave" };
  }
}
