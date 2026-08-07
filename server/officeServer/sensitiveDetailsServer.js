"use server";

import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import { isMatchedPassword } from "@/utils/bcrypt";
import { logAuditDirect } from "@/lib/audit";
import { getSensitiveAccess } from "@/lib/sensitiveAccess";
import { extractData } from "./officeEmployeeDetails";

/**
 * Whether the signed-in user may unlock protected employee details at all. Used
 * by the UI to choose between the password prompt and a "restricted" notice.
 */
export async function canViewSensitiveDetails() {
  const { allowed } = await getSensitiveAccess();
  return {
    success: true,
    message: "Sensitive details access resolved",
    data: allowed,
  };
}

/**
 * Release an employee's bank account details and National Insurance number.
 *
 * Two gates: the caller must hold the sensitive details permission (or be a
 * super admin), and must re-enter their own account password. Every attempt —
 * including a wrong password — is audited.
 *
 * @param {{ slug: string[], employeeType?: "office" | "site", password: string }} input
 */
export async function revealSensitiveDetails({
  slug,
  employeeType = "office",
  password,
} = {}) {
  const { allowed, user } = await getSensitiveAccess();

  // Audited directly rather than through withAudit: that helper only logs
  // admins, and a permitted non-admin reading these fields must be logged too.
  const audit = (status, description, entityId) =>
    logAuditDirect({
      actor: user,
      action: "SensitiveDetails.reveal",
      module: "SensitiveDetails",
      entityId,
      description,
      status,
      metadata: { employeeType },
    });

  if (!allowed) {
    await audit("failure", "Denied protected details access (no permission)");
    return {
      success: false,
      message: "You do not have permission to view these details",
    };
  }
  if (!password) {
    return { success: false, message: "Password is required" };
  }

  try {
    await connect();

    // Verify the password of the person asking, not the employee being viewed.
    const actor = await OfficeEmployeeModel.findById(user._id)
      .select("password name email")
      .lean()
      .exec();
    if (!actor?.password) {
      return { success: false, message: "Unable to verify your password" };
    }
    const isMatched = await isMatchedPassword(String(password), actor.password);
    if (!isMatched) {
      await audit("failure", "Protected details unlock failed: wrong password");
      return { success: false, message: "Incorrect password" };
    }

    const employeeId = await extractData(slug);
    if (!employeeId) {
      return { success: false, message: "Employee not found" };
    }

    const Model = employeeType === "site" ? EmployeModel : OfficeEmployeeModel;
    const employee = await Model.findById(employeeId)
      .select("bankDetail employeNI name firstName lastName")
      .lean()
      .exec();
    if (!employee) {
      return { success: false, message: "Employee not found" };
    }

    const targetName =
      employee.name ||
      `${employee.firstName || ""} ${employee.lastName || ""}`.trim() ||
      String(employeeId);

    await audit(
      "success",
      `${user?.name || user?.email} viewed bank & NI details of ${targetName}`,
      String(employeeId),
    );

    return {
      success: true,
      message: "Details unlocked",
      data: JSON.stringify({
        bankDetail: employee.bankDetail || {},
        employeNI: employee.employeNI || "",
      }),
    };
  } catch (error) {
    console.log("Error in revealSensitiveDetails:", error);
    return { success: false, message: "Error fetching protected details" };
  }
}
