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
 * `roles` is for the callers who hold no permissions to check. A reception
 * account is not an office employee and has no RoleBased row at all, so the
 * reception desk's own actions name the role instead — matching rolePathMap in
 * proxy.js, which gives that role /hr and nothing else. Use it only where a
 * whole user type legitimately performs the action, never to wave through a
 * role that merely tends to.
 *
 * `anyPermission` is for the shared pickers — the employee, project and
 * category dropdowns that appear on a dozen admin screens, one of them through
 * a generic filter component. Listing every path that mounts them would be a
 * list that breaks a screen the day somebody reuses the component, and the
 * honest rule is simpler than the list: whoever administers anything here may
 * see the people and projects they administer. Somebody holding no permission
 * at all is an ordinary employee, and that is exactly who should not be
 * enumerating colleagues.
 *
 * @param {string[]} permissions menu paths whose screens legitimately call this
 * @param {{roles?: string[], anyPermission?: boolean}} [options]
 * @returns {Promise<{success: false, message: string}|null>} null when allowed
 */
export async function permissionRefusal(
  permissions = [],
  { roles = [], anyPermission = false } = {}
) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;

    if (!user?._id) return { success: false, message: "Not signed in" };
    if (user.role === "superAdmin") return null;
    if (roles.length && roles.includes(user.role)) return null;

    // Nothing to match against means nobody but a super admin may call it.
    if (!permissions.length && !anyPermission) {
      return { success: false, message: "You do not have access to this" };
    }

    await connect();
    // `roleRows`, not `roles`: the parameter above is named roles, and a second
    // `const roles` in the same function scope put the parameter in a temporal
    // dead zone — reading it threw, every non-super-admin fell into the catch,
    // and the refusal that came back said "could not verify" instead of what it
    // meant. Caught by the reception-desk test, which expected an allow.
    const roleRows = await RoleBasedModel.find({
      employeeId: user._id,
      isDeleted: false,
    })
      .lean()
      .exec();

    const held = roleRows.flatMap((row) => row?.permissions || []);
    if (anyPermission && held.length) return null;
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
