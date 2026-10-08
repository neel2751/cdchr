"use client";

import { format } from "date-fns";
import {
  CalendarCheck,
  CalendarDays,
  Clock3,
  TentTree,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { leaveTone } from "./leaveTone";

/**
 * One booked absence, in full.
 *
 * Replaces a nest of `<dl><dt><ul><li>` per field, each row carrying
 * `after:content-[',']` — which printed a stray comma after every value
 * ("Submitted On: 3 June 2026 ,"). A definition list is the right element for
 * label/value pairs; it just does not need four more elements inside each cell.
 *
 * The leave dates used to be printed as one comma-joined run, so a three-week
 * absence filled the dialog with twenty-one dates. They are summarised as a
 * range with the day count, and only listed when the dates are not contiguous —
 * which is the case where seeing them actually tells you something.
 */

/** A row of the definition list. */
function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="flex min-w-[9.5rem] items-center gap-1.5 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** Whether every date is one after the next, so a range describes them all. */
function isContiguous(dates) {
  if (dates.length < 2) return true;
  const days = dates
    .map((date) => new Date(date).setUTCHours(0, 0, 0, 0))
    .sort((a, b) => a - b);
  const DAY = 24 * 60 * 60 * 1000;
  return days.every(
    (day, index) => index === 0 || day - days[index - 1] === DAY
  );
}

export default function LeaveDetail({ leave }) {
  const tone = leaveTone(leave.leaveType);
  const dates = Array.isArray(leave.leaveDates) ? [...leave.leaveDates] : [];
  const sorted = dates.sort((a, b) => new Date(a) - new Date(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const contiguous = isContiguous(sorted);

  return (
    <dl className="space-y-3">
      <Row icon={TentTree} label="Leave type">
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${tone.dot}`} />
          {leave.leaveType}
        </span>
      </Row>

      <Row icon={CalendarDays} label="Dates">
        {sorted.length === 0 ? (
          "—"
        ) : sorted.length === 1 ? (
          format(new Date(first), "EEEE d MMMM yyyy")
        ) : (
          <>
            {format(new Date(first), "d MMM")} – {format(new Date(last), "d MMM yyyy")}
            <span className="ml-1.5 font-normal text-muted-foreground">
              ({sorted.length} day{sorted.length === 1 ? "" : "s"})
            </span>
            {/* Only listed when a range would be misleading. A contiguous
                three-week absence does not need twenty-one dates printed. */}
            {!contiguous && (
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {sorted.map((date) => format(new Date(date), "d MMM")).join(" · ")}
              </span>
            )}
          </>
        )}
      </Row>

      {leave.isHalfDay && (
        <Row icon={Clock3} label="Half day">
          {leave.halfDayType || "Half day"}
        </Row>
      )}

      <Row icon={Wallet} label="Paid">
        {leave.isPaid === false ? "Unpaid" : "Paid"}
      </Row>

      <Row icon={CalendarCheck} label="Requested on">
        {leave.leaveSubmitDate
          ? format(new Date(leave.leaveSubmitDate), "d MMMM yyyy")
          : "—"}
      </Row>

      <Row icon={CalendarCheck} label="Status">
        <Badge variant="secondary">{leave.status || "Approved"}</Badge>
      </Row>
    </dl>
  );
}
