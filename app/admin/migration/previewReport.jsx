"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Info, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * What the file would do, row by row, before anything is written.
 *
 * The order of what is shown is the order somebody needs it in: the counts
 * first, then the reasons rows are being refused, then the rows themselves. A
 * plain table of four hundred rows with a status column would technically
 * contain the same information and would not be read.
 */

const FILTERS = [
  { value: "all", label: "Everything" },
  { value: "error", label: "Problems" },
  { value: "warning", label: "Worth a look" },
  { value: "create", label: "New" },
  { value: "update", label: "Updating" },
  { value: "skip", label: "Already here" },
];

const PAGE = 50;

export default function PreviewReport({
  report,
  statusStyles,
  onCreateDepartments,
}) {
  const [filter, setFilter] = useState(
    report.totals.error ? "error" : "all"
  );
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => {
    if (filter === "all") return report.rows;
    if (filter === "warning") {
      return report.rows.filter(
        (row) => row.status !== "error" && row.warnings.length
      );
    }
    return report.rows.filter((row) => row.status === filter);
  }, [report.rows, filter]);

  const visible = rows.slice(0, shown);

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Count label="Will be added" value={report.totals.create} tone="good" />
        <Count label="Will be updated" value={report.totals.update} />
        <Count label="Already here" value={report.totals.skip} />
        <Count
          label="Cannot import"
          value={report.totals.error}
          tone={report.totals.error ? "bad" : undefined}
        />
      </div>

      {!report.seats?.allowed && (
        <Notice tone="bad" icon={ShieldAlert} title="Not enough seats">
          {report.seats.message}
        </Notice>
      )}

      {report.departments?.missing?.length > 0 && (
        <Notice
          tone={report.departments.willCreate ? "info" : "bad"}
          icon={report.departments.willCreate ? Info : AlertTriangle}
          title={
            report.departments.willCreate
              ? `${report.departments.missing.length} new departments will be created`
              : `${report.departments.missing.length} departments in this file do not exist yet`
          }
          action={
            report.departments.willCreate ? null : (
              <Button size="sm" variant="outline" onClick={onCreateDepartments}>
                Create them
              </Button>
            )
          }
        >
          {report.departments.missing.join(", ")}
        </Notice>
      )}

      {report.leave?.applies && !report.leave.configured && (
        <Notice
          tone="bad"
          icon={CalendarClock}
          title="Leave is not set up, so imported staff will have no entitlement"
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/admin/leaveManagement/setup">Set leave up</Link>
            </Button>
          }
        >
          Annual leave is worked out from each person&apos;s start date against
          your leave year, and that year has not been chosen yet. Set it up first
          and the import builds everyone&apos;s entitlement as it goes — or import
          now and build them all in one press afterwards.
        </Notice>
      )}

      {report.leave?.applies && report.leave.configured && report.totals.create > 0 && (
        <Notice
          tone="info"
          icon={CalendarClock}
          title={`Leave entitlements will be built for ${report.leave.leaveYear}`}
        >
          Each person gets 5.6 weeks × their contracted days a week, pro-rated by
          days if they joined part way through the leave year.
        </Notice>
      )}

      {report.columns?.ignored?.length > 0 && (
        <Notice tone="info" icon={Info} title="Columns that will be ignored">
          {report.columns.ignored.join(", ")}. Nothing in them is imported — this
          app has no field for them.
        </Notice>
      )}

      {report.columns?.duplicated?.length > 0 && (
        <Notice
          tone="info"
          icon={AlertTriangle}
          title="The same field appears twice"
        >
          {report.columns.duplicated.join(", ")}. The first column of each pair
          is used.
        </Notice>
      )}

      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center gap-1.5 border-b p-2">
          {FILTERS.map((option) => {
            const count =
              option.value === "all"
                ? report.totals.rows
                : option.value === "warning"
                  ? report.totals.warnings
                  : report.totals[option.value];
            if (!count && option.value !== "all") return null;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setFilter(option.value);
                  setShown(PAGE);
                }}
                aria-pressed={filter === option.value}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  filter === option.value
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {option.label}
                <span className="ml-1.5 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Line</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-36">What happens</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const style = statusStyles[row.status];
                return (
                  <TableRow key={row.line}>
                    <TableCell className="text-muted-foreground">
                      {row.line}
                    </TableCell>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.email || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={style.variant}>{style.label}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md">
                      {row.errors.length > 0 && (
                        <ul className="space-y-0.5 text-xs text-destructive">
                          {row.errors.map((message, index) => (
                            <li key={index}>{message}</li>
                          ))}
                        </ul>
                      )}
                      {row.warnings.length > 0 && (
                        <ul className="space-y-0.5 text-xs text-muted-foreground">
                          {row.warnings.map((message, index) => (
                            <li key={index}>{message}</li>
                          ))}
                        </ul>
                      )}
                      {!row.errors.length && !row.warnings.length && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {!visible.length && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Nothing in this group.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {rows.length > visible.length && (
          <div className="border-t p-2 text-center">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShown((current) => current + PAGE)}
            >
              Show {Math.min(PAGE, rows.length - visible.length)} more of{" "}
              {rows.length}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function Count({ label, value, tone }) {
  const toneClass =
    tone === "good"
      ? "text-primary"
      : tone === "bad"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-lg border p-3">
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Notice({ tone = "info", icon: Icon, title, children, action }) {
  const toneClass =
    tone === "bad"
      ? "border-destructive/30 bg-destructive/5"
      : "border-muted bg-muted/40";
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${toneClass}`}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">
          {children}
        </p>
      </div>
      {action}
    </div>
  );
}
