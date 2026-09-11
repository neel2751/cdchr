"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  dismissAnnouncement,
  getUrgentAnnouncements,
} from "@/server/announcementServer/myAnnouncementServer";

/**
 * The strip across the top of the admin shell for urgent announcements.
 *
 * Mounted once in app/admin/providers.jsx rather than per page, so a new urgent
 * announcement reaches every screen without each one opting in.
 *
 * An announcement that requires acknowledgement has no dismiss button: the only
 * way past it is to open it and acknowledge, which is the point of marking it
 * urgent and requiring an acknowledgement in the first place.
 */
export default function AnnouncementBanner() {
  const queryClient = useQueryClient();

  const { data: urgent = [] } = useFetchSelectQuery({
    queryKey: ["urgentAnnouncements"],
    fetchFn: getUrgentAnnouncements,
  });

  if (!urgent?.length) return null;

  const dismiss = async (id) => {
    await dismissAnnouncement(id);
    queryClient.invalidateQueries({ queryKey: ["urgentAnnouncements"] });
    queryClient.invalidateQueries({ queryKey: ["myAnnouncementsUnread"] });
  };

  return (
    <div className="space-y-px">
      {urgent.map((announcement) => (
        <div
          key={announcement._id}
          className="flex flex-wrap items-center gap-3 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900"
        >
          <AlertTriangle className="size-4 shrink-0 text-rose-600" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">Urgent:</span> {announcement.title}
          </span>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-rose-300 bg-white hover:bg-rose-100"
          >
            <Link href={`/admin/my-announcements/${announcement._id}`}>
              {announcement.requireAck ? "Read and acknowledge" : "Read"}
            </Link>
          </Button>
          {!announcement.requireAck && (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 hover:bg-rose-100"
              aria-label="Dismiss"
              onClick={() => dismiss(announcement._id)}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
