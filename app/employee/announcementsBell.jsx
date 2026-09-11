"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { useAnnouncementSocket } from "@/hooks/useAnnouncementSocket";
import { getMyUnreadCount } from "@/server/announcementServer/myAnnouncementServer";

/**
 * The portal's bell. Replaces the decorative one that did nothing.
 *
 * A link rather than a popover: on a phone, a list that is one tap away beats a
 * dropdown that needs a second tap to open anything in it.
 */
export default function AnnouncementsBell() {
  useAnnouncementSocket(true);

  const { data } = useFetchSelectQuery({
    queryKey: ["myAnnouncementsUnread"],
    fetchFn: getMyUnreadCount,
  });

  const count = data?.count || 0;

  return (
    <Button asChild variant="outline" size="icon" className="relative">
      <Link href="/employee/announcements" aria-label="Announcements">
        <Bell />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
