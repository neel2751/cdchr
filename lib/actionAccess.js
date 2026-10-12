import { connect } from "@/db/db";
import RoleBasedModel from "@/models/rolebasedModel";
import { getServerSideProps } from "@/server/session/session";

/**
 * Refuse a server action when the caller does not hold the screen it belongs to.
 *
 * The companion to lib/requireFeature.js, which answers the other half of the
 * question. featureRefusal() asks whether the *company's plan* includes a
 * module; this asks whether *this person* may use it. Its own closing note says
 * that second question is "still answered by each module's own role/permission
 * guard" — this is that guard, in one place instead of twenty.
 *
 * WHY IT IS NEEDED AT ALL. proxy.js decides who may open a page: it matches the
 * path against data/menu.js, fetches the caller's permissions and redirects
 * anyone without them. None of that is in the way of a server action, which is
 * an addressable POST endpoint called directly rather than navigated to. So a
 * screen restricted to super admins in the sidebar had its buttons' actions
 * callable by any signed-in employee — including, across this codebase,
 * actions that delete departments, remove documents, revoke devices and write
 * attendance.
 *
 * Tenant enforcement (lib/tenantPlugin.js) already stops two larger things: a
 * signed-out caller has no tenant, so a scoped query throws, and a signed-in
 * one gets their own tenant injected, so they cannot reach another company's
 * rows. What is left is privilege escalation *inside* one company, which is
 * what this closes.
 *
 * PERMISSIONS, NOT ROLES. The authority is the same one proxy.js consults — the
 * page paths in the caller's RoleBased record — rather than a role name. Roles
 * in this app are coarse (`admin` covers everyone from HR to a site manager)
 * and the permission list is what an administrator actually grants, screen by
 * screen. Passing the paths whose buttons call an action therefore reproduces
 * exactly the access the product already intends, with no new policy invented:
 * someone who can open the page can use it, and someone who cannot, cannot.
 *
 * A super admin passes unconditionally, as in getEmployeeManageAccess() — they
 * hold every screen by definition and are not given RoleBased rows.
 *
 * Deliberately NOT a "use server" module, for the same reason as
 * lib/requireFeature.js: it backs an authorisation decision, and exporting it
 * from a server-action file would publish it as an endpoint of its own.
 *
 * Usage — one line at the top of an action, above the work:
 *
 *   const refusal = await permissionRefusal(["/admin/roleType"]);
 *   if (refusal) return refusal;
 *
 * @param {string[]} permissions menu paths whose screens legitimately call this
 * @returns {Promise<{success: false, message: string}|null>} null when allowed
 */
export async function permissionRefusal(permissions = []) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;

    if (!user?._id) return { success: false, message: "Not signed in" };
    if (user.role === "superAdmin") return null;

    // Nothing to match against means nobody but a super admin may call it.
    if (!permissions.length) {
      return { success: false, message: "You do not have access to this" };
    }

    await connect();
    const roles = await RoleBasedModel.find({
      employeeId: user._id,
      isDeleted: false,
    })
      .lean()
      .exec();

    const held = roles.flatMap((role) => role?.permissions || []);
    if (permissions.some((permission) => held.includes(permission))) return null;

    return { success: false, message: "You do not have access to this" };
  } catch (error) {
    // Fails CLOSED, unlike the branding and feature helpers which fail open.
    // Those decide what a page looks like; this decides whether somebody may
    // change data, and a database blip is not a reason to allow that.
    console.log("permissionRefusal error:", error?.message);
    return { success: false, message: "Could not verify your access" };
  }
}
