"use server";

import { getCommonSpecificLeave } from "./getLeaveServer";
import { differenceInDays } from "date-fns";
import { addHalfDayLeave, addLeaveRequest } from "./leaveRequestServer";
import { getServerSideProps } from "../session/session";
import { hasSufficientLeaveBalance } from "./helper/helper";
import { getLeaveYearString } from "@/helper/getLeaveYearString";

export async function adminEmployeeLeaveRequest(data) {
  try {
    const { props } = await getServerSideProps();
    const adminId = props?.session?.user?._id;
    const { employeeId, leaveType, leaveDates } = data;
    const totalCount = leaveDates.length;
    const leaveYear = getLeaveYearString(new Date());
    const commonLeave = await getCommonSpecificLeave({
      employeeId,
      leaveYear,
      specificLeave: leaveType,
    });

    if (!commonLeave)
      return {
        success: false,
        message: "Leave Not Found Use the entitlement Tab",
      };

    const exatct =
      commonLeave?.leaveType === "Maternity Leave" ||
      commonLeave?.leaveType === "Paternity Leave"
        ? true
        : false;

    if (leaveType !== "Unpaid Leave" || leaveType !== "Half Day") {
      // const checkTotal = hasSufficientLeaveBalance(
      //   commonLeave?.total,
      //   totalCount,
      //   commonLeave?.type
      // );
      // if (!checkTotal.success) return checkTotal;

      // const checkRemaining = hasSufficientLeaveBalance(
      //   commonLeave?.remaining,
      //   totalCount,
      //   commonLeave?.type,
      //   exatct
      // );
      // if (!checkRemaining.success) return checkRemaining;

      if (leaveType === "Half Day") {
        const response = await addHalfDayLeave({ data, employeeId, adminId });
        return response;
      } else {
        const response = await addLeaveRequest({ data, employeeId, adminId });
        return response;
      }
    }
  } catch (error) {
    console.log(error);
  }
}
