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
import { CommonContext } from "@/context/commonContext";
import { useFetchQuery } from "@/hooks/use-query";
import Pagination from "@/lib/pagination";
import { getMyAnnouncements } from "@/server/announcementServer/myAnnouncementServer";
import {
  CATEGORY_LABEL,
  PRIORITY_VARIANT,
} from "../announcements/constants";

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
  return plain.length > 180 ? `${plain.slice(0, 180)}…` : plain;
}

const MyAnnouncements = ({ searchParams }) => {
  const currentPage = parseInt(searchParams?.page || "1");
  const pagePerData = parseInt(searchParams?.pageSize || "10");

  const { data, isLoading, isError } = useFetchQuery({
    params: { page: currentPage, pageSize: pagePerData },
    queryKey: ["myAnnouncements", { currentPage, pagePerData }],
    fetchFn: getMyAnnouncements,
  });

  const { newData: result = [], totalCount = 0 } = data || {};

  return (
    <div className="p-4">
      <CommonContext.Provider
        value={{ result, currentPage, pagePerData, totalCount }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Announcements</CardTitle>
            <CardDescription>
              Messages from your company. Unread ones are highlighted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex h-20 w-full items-center justify-center">
                <Loader2 className="size-10 animate-spin text-neutral-500" />
              </div>
            ) : isError ? (
              <div className="text-center text-gray-500">
                Something went wrong
              </div>
            ) : result.length <= 0 ? (
              <div className="py-10 text-center text-gray-500">
                Nothing to read right now.
              </div>
            ) : (
              <>
                <ul className="divide-y">
                  {result.map((row) => {
                    const unread = !row.readAt;
                    const pinned =
                      row.priority === "urgent" || row.priority === "important";
                    return (
                      <li key={row._id}>
                        <Link
                          href={`/admin/my-announcements/${row._id}`}
                          className={`block px-3 py-4 transition-colors hover:bg-neutral-50 ${
                            unread ? "bg-neutral-50/60" : ""
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {unread && (
                              <span
                                className="size-2 shrink-0 rounded-full bg-blue-600"
                                aria-label="Unread"
                              />
                            )}
                            {pinned && (
                              <Pin className="size-3.5 text-neutral-400" />
                            )}
                            <span
                              className={`text-sm ${
                                unread ? "font-semibold" : "font-medium"
                              }`}
                            >
                              {row.title}
                            </span>
                            <Badge
                              variant={PRIORITY_VARIANT[row.priority] || "outline"}
                            >
                              {row.priority}
                            </Badge>
                            <Badge variant="outline">
                              {CATEGORY_LABEL[row.category] || row.category}
                            </Badge>
                            {row.requireAck && !row.acknowledgedAt && (
                              <Badge variant="secondary">
                                Needs acknowledgement
                              </Badge>
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
                {totalCount > 10 && (
                  <div className="mt-2 border-t pt-4">
                    <Pagination />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </CommonContext.Provider>
    </div>
  );
};

export default MyAnnouncements;
