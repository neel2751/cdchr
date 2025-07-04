"use server";

import CommonLeaveModel from "@/models/commonLeaveModel";
import { getCommonSpecificLeave } from "./getLeaveServer";
import { createObjectId } from "@/lib/mongodb";
import { connect } from "@/db/db";
import { getServerSideProps } from "../session/session";

export async function deleteOneCommonLeaveToOneEmployee({
  employeeId,
  leaveYear,
  leaveType,
}) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const adminId = props?.session?.user?._id;
    const employeeObjectId = createObjectId(employeeId);
    const commonLeave = await getCommonSpecificLeave({
      employeeId: employeeObjectId,
      leaveYear,
      specificLeave: leaveType,
    });
    if (!commonLeave) return { success: false, message: "Leave not found" };
    // we have just update only like isDelete true in commom
    await CommonLeaveModel.updateOne(
      { employeeId: employeeObjectId, leaveYear },
      {
        $set: { [`leaveData.$[leave].isDelete`]: true },
      },
      {
        arrayFilters: [{ "leave.leaveType": leaveType }],
      }
    );
    return { success: true, message: "Leave deleted successfully" };
  } catch (error) {
    console.log("Error deleting leave", error);
    return { success: false, message: "Error deleting leave" };
  }
}
