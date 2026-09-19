"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CheckIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFetchQuery } from "@/hooks/use-query";
import { useSubmitMutation } from "@/hooks/use-mutate";
import {
  decideProfileChangeRequest,
  getProfileChangeRequests,
} from "@/server/officeServer/profileChangeServer";

const STATUS_STYLE = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  cancelled: "bg-neutral-100 text-neutral-600",
};

/**
 * The queue, as a list of proposed edits rather than a list of messages.
 *
 * Each row carries the whole decision: who, which field, what it says now, what
 * they say it should be, and why. That is the point of storing these as edits —
 * a reviewer should not have to open a record in another tab to judge one.
 */
export default function ProfileRequestQueue() {
  const [status, setStatus] = useState("pending");

  const queryKey = ["profile-change-requests", status];
  const { data, isLoading } = useFetchQuery({
    fetchFn: getProfileChangeRequests,
    params: { status },
    queryKey,
  });
  const rows = data?.newData || [];

  const { mutate: decide, isPending } = useSubmitMutation({
    mutationFn: async (input) => await decideProfileChangeRequest(input),
    onSuccessMessage: (message) => message || "Saved",
    invalidateKey: ["profile-change-requests"],
    onClose: () => {},
  });

  return (
    <section className="w-full max-w-5xl mx-auto px-2 sm:px-4 py-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle>Change requests</CardTitle>
          <CardDescription className="mt-1">
            Corrections employees have asked for on their own records. Approving
            one writes the value and logs it against the employee.
          </CardDescription>
        </div>
        <Tabs value={status} onValueChange={setStatus}>
          <TabsList>
            <TabsTrigger value="pending">Waiting</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {!isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {status === "pending"
              ? "Nothing waiting. Employees' requests land here."
              : "Nothing here."}
          </CardContent>
        </Card>
      )}

      {rows.map((row) => (
        <Card key={row._id}>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">
                {row.employeeName || "An employee"} — {row.label || row.field}
              </CardTitle>
              <CardDescription>
                Asked {row.createdAt ? format(new Date(row.createdAt), "d MMM yyyy") : ""}
                {row.decidedAt
                  ? ` · decided ${format(new Date(row.decidedAt), "d MMM yyyy")}${
                      row.decidedBy?.name ? ` by ${row.decidedBy.name}` : ""
                    }`
                  : ""}
              </CardDescription>
            </div>
            <Badge
              variant="secondary"
              className={`${STATUS_STYLE[row.status]} capitalize`}
            >
              {row.status}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {row.newValue ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground line-through break-all">
                  {row.oldValue || "—"}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium break-all">{row.newValue}</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No value to apply — they have asked you to deal with this
                directly.
              </p>
            )}

            {row.reason && (
              <p className="text-sm text-muted-foreground border-l-2 pl-3">
                {row.reason}
              </p>
            )}

            {row.decisionNote && (
              <p className="text-sm text-muted-foreground">
                Note: {row.decisionNote}
              </p>
            )}

            {row.status === "pending" && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    decide({ id: row._id, decision: "approved" })
                  }
                >
                  <CheckIcon className="size-4 mr-1.5" />
                  {row.newValue ? "Approve and apply" : "Mark done"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() =>
                    decide({ id: row._id, decision: "rejected" })
                  }
                >
                  <XIcon className="size-4 mr-1.5" />
                  Reject
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
