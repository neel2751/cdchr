"use server";

import { getLeaveYearString } from "@/lib/getLeaveYear";
import { getCommonSpecificLeave } from "./getLeaveServer";
import { differenceInDays } from "date-fns";
import { addHalfDayLeave, addLeaveRequest } from "./leaveRequestServer";
import { getServerSideProps } from "../session/session";
import { hasSufficientLeaveBalance } from "./helper/helper";

export async function adminEmployeeLeaveRequest(data) {
  try {
    const { props } = await getServerSideProps();
    const adminId = props?.session?.user?._id;
    const { employeeId, leaveType, leaveStartDate, leaveEndDate } = data;
    const totalCount = differenceInDays(leaveEndDate, leaveStartDate) + 1;
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
      const checkTotal = hasSufficientLeaveBalance(
        commonLeave?.total,
        totalCount,
        commonLeave?.type
      );
      console.log(checkTotal);
      if (!checkTotal.success) return checkTotal;

      const checkRemaining = hasSufficientLeaveBalance(
        commonLeave?.remaining,
        totalCount,
        commonLeave?.type,
        exatct
      );
      console.log(checkRemaining);
      if (!checkRemaining.success) return checkRemaining;
      if (leaveType === "Half Day") {
        console.log("Half Day run");
        const response = await addHalfDayLeave({ data, employeeId, adminId });
        console.log(response);
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
