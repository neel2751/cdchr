import { connect } from "@/db/db";
import RoleBasedModel from "@/models/rolebasedModel";
import { getServerSideProps } from "@/server/session/session";
import { SENSITIVE_DETAILS_PERMISSION } from "@/data/menu";

// Employee fields that are never sent to the client with the rest of a profile.
export const SENSITIVE_FIELDS = ["bankDetail", "employeNI"];

/**
 * Who is allowed to read an employee's bank details and NI number.
 *
 * Super admins always are; anyone else needs the SENSITIVE_DETAILS_VIEW
 * capability on one of their roles. Holding the permission is only half the
 * gate — the values themselves are released by revealSensitiveDetails(), which
 * re-checks the caller's own password.
 *
 * Server-only: reads the session and the roles collection.
 *
 * @returns {Promise<{ allowed: boolean, user: object | null }>}
 */
export async function getSensitiveAccess() {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user || null;
    if (!user?._id) return { allowed: false, user: null };
    if (user.role === "superAdmin") return { allowed: true, user };

    await connect();
    const roles = await RoleBasedModel.find({
      employeeId: user._id,
      isDeleted: false,
    })
      .lean()
      .exec();
    const permissions = roles.flatMap((r) => r?.permissions || []);
    return {
      allowed: permissions.includes(SENSITIVE_DETAILS_PERMISSION),
      user,
    };
  } catch (error) {
    console.log("Error resolving sensitive details access:", error?.message);
    return { allowed: false, user: null };
  }
}

/** Strip the protected fields from a list of employee documents. */
export function stripSensitiveDetails(rows = []) {
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const key of SENSITIVE_FIELDS) delete row[key];
  }
  return rows;
}
