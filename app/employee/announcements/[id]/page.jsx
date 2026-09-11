import { redirect } from "next/navigation";

import { getMyAnnouncementById } from "@/server/announcementServer/myAnnouncementServer";
import EmployeeAnnouncementReader from "./employeeAnnouncementReader";

export default async function Page({ params }) {
  const { id } = await params;
  const res = await getMyAnnouncementById(id);

  // getMyAnnouncementById refuses anything not addressed to this person, so a
  // failure here means "not for you" as often as "not found".
  if (!res?.success) redirect("/employee/announcements");

  return <EmployeeAnnouncementReader announcement={JSON.parse(res.data)} />;
}
