import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import { escapeTenant } from "@/lib/tenantContext";
import { isValidObjectId } from "@/lib/mongodb";

/**
 * The two password-security flags for an account, read fresh.
 *
 * Deliberately NOT a "use server" module: this backs an authorisation decision
 * in the jwt callback, and exporting it from a server-action file would publish
 * it as an endpoint — the same reason lib/tenantFeatures.js stays out of one.
 *
 * `escapeTenant` because this runs during session refresh, before any tenant
 * scope exists — the same position the login queries are in.
 *
 * Fails open, returning nothing. A database blip must not sign the whole
 * company out or trap everyone on the change-password screen; the cost of the
 * opposite is that a reset takes effect on the next successful read instead.
 *
 * Both collections are searched because the reset dialog serves office and site
 * employees alike.
 *
 * @returns {Promise<{sessionsValidFrom?: Date, mustChangePassword?: boolean}>}
 */
export async function passwordSecurityState(userId) {
  if (!userId || !isValidObjectId(userId)) return {};
  try {
    await connect();
    return await escapeTenant("auth: password security flags", async () => {
      const projection = "sessionsValidFrom mustChangePassword";
      const office = await OfficeEmployeeModel.findById(userId)
        .select(projection)
        .lean();
      if (office) return office;

      const site = await EmployeModel.findById(userId)
        .select(projection)
        .lean();
      return site || {};
    });
  } catch (error) {
    console.log("passwordSecurityState error:", error?.message);
    return {};
  }
}
