"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, Mail } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toCsv } from "@/lib/csv";
import { logCsvExport } from "@/server/auditServer/exportAudit";
import {
  getPolicyReaders,
  notifyPolicyReaders,
} from "@/server/policyServer/policyServer";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const STATUS = {
  acknowledged: { label: "Confirmed", variant: "default" },
  opened: { label: "Opened", variant: "secondary" },
  "not-opened": { label: "Not opened", variant: "outline" },
};

/**
 * Who this policy is for, and where each of them has got to with the version
 * in force.
 *
 * The question an inspector asks is "can you show me everyone has read the
 * fire policy?", so the list exports as a CSV — recorded in the audit log,
 * like every other export, because it is a list of named staff.
 */
export default function ReadersPanel({ policy }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["policyReaders", policy._id],
    queryFn: async () => {
      const res = await getPolicyReaders(policy._id);
      if (!res?.success) throw new Error(res?.message);
      return JSON.parse(res.data);
    },
  });

  const rows = useMemo(() => data?.rows || [], [data]);
  const requireAck = !!data?.requireAck;

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    // The same rule as outstandingReaders() on the server.
    const isOutstanding = (row) =>
      requireAck ? row.status !== "acknowledged" : row.status === "not-opened";
    return rows.filter((row) => {
      if (filter === "outstanding" && !isOutstanding(row)) return false;
      if (filter === "done" && isOutstanding(row)) return false;
      return !term || String(row.name).toLowerCase().includes(term);
    });
  }, [rows, filter, search, requireAck]);

  const { mutate: notify, isPending: notifying } = useMutation({
    mutationFn: () => notifyPolicyReaders(policy._id),
    onSuccess: (res) => {
      if (!res?.success) return toast.error(res?.message || "Could not send");
      toast.success(res.message || "Sending");
      queryClient.invalidateQueries({ queryKey: ["policyReaders", policy._id] });
    },
    onError: (err) => toast.error(err?.message || "Could not send"),
  });

  const exportCsv = async () => {
    const csv = toCsv(
      ["Name", "Email", "Status", "First opened", "Confirmed"],
      rows.map((row) => [
        row.name,
        row.email,
        STATUS[row.status].label,
        formatDate(row.firstOpenedAt),
        formatDate(row.acknowledgedAt),
      ]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${policy.title} v${data.versionNumber} readers.csv`.replace(/[\\/:*?"<>|]+/g, "-");
    link.click();
    URL.revokeObjectURL(url);
    await logCsvExport({
      source: "policyReaders",
      label: `readers of policy "${policy.title}" v${data.versionNumber}`,
      rowCount: rows.length,
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="text-sm text-muted-foreground">Could not load the readers.</p>;
  }
  if (!data.visible) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Staff cannot see this policy yet. Choose who can under “Who can see
          it”, and their progress will show here.
        </CardContent>
      </Card>
    );
  }

  const { summary, outstanding } = data;
  const done = data.requireAck ? summary.acknowledged : summary.acknowledged + summary.opened;
  const percent = summary.total ? Math.round((done / summary.total) * 100) : 0;
  const coolingDown = data.notifyCoolingDown;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {done} of {summary.total}
              </p>
              <p className="text-sm text-muted-foreground">
                {data.requireAck
                  ? `have confirmed they read version ${data.versionNumber}`
                  : `have opened version ${data.versionNumber}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
                <Download className="mr-1.5 size-4" />
                Export CSV
              </Button>
              <Button
                onClick={() => notify()}
                disabled={!outstanding || notifying || coolingDown}
                title={coolingDown ? "Staff were emailed in the last day" : undefined}
              >
                <Mail className="mr-1.5 size-4" />
                {outstanding
                  ? `Email the ${outstanding} who ${data.requireAck ? "have not confirmed" : "have not opened it"}`
                  : "Everyone is done"}
              </Button>
            </div>
          </div>

          <div
            className="h-2 overflow-hidden rounded-full bg-neutral-100"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-green-600" style={{ width: `${percent}%` }} />
          </div>

          <p className="text-xs text-muted-foreground">
            {data.requireAck
              ? `${summary.acknowledged} confirmed · ${summary.opened} opened but not confirmed · ${summary.notOpened} not opened`
              : `${summary.acknowledged + summary.opened} opened · ${summary.notOpened} not opened`}
            {data.lastNotifiedAt ? ` · last emailed ${formatDateTime(data.lastNotifiedAt)}` : ""}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {[
            ["all", `Everyone (${rows.length})`],
            ["outstanding", `Outstanding (${outstanding})`],
            ["done", `Done (${done})`],
          ].map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name"
          className="w-full sm:w-56"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nobody here.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>First opened</TableHead>
                  {data.requireAck ? <TableHead>Confirmed</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow key={row.employeeId}>
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.email || "No email address"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS[row.status].variant}>
                        {data.requireAck || row.status !== "acknowledged"
                          ? STATUS[row.status].label
                          : "Opened"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(row.firstOpenedAt) || "—"}
                    </TableCell>
                    {data.requireAck ? (
                      <TableCell className="whitespace-nowrap">
                        {formatDate(row.acknowledgedAt) || "—"}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
