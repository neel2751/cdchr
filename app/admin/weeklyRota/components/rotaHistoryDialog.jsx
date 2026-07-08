"use client";

import React, { useState } from "react";
import { format } from "date-fns";
import { History, Loader2, User, Clock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetchQuery } from "@/hooks/use-query";
import { getWeeklyRotaVersions } from "@/server/weeklyRotaServer/weeklyRotaServer";

const changeTypeStyles = {
  created: "text-emerald-600",
  updated: "text-indigo-600",
  restored: "text-amber-600",
};

// Render a single day cell the same way the CSV export reads it.
function formatCell(entry) {
  if (!entry) return "";
  const { category, startTime, endTime, site } = entry;
  if (category === "OFF" || category === "Holiday") return "OFF";
  if (category === "OFFICE/SITE") {
    return `${category}${site ? " - " + site : ""} (${startTime}–${endTime})`;
  }
  if (!category) return "";
  return `${category} (${startTime}–${endTime})`;
}

function SnapshotTable({ attendanceData = [] }) {
  if (!attendanceData.length) {
    return (
      <p className="text-sm text-neutral-500 py-2">No schedule in this version.</p>
    );
  }
  // Build the day columns from the first employee's schedule.
  const dates = (attendanceData[0]?.schedule || []).map((s) => s.date);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            {dates.map((date) => (
              <TableHead key={date} className="whitespace-nowrap">
                {format(new Date(date), "EEE dd/MM")}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {attendanceData.map((emp) => (
            <TableRow key={emp.employeeId || emp.employeeName}>
              <TableCell className="font-medium">{emp.employeeName}</TableCell>
              {dates.map((date) => {
                const entry = (emp.schedule || []).find((s) => s.date === date);
                return (
                  <TableCell key={date} className="whitespace-nowrap text-xs">
                    {formatCell(entry)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function VersionRow({ version }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-none p-0 font-semibold">
              v{version.version}
            </Badge>
            <span
              className={`text-xs font-medium capitalize ${
                changeTypeStyles[version.changeType] || "text-neutral-600"
              }`}
            >
              {version.changeType}
            </span>
            {version.summary && (
              <span className="text-xs text-neutral-500">
                · {version.summary}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              {version.changedByName || "—"}
              {version.changedByRole ? ` (${version.changedByRole})` : ""}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {version.createdAt
                ? format(new Date(version.createdAt), "PPP p")
                : "—"}
            </span>
          </div>
          {version.reason && (
            <p className="text-xs text-neutral-700">
              <span className="font-medium">Reason:</span> {version.reason}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
          {open ? "Hide" : "View"}
        </Button>
      </div>
      {open && (
        <div className="border-t p-3">
          <SnapshotTable attendanceData={version.attendanceData} />
        </div>
      )}
    </div>
  );
}

export default function RotaHistoryDialog({ rotaId, weekStartDate }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useFetchQuery({
    params: { rotaId, page: 1, pageSize: 50 },
    queryKey: ["weeklyRotaVersions", { rotaId }],
    fetchFn: getWeeklyRotaVersions,
    enabled: open && !!rotaId,
  });

  const { newData: versions = [], totalCount } = data || {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          title="View change history"
          className="text-sm text-indigo-600 hover:text-indigo-600 hover:bg-indigo-100"
        >
          <History />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rota change history</DialogTitle>
          <DialogDescription>
            {weekStartDate
              ? `Week of ${format(new Date(weekStartDate), "MMMM d, yyyy")} — `
              : ""}
            every version of this rota, who changed it and why.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
          </div>
        ) : versions.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            No version history recorded yet.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-neutral-500">
              {totalCount} version{totalCount === 1 ? "" : "s"}
            </p>
            {versions.map((v) => (
              <VersionRow key={v._id} version={v} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
