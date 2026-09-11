"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { getMyAnnouncements } from "@/server/announcementServer/myAnnouncementServer";

const LIMIT = 4;

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      })
    : "";

/**
 * Latest announcements, for both dashboard slots.
 *
 * Renders nothing at all when there are none — an empty card telling people
 * they have no messages is just noise on a dashboard that already has plenty.
 */
export default function AnnouncementsCard() {
  const { data } = useFetchQuery({
    queryKey: ["myAnnouncements", { dashboard: true }],
    params: { page: 1, pageSize: LIMIT },
    fetchFn: getMyAnnouncements,
  });

  const { newData: rows = [] } = data || {};
  if (!rows.length) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4" />
          Announcements
        </CardTitle>
        <Link
          href="/admin/my-announcements"
          className="text-xs text-neutral-500 hover:underline"
        >
          See all
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row._id}>
              <Link
                href={`/admin/my-announcements/${row._id}`}
                className="flex items-center gap-2 px-6 py-3 transition-colors hover:bg-neutral-50"
              >
                {!row.readAt && (
                  <span
                    className="size-2 shrink-0 rounded-full bg-blue-600"
                    aria-label="Unread"
                  />
                )}
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    row.readAt ? "" : "font-semibold"
                  }`}
                >
                  {row.title}
                </span>
                {row.priority === "urgent" && (
                  <Badge variant="destructive">Urgent</Badge>
                )}
                <span className="shrink-0 text-xs text-neutral-400">
                  {formatDate(row.publishedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
