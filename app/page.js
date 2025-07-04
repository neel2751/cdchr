import { redirect } from "next/navigation";
export default function Home() {
  redirect("/admin/dashboard"); // Redirect to the admin dashboard
  return null; // Prevent rendering anything
}
