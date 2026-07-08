"use server";

import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { daysUntil, getMilestone } from "@/lib/visaMilestones";
import { getServerSideProps } from "../session/session";
import { sendVisaReminderCore } from "./visaReminderJob";

/**
 * Manually send a visa-expiry reminder for one employee. Admin / super-admin
 * only. Computes the current milestone from the visa date and delegates to the
 * shared core (which records the send and dedupes).
 *
 * @param {{ employeeId: string, employeeType?: "OfficeEmploye"|"Employe", force?: boolean, ccHr?: boolean }} args
 */
export async function sendVisaReminderManually({
  employeeId,
  employeeType = "OfficeEmploye",
  force = false,
  ccHr = false,
}) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user || !["admin", "superAdmin"].includes(user.role)) {
      return { success: false, message: "Not authorized" };
    }
    if (!isValidObjectId(employeeId)) {
      return { success: false, message: "Invalid employee" };
    }

    await connect();
    const isField = employeeType === "Employe";
    const Model = isField ? EmployeModel : OfficeEmployeeModel;
    const employee = await Model.findById(createObjectId(employeeId)).lean();
    if (!employee) return { success: false, message: "Employee not found" };

    const visaField = isField ? "eVisaExp" : "visaEndDate";
    const milestone = getMilestone(daysUntil(employee[visaField]));
    if (!milestone) {
      return {
        success: false,
        message: "Visa is not within a reminder window",
      };
    }

    return await sendVisaReminderCore({
      employee,
      employeeType: isField ? "Employe" : "OfficeEmploye",
      milestone,
      actor: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      channel: "manual",
      force,
      ccHr,
    });
  } catch (error) {
    console.log("sendVisaReminderManually error", error);
    return { success: false, message: "Failed to send reminder" };
  }
}
