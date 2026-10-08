"use client";

import React from "react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LeaveDetail from "./leaveDetail";
import { leaveTone } from "./leaveTone";

/**
 * One day of the planner.
 *
 * WHAT WAS BREAKING. The cell had a `min-h` and an unbounded list of chips, so a
 * day with six people off grew taller than its neighbours and pushed that whole
 * week out of line — the grid stopped being a grid exactly when the month was
 * busy enough to need reading. Now a fixed number of chips are shown and the
 * rest collapse into "+3 more", which opens the day.
 *
 * Each chip also used to read `{employeeName} - {leaveType}` truncated inside a
 * ninety-pixel cell, so every one of them said "Anita Pa…". The name is the part
 * that identifies the row, so the name gets the space and the leave type is a
 * coloured bar down the side plus a dot — legible at a glance, and the full text
 * is in the title and the dialog.
 */

/** How many fit before the grid starts to distort. */
const VISIBLE_CHIPS = 3;

/** A half day is half the person's absence, so it reads as half a block. */
function HalfDayMark({ halfDayType }) {
  return (
    <span
      className="ml-1 shrink-0 text-[10px] font-semibold opacity-70"
      title={halfDayType || "Half day"}
    >
      ½
    </span>
  );
}

function LeaveChip({ leave, onOpen }) {
  const tone = leaveTone(leave.leaveType);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${leave.employeeName} — ${leave.leaveType}${
        leave.isHalfDay ? ` (${leave.halfDayType || "half day"})` : ""
      }`}
      className={`flex w-full items-center rounded-sm border-l-[3px] px-1.5 py-0.5 text-left text-[11px] leading-tight transition hover:brightness-95 ${tone.chip}`}
    >
      <span className="min-w-0 flex-1 truncate font-medium">
        {leave.employeeName || "Unknown"}
      </span>
      {leave.isHalfDay && <HalfDayMark halfDayType={leave.halfDayType} />}
    </button>
  );
}

export default function PlannerDay({
  date,
  leaves,
  isToday,
  isWeekend,
  isOutsideMonth,
  bankHoliday,
  observesBankHolidays,
}) {
  const [openLeave, setOpenLeave] = React.useState(null);
  const [showDay, setShowDay] = React.useState(false);

  const visible = leaves.slice(0, VISIBLE_CHIPS);
  const hidden = leaves.length - visible.length;

  return (
    <>
      <div
        className={`flex h-[128px] flex-col gap-1 rounded-lg border p-1.5 ${
          isOutsideMonth
            ? // Shown rather than left blank so the grid is always six rows and
              // the page does not jump height between months.
              "border-dashed bg-muted/20"
            : bankHoliday
              ? "border-indigo-200 bg-indigo-50/50"
              : isWeekend
                ? "bg-muted/40"
                : "bg-background"
        }`}
      >
        <div className="flex items-start justify-between gap-1">
          <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              isToday
                ? "bg-indigo-600 text-white"
                : isOutsideMonth
                  ? "text-muted-foreground/50"
                  : "text-foreground"
            }`}
          >
            {date.getDate()}
          </span>

          {/* The count, so a busy day is obvious without counting chips. */}
          {leaves.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDay(true)}
              className="shrink-0 rounded-full bg-foreground/5 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground hover:bg-foreground/10"
              title={`${leaves.length} off — open the day`}
            >
              {leaves.length}
            </button>
          )}
        </div>

        {bankHoliday && (
          <p
            className="truncate text-[10px] font-medium leading-tight text-indigo-700"
            title={
              observesBankHolidays
                ? `${bankHoliday} — the company is closed`
                : `${bankHoliday} — the company works this day`
            }
          >
            {observesBankHolidays ? bankHoliday : `${bankHoliday} (working)`}
          </p>
        )}

        <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
          {visible.map((leave, index) => (
            <LeaveChip
              key={`${leave.employeeId}-${leave.leaveType}-${index}`}
              leave={leave}
              onOpen={() => setOpenLeave(leave)}
            />
          ))}

          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowDay(true)}
              className="w-full rounded-sm px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted"
            >
              +{hidden} more
            </button>
          )}
        </div>
      </div>

      {/* One absence, in full. */}
      <Dialog
        open={Boolean(openLeave)}
        onOpenChange={(open) => !open && setOpenLeave(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{openLeave?.employeeName}</DialogTitle>
            <DialogDescription>
              {openLeave?.leaveType} · {format(date, "EEEE d MMMM yyyy")}
            </DialogDescription>
          </DialogHeader>
          {openLeave && <LeaveDetail leave={openLeave} />}
        </DialogContent>
      </Dialog>

      {/* Everyone off on this day — what "+3 more" and the count open. */}
      <Dialog open={showDay} onOpenChange={setShowDay}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{format(date, "EEEE d MMMM yyyy")}</DialogTitle>
            <DialogDescription>
              {leaves.length} {leaves.length === 1 ? "person is" : "people are"}{" "}
              off{bankHoliday ? ` · ${bankHoliday}` : ""}
            </DialogDescription>
          </DialogHeader>

          <ul className="max-h-[22rem] divide-y overflow-y-auto">
            {leaves.map((leave, index) => {
              const tone = leaveTone(leave.leaveType);
              return (
                <li
                  key={`${leave.employeeId}-${leave.leaveType}-${index}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {leave.employeeName || "Unknown"}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={`size-2 rounded-full ${tone.dot}`} />
                      {leave.leaveType}
                      {leave.isHalfDay &&
                        ` · ${leave.halfDayType || "half day"}`}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className="shrink-0 cursor-pointer"
                    onClick={() => {
                      setShowDay(false);
                      setOpenLeave(leave);
                    }}
                  >
                    Details
                  </Badge>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
