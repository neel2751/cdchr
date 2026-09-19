import { redirect } from "next/navigation";

/**
 * Moved to /admin/me/attendance.
 *
 * Kept as a redirect rather than deleted: this path has been in the sidebar, so
 * it is in people's history and bookmarks. It is listed as a hidden entry in
 * COMMONMENUITEMS so the route guard lets an ordinary employee reach this
 * redirect instead of bouncing them to the dashboard.
 */
export default function MyAttendanceRedirect() {
  redirect("/admin/me/attendance");
}
