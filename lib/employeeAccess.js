import { connect } from "@/db/db";
import RoleBasedModel from "@/models/rolebasedModel";
import { isValidObjectId } from "@/lib/mongodb";
import { SELF_EDITABLE_FIELDS } from "@/lib/profileFields";
import { getServerSideProps } from "@/server/session/session";

/**
 * Who may act on somebody else's employee record.
 *
 * Every exported "use server" function is an individually addressable endpoint,
 * not just the code behind a button — so a server action that takes an employee
 * id from its caller and writes to it is reachable by anyone with a session,
 * whether or not the UI ever offers them the button. The route guard in
 * proxy.js decides who can open a *page*; it says nothing about who can call an
 * action. This module is the missing half.
 *
 * The permission list is deliberately the set of pages that already edit
 * employee records or file documents against them, because those are the pages
 * whose buttons call these actions today:
 *
 *   /admin/officeEmployee         the office staff list and its detail tabs
 *   /admin/previousOfficeEmployee the same, for leavers
 *   /admin/employee               site staff and their documents
 *   /admin/previousEmployee       the same, for leavers
 *   /admin/leaveManagement        leave entitlements, which write dayPerWeek
 *
 * Holding any one of them leaves behaviour exactly as it is today. The check
 * exists to stop somebody holding *none* of them — an ordinary employee — from
 * writing to a record that is not theirs.
 */
export const EMPLOYEE_MANAGE_PERMISSIONS = [
  "/admin/officeEmployee",
  "/admin/previousOfficeEmployee",
  "/admin/employee",
  "/admin/previousEmployee",
  "/admin/leaveManagement",
];

/**
 * The fields an employee may change on their own record without asking HR.
 *
 * Derived from the one table in lib/profileFields.js that also drives the
 * screen, so what the profile page offers as editable and what this module
 * permits cannot drift apart. Widening it is a policy decision and it happens
 * there, where the reasoning sits next to the field.
 */
export { SELF_EDITABLE_FIELDS } from "@/lib/profileFields";

/**
 * The caller, and whether they may act on records other than their own.
 *
 * Server-only: reads the session and the roles collection. Mirrors
 * getSensitiveAccess() in lib/sensitiveAccess.js, which answers the same shape
 * of question about bank details.
 *
 * @returns {Promise<{ user: object | null, canManage: boolean }>}
 */
export async function getEmployeeManageAccess() {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user || null;
    if (!user?._id) return { user: null, canManage: false };
    if (user.role === "superAdmin") return { user, canManage: true };

    await connect();
    const roles = await RoleBasedModel.find({
      employeeId: user._id,
      isDeleted: false,
    })
      .lean()
      .exec();
    const permissions = roles.flatMap((r) => r?.permissions || []);
    const canManage = EMPLOYEE_MANAGE_PERMISSIONS.some((permission) =>
      permissions.includes(permission)
    );
    return { user, canManage };
  } catch (error) {
    console.log("Error resolving employee access:", error?.message);
    return { user: null, canManage: false };
  }
}

/**
 * Whose record this call is actually allowed to touch.
 *
 * A caller without the management permission is pinned to their own id no
 * matter what they asked for — the same rule `extractData` already applies to
 * reads, applied to the rest of it. A caller with the permission gets the id
 * they asked for, so nothing changes for HR.
 *
 * @param {string} [requestedId] the id the caller named, decrypted
 * @returns {Promise<{ user: object|null, canManage: boolean, employeeId: string|null, isSelf: boolean }>}
 */
export async function resolveEmployeeTarget(requestedId) {
  const { user, canManage } = await getEmployeeManageAccess();
  if (!user?._id) {
    return { user: null, canManage: false, employeeId: null, isSelf: false };
  }

  const own = String(user._id);
  if (!canManage) {
    return { user, canManage: false, employeeId: own, isSelf: true };
  }

  const requested =
    requestedId && isValidObjectId(String(requestedId))
      ? String(requestedId)
      : own;
  return {
    user,
    canManage: true,
    employeeId: requested,
    isSelf: requested === own,
  };
}

/**
 * Reduce an update payload to the fields a person may change on themselves.
 *
 * Returns only keys actually present in `data`, so an absent field stays absent
 * rather than being written as undefined.
 */
export function pickSelfEditableFields(data = {}) {
  const picked = {};
  for (const field of SELF_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      picked[field] = data[field];
    }
  }
  return picked;
}
