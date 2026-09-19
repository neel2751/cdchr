import { redirect } from "next/navigation";

/** Moved to /admin/me/leave. See the note in ../my-attendance/page.jsx. */
export default function MyLeavesRedirect() {
  redirect("/admin/me/leave");
}
