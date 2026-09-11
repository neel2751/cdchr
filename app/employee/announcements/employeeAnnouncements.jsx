"use client";

import Link from "next/link";
import { Loader2, Pin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { getMyAnnouncements } from "@/server/announcementServer/myAnnouncementServer";

const PAGE_SIZE = 20;

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

/** First couple of lines, with the markdown syntax stripped back out. */
function excerpt(body = "") {
  const plain = body
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 160 ? `${plain.slice(0, 160)}…` : plain;
}

/**
 * The field portal's announcement list.
 *
 * Deliberately its own screen rather than a shared component with
 * /admin/my-announcements: the two live in different shells, and this one is
 * read on a phone on a building site — bigger tap targets, no filters, no
 * pagination controls beyond a longer page.
 */
export default function EmployeeAnnouncements({ searchParams }) {
  const page = parseInt(searchParams?.page || "1");

  const { data, isLoading, isError } = useFetchQuery({
    params: { page, pageSize: PAGE_SIZE },
    queryKey: ["myAnnouncements", { employee: true, page }],
    fetchFn: getMyAnnouncements,
  });

  const { newData: rows = [] } = data || {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>Announcements</CardTitle>
        <CardDescription>
          Messages from your company. Unread ones are highlighted.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-neutral-500" />
          </div>
        ) : isError ? (
          <p className="py-10 text-center text-sm text-neutral-500">
            Something went wrong.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-500">
            Nothing to read right now.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => {
              const unread = !row.readAt;
              const pinned =
                row.priority === "urgent" || row.priority === "important";
              return (
                <li key={row._id}>
                  <Link
                    href={`/employee/announcements/${row._id}`}
                    className={`block px-5 py-4 transition-colors active:bg-neutral-100 ${
                      unread ? "bg-neutral-50" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {unread && (
                        <span
                          className="size-2 shrink-0 rounded-full bg-blue-600"
                          aria-label="Unread"
                        />
                      )}
                      {pinned && <Pin className="size-4 text-neutral-400" />}
                      <span
                        className={`text-base ${
                          unread ? "font-semibold" : "font-medium"
                        }`}
                      >
                        {row.title}
                      </span>
                      {row.priority === "urgent" && (
                        <Badge variant="destructive">Urgent</Badge>
                      )}
                      {row.requireAck && !row.acknowledgedAt && (
                        <Badge variant="secondary">Needs your OK</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-neutral-600">
                      {excerpt(row.body)}
                    </p>
                    <p className="mt-1 text-xs text-neutral-400">
                      {row.createdByName || "Your company"} ·{" "}
                      {formatDate(row.publishedAt)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
