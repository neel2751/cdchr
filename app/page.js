import { redirect } from "next/navigation";
export default function Home() {
  // Check if the user is authenticated
  redirect("/admin/dashboard"); // Redirect to the admin dashboard
  return null; // Prevent rendering anything
}
