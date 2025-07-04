// app/leave/page.jsx
import { permanentRedirect } from "next/navigation";

export default function LeaveLandingPage() {
  // Redirect the user to /leave/overview if there is no slug in the URL
  permanentRedirect("/admin/leaveManagement/overview");
}
