import { redirect } from "next/navigation";

import { getMyAnnouncementById } from "@/server/announcementServer/myAnnouncementServer";
import AnnouncementReader from "../announcementReader";

export default async function Page({ params }) {
  const { id } = await params;
  const res = await getMyAnnouncementById(id);

  // getMyAnnouncementById already refuses anything not addressed to this
  // person, so a failure here means "not for you" as often as "not found".
  if (!res?.success) redirect("/admin/my-announcements");

  return (
    <div className="p-4">
      <AnnouncementReader announcement={JSON.parse(res.data)} />
    </div>
  );
}
