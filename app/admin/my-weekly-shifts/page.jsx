import { redirect } from "next/navigation";

/** Moved to /admin/me/shifts. See the note in ../my-attendance/page.jsx. */
export default function MyWeeklyShiftsRedirect() {
  redirect("/admin/me/shifts");
}
