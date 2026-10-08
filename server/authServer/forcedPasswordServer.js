"use server";

import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import { hashPassword } from "@/utils/bcrypt";
import { escapeTenant } from "@/lib/tenantContext";
import { isValidObjectId } from "@/lib/mongodb";
import { logAuditDirect } from "@/lib/audit";
import { getServerSideProps } from "../session/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordStrength";

/**
 * Replace your own password during a forced change.
 *
 * Narrow on purpose. It refuses unless the account is actually flagged
 * `mustChangePassword`, so it cannot be used as a way to change a password
 * without knowing the current one — that remains what
 * changeOfficeEmployeePassword is for. The only state it will act on is the one
 * where an administrator has just set a password and the person is standing at
 * the gate with it.
 *
 * No current-password prompt: they authenticated with it seconds ago to reach
 * this page, and asking again only encourages writing the temporary one down.
 *
 * `sessionsValidFrom` is deliberately NOT moved. It is the admin's "sign out
 * everywhere" stamp; touching it here would invalidate the session doing the
 * changing and bounce the person back to the login screen having succeeded.
 */
export async function setOwnPassword({ newPassword } = {}) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    const userId = user?._id;

    if (!userId || !isValidObjectId(userId)) {
      return { success: false, message: "Not signed in" };
    }
    if (!newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
      return {
        success: false,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      };
    }

    await connect();

    // Both collections, because the reset dialog serves office and site staff.
    // escapeTenant for the same reason the login queries use it: this runs at
    // the edge of a session, pinned to the caller's own id.
    const result = await escapeTenant("forced password change", async () => {
      for (const Model of [OfficeEmployeeModel, EmployeModel]) {
        const doc = await Model.findById(userId);
        if (doc) return { doc, Model };
      }
      return null;
    });

    if (!result?.doc) return { success: false, message: "Account not found" };

    const { doc } = result;

    // The gate has to be open for this to do anything. Someone who is not being
    // forced to change should use Account settings, where the current password
    // is required.
    if (doc.mustChangePassword !== true) {
      return {
        success: false,
        message:
          "No password change is outstanding on this account. Change it from Account settings instead.",
      };
    }

    const hashed = await hashPassword(String(newPassword));
    if (!hashed) {
      return { success: false, message: "Could not secure the new password" };
    }

    doc.password = hashed;
    doc.mustChangePassword = false;
    await escapeTenant("forced password change: save", () => doc.save());

    // Read back, for the same reason the reset action does: a stale compiled
    // model drops unknown paths silently, and "you changed it" followed by
    // being sent straight back here would be baffling.
    const saved = await escapeTenant("forced password change: verify", () =>
      OfficeEmployeeModel.findById(userId)
        .select("mustChangePassword")
        .lean()
        .then((r) => r ?? EmployeModel.findById(userId).select("mustChangePassword").lean())
    );

    if (saved?.mustChangePassword === true) {
      return {
        success: false,
        message:
          "The password was saved but the change requirement could not be cleared. Restart the app and try again.",
      };
    }

    await logAuditDirect({
      actor: user,
      action: "Account.forcedPasswordChange",
      module: "Account",
      entityId: userId,
      description:
        "Set their own password after an administrator reset required a change",
    });

    return { success: true, message: "Password updated" };
  } catch (error) {
    console.log("setOwnPassword error:", error?.message);
    return { success: false, message: "Could not set the password" };
  }
}
