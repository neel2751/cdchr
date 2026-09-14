"use client";

import React from "react";
import { differenceInCalendarDays, isPast } from "date-fns";
import { Status } from "@/components/tableStatus/status";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import LeaveRequestStatus from "./request-status";

/**
 * The status cell for a leave request, shared by the request table, the
 * overlapping requests listed underneath a row, and the history table.
 *
 * A status is only ever rendered as what it actually is. The overlap and
 * history lists used to hard-code "Rejected" for any request whose first day had
 * passed, so approved leave that had already been taken read as rejected. Having
 * one cell rather than a copy per table is what stops that drifting apart again.
 */
export const LeaveStatusCell = ({ leave, queryKey, canReview }) => {
  const isPending = leave?.leaveStatus === "Pending";

  if (!isPending || !canReview) {
    return <Status title={leave?.leaveStatus ?? "Unknown"} />;
  }

  // Still pending on a day that has already passed: there is nothing left to
  // approve, so it reads as expired rather than offering the controls.
  if (leave?.leaveStartDate && isPast(new Date(leave.leaveStartDate))) {
    return <Status title="Expired" />;
  }

  return (
    <LeaveRequestStatus
      leaveId={leave?._id}
      invalidateKey={queryKey}
      allowAccept={true}
      allowReject={true}
    />
  );
};

/**
 * How much warning the employee gave, counted in whole days from the submit
 * date to the first day of leave.
 *
 * A record entered after the leave was taken has no notice to report — it used
 * to show as a negative day count, which read as a data error rather than as
 * what it is: leave logged retrospectively.
 */
export const NoticeGiven = ({ leaveStartDate, leaveSubmitDate }) => {
  if (!leaveStartDate || !leaveSubmitDate) return "-";

  const days = differenceInCalendarDays(
    new Date(leaveStartDate),
    new Date(leaveSubmitDate)
  );

  if (days < 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="bg-stone-100 text-stone-700 whitespace-nowrap shadow-none">
            Backdated
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Logged {Math.abs(days)} day(s) after the leave started</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (days === 0) return "Same day";

  return `${days} day${days === 1 ? "" : "s"}`;
};
