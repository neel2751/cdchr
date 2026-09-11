import { redirect } from "next/navigation";

import { getAnnouncementById } from "@/server/announcementServer/announcementServer";
import AnnouncementDetail from "./announcementDetail";

export default async function Page({ params }) {
  const { id } = await params;
  const res = await getAnnouncementById(id);

  // Covers "not authorized", "not found" and a bad id alike — none of them has
  // anything useful to show on this page.
  if (!res?.success) redirect("/admin/announcements");

  const announcement = JSON.parse(res.data);

  return (
    <div className="p-4">
      <AnnouncementDetail announcement={announcement} />
    </div>
  );
}
