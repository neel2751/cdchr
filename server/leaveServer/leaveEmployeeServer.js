"use server";

import { getCommonSpecificLeave } from "./getLeaveServer";
import { addHalfDayLeave, addLeaveRequest } from "./leaveRequestServer";
import { getServerSideProps } from "../session/session";
import {
  validateOverlappingHalfDayLeave,
  validateOverlappingLeave,
} from "./helper/helper";
import { getLeaveYearString } from "@/helper/getLeaveYearString";
import { permissionRefusal } from "@/lib/actionAccess";
import { readDayLength } from "@/lib/leaveDayLength";

/**
 * An admin records leave for an employee, approved as it is entered.
 *
 * Guarded because it is an addressable endpoint: without the check any
 * signed-in member of staff could book approved leave against anybody's
 * balance, with themselves recorded as the approver.
 *
 * Full days or half days, of any leave type — see readDayLength(). The same
 * clash rules as an employee's own request: a full day cannot land on a day
 * already booked, and a half day only on the other half of one.
 */
export async function adminEmployeeLeaveRequest(data) {
  const denied = await permissionRefusal(["/admin/leaveManagement"]);
  if (denied) return denied;

  try {
    const { props } = await getServerSideProps();
    const adminId = props?.session?.user?._id;

    const asked = readDayLength(data);
    if (!asked.ok) return { success: false, message: asked.message };

    const { employeeId, leaveDates = [] } = data;
    // Historical records belong to the leave year of the days taken, not the
    // year the admin happens to be entering them in.
    const earliestLeaveDate = [...leaveDates]
      .map((date) => new Date(date))
      .sort((a, b) => a - b)[0];
    const leaveYear = getLeaveYearString(earliestLeaveDate || new Date());
    const commonLeave = await getCommonSpecificLeave({
      employeeId,
      leaveYear,
      specificLeave: asked.leaveType,
    });

    if (!commonLeave)
      return {
        success: false,
        message: "Leave Not Found Use the entitlement Tab",
      };

    if (asked.isHalfDay) {
      const overlapCheck = await validateOverlappingHalfDayLeave(
        employeeId,
        leaveDates,
        asked.halfDayType
      );
      if (!overlapCheck.success) return overlapCheck;

      return await addHalfDayLeave({
        data: { ...data, leaveType: asked.leaveType, halfDayType: asked.halfDayType },
        employeeId,
        adminId,
      });
    }

    const overlapCheck = await validateOverlappingLeave(employeeId, leaveDates);
    if (!overlapCheck.success) return overlapCheck;

    return await addLeaveRequest({
      data: { ...data, leaveType: asked.leaveType },
      employeeId,
      adminId,
    });
  } catch (error) {
    console.log(error);
    return { success: false, message: "Could not add the leave" };
  }
}
