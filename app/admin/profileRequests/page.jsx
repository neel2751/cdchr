import { redirect } from "next/navigation";
import { getEmployeeManageAccess } from "@/lib/employeeAccess";
import ProfileRequestQueue from "./profileRequestQueue";

export const metadata = { title: "Change requests" };

/**
 * What employees have asked HR to correct on their own records.
 *
 * Checked here as well as in every action behind the page. The route guard in
 * proxy.js gates this path on a permission, but that permission is granted per
 * role and this queue writes to employee records — so the page refuses to
 * render for anyone the actions would refuse anyway, rather than showing an
 * empty table and a row of buttons that do nothing.
 */
export default async function ProfileRequestsPage() {
  const { canManage } = await getEmployeeManageAccess();
  if (!canManage) redirect("/unauthorized");

  return <ProfileRequestQueue />;
}
