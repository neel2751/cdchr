"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, Check, Eye, Loader2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getAnnouncementRecipients,
  remindUnread,
} from "@/server/announcementServer/announcementReport";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { label: "Everyone", value: "all" },
  { label: "Not read", value: "unread" },
  { label: "Read", value: "read" },
  { label: "Acknowledged", value: "acknowledged" },
];

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-neutral-100 p-2 text-neutral-600">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">{label}</p>
          <p className="text-xl font-semibold leading-tight">{value}</p>
          {hint ? <p className="text-xs text-neutral-400">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function RecipientsReport({ announcementId, status }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Uses useQuery directly rather than the shared useFetchQuery hook: that hook
  // returns only { newData, totalCount } and would drop the stats block, which
  // is the headline of this screen.
  const { data, isLoading } = useQuery({
    queryKey: ["announcementRecipients", announcementId, filter, page],
    queryFn: async () => {
      const res = await getAnnouncementRecipients({
        id: announcementId,
        page,
        pageSize: PAGE_SIZE,
        status: filter,
      });
      return {
        rows: JSON.parse(res?.data || "[]"),
        totalCount: res?.totalCount || 0,
        stats: JSON.parse(res?.stats || "{}"),
      };
    },
    staleTime: 30_000,
  });

  const { rows = [], totalCount = 0, stats = {} } = data || {};

  const { mutate: remind, isPending: reminding } = useMutation({
    mutationFn: () => remindUnread(announcementId),
    onSuccess: (res) => {
      if (res?.success) {
        toast.success(res.message);
        queryClient.invalidateQueries({ queryKey: ["announcementRecipients"] });
      } else {
        toast.error(res?.message || "Could not send reminders");
      }
    },
    onError: (e) => toast.error(e?.message || "Could not send reminders"),
  });

  if (status !== "published") {
    return (
      <p className="rounded-lg border p-6 text-center text-sm text-neutral-500">
        {status === "scheduled"
          ? "This announcement has not gone out yet. The report appears once it is published."
          : "Only a published announcement has recipients to report on."}
      </p>
    );
  }

  const unread = Math.max((stats.total || 0) - (stats.read || 0), 0);
  const pageCount = Math.ceil(totalCount / PAGE_SIZE) || 1;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Users} label="Recipients" value={stats.total ?? "—"} />
        <Stat
          icon={Eye}
          label="Read"
          value={stats.read ?? "—"}
          hint={
            stats.total
              ? `${Math.round((stats.read / stats.total) * 100)}% of recipients`
              : undefined
          }
        />
        {stats.requireAck ? (
          <Stat
            icon={Check}
            label="Acknowledged"
            value={stats.acknowledged ?? "—"}
            hint={
              stats.total
                ? `${Math.round((stats.acknowledged / stats.total) * 100)}% of recipients`
                : undefined
            }
          />
        ) : (
          <Stat icon={BellRing} label="Not read" value={unread} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SelectFilter
          label="Show"
          value={filter}
          frameworks={STATUS_OPTIONS}
          placeholder="Everyone"
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          noData="No filters"
        />
        <Button
          variant="outline"
          onClick={() => remind()}
          disabled={reminding || unread === 0}
          title={
            unread === 0
              ? "Everyone has read this"
              : `Email the ${unread} who have not read it`
          }
        >
          {reminding ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <BellRing className="mr-1 size-4" />
          )}
          Remind {unread > 0 ? unread : ""} unread
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-neutral-500" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          Nobody matches this filter.
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Read</TableHead>
                {stats.requireAck && <TableHead>Acknowledged</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.employeeId}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-sm text-neutral-600">
                    {row.email || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.readAt ? (
                      formatDateTime(row.readAt)
                    ) : (
                      <Badge variant="outline">Not read</Badge>
                    )}
                  </TableCell>
                  {stats.requireAck && (
                    <TableCell className="text-sm">
                      {row.acknowledgedAt ? (
                        formatDateTime(row.acknowledgedAt)
                      ) : (
                        <Badge variant="secondary">Waiting</Badge>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t pt-4 text-sm">
              <span className="text-neutral-500">
                Page {page} of {pageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
