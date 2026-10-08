/**
 * Who may edit somebody else's attendance.
 *
 * NOT a "use server" module — these must not be callable from a browser.
 *
 * The clock-editing actions had no authorisation of any kind. `withAudit`
 * wraps them, but that only *logs*, and only for admin and superAdmin: a
 * caller with any other role falls through `AUDITED_ROLES` and runs the
 * handler unrecorded (lib/audit.js:42). The only thing standing between an
 * ordinary employee and rewriting anyone's hours was a role array on a menu
 * entry — and a menu entry does not gate a server action, which is an HTTP
 * endpoint reachable from any page the caller can already open.
 *
 * So: an employee could edit their own clock-out, or a colleague's, and it
 * would not appear in the audit log. Those times feed pay and CIS deductions.
 *
 * Authorisation reuses the permission system the rest of the app already
 * uses — a granted screen path on RoleBasedModel — rather than inventing a
 * second list of roles to keep in sync with the first.
 */
import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import RoleBasedModel from "@/models/rolebasedModel";
import { getServerSideProps } from "../session/session";

/**
 * Screens that carry clock actions. Holding either permission means this
 * person is trusted to correct attendance.
 *
 *   /admin/attendance          office attendance table
 *   /admin/siteAssignEmployee  site attendance table (the roll-call)
 */
export const ATTENDANCE_SCREENS = [
  "/admin/attendance",
  "/admin/siteAssignEmployee",
];

/** Roles that can never manage attendance, whatever has been granted. */
const NEVER = new Set(["siteEmployee", "reception"]);

/**
 * May the current session edit attendance?
 *
 * Returns `{ ok, user, reason }`. Never throws — callers return the reason to
 * the UI as an ordinary refusal.
 */
export async function canManageAttendance() {
  const deny = (reason) => ({ ok: false, user: null, reason });

  let user;
  try {
    const { props } = await getServerSideProps();
    user = props?.session?.user;
  } catch {
    return deny("Not signed in");
  }

  if (!user?._id) return deny("Not signed in");
  if (NEVER.has(user.role)) {
    return deny("You are not allowed to change attendance records.");
  }
  if (user.role === "superAdmin") return { ok: true, user, reason: null };
  if (!isValidObjectId(user._id)) return deny("Not signed in");

  await connect();
  const granted = await RoleBasedModel.findOne({
    employeeId: createObjectId(user._id),
    isActive: true,
  })
    .select("permissions")
    .lean();

  const permissions = granted?.permissions || [];
  const allowed = ATTENDANCE_SCREENS.some((path) => permissions.includes(path));

  return allowed
    ? { ok: true, user, reason: null }
    : deny("You are not allowed to change attendance records.");
}
