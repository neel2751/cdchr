"use client";

import React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Status } from "@/components/tableStatus/status";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { differenceInCalendarDays, format } from "date-fns";
import { DownloadIcon, EyeIcon, FileTextIcon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { generateDownloadUrl } from "@/server/aws/upload";
import { LeaveRollbackDialog } from "./leave-rollback";

const safeDate = (value, pattern = "PPP") => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : format(date, pattern);
};

const Row = ({ label, children }) => (
  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
    <dt className="min-w-44 text-sm text-muted-foreground">{label}</dt>
    <dd className="text-sm font-medium text-neutral-900">{children ?? "-"}</dd>
  </div>
);

const Section = ({ title, children }) => (
  <div className="space-y-3">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
      {title}
    </h3>
    <dl className="space-y-2">{children}</dl>
  </div>
);

/** Opens the sick note in a new tab through a short-lived signed URL. */
function SickNoteLink({ sickNote }) {
  const [isLoading, setIsLoading] = React.useState(false);

  const handleOpen = async () => {
    setIsLoading(true);
    try {
      const response = await generateDownloadUrl({ key: sickNote.key });
      if (response?.success && response?.url) {
        window.open(response.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error(response?.message || "Could not open the sick note");
      }
    } catch (error) {
      toast.error("Could not open the sick note");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleOpen}
      disabled={isLoading}
      className="gap-2"
    >
      <FileTextIcon className="h-4 w-4 text-indigo-600" />
      <span className="max-w-52 truncate">
        {sickNote.fileName || "Sick note"}
      </span>
      <DownloadIcon className="h-3.5 w-3.5" />
    </Button>
  );
}

/**
 * Read-only view of a single leave request, opened from the table's action
 * column. Shows everything the row has to truncate — every booked date, the
 * approval trail, the sick note and any rollback — and is where a super admin
 * reverses an approved leave.
 */
export function LeaveDetailsSheet({ item, queryKey, isSuperAdmin }) {
  const [open, setOpen] = React.useState(false);

  const leaveDates = item?.leaveDates || [];
  const overlaps = item?.overlappingRequests || [];
  const noticeDays =
    item?.leaveStartDate && item?.leaveSubmitDate
      ? differenceInCalendarDays(
          new Date(item.leaveStartDate),
          new Date(item.leaveSubmitDate)
        )
      : null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            className="hover:bg-slate-100 hover:border-slate-600"
            onClick={() => setOpen(true)}
          >
            <EyeIcon className="text-slate-700" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>View leave details</p>
        </TooltipContent>
      </Tooltip>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-xl p-0">
          <SheetHeader className="p-6 pb-4">
            <SheetTitle className="flex items-center gap-3">
              <span>{item?.employee?.name || "Leave request"}</span>
              <Status title={item?.leaveStatus ?? "Unknown"} />
            </SheetTitle>
            <SheetDescription>
              {item?.isHalfDay ? "Half day" : item?.leaveType}
              {item?.leaveDays ? ` · ${item.leaveDays} day(s)` : ""}
              {item?.leaveYear ? ` · Leave year ${item.leaveYear}` : ""}
            </SheetDescription>
          </SheetHeader>
          <Separator />

          <ScrollArea className="h-[calc(100vh-9rem)]">
            <div className="space-y-6 p-6">
              <Section title="Request">
                <Row label="Leave type">{item?.leaveType}</Row>
                {item?.isHalfDay && (
                  <Row label="Half day">{item?.halfDayType || "Half Day"}</Row>
                )}
                <Row label="Total days">{item?.leaveDays} day(s)</Row>
                <Row label="Paid">{item?.isPaid ? "Paid" : "Unpaid"}</Row>
                <Row label="Submitted on">
                  {safeDate(item?.leaveSubmitDate)}
                </Row>
                <Row label="Notice given">
                  {noticeDays === null
                    ? null
                    : noticeDays < 0
                      ? `Backdated — logged ${Math.abs(noticeDays)} day(s) after the leave started`
                      : noticeDays === 0
                        ? "Same day as the first day of leave"
                        : `${noticeDays} day(s) before the first day`}
                </Row>
                <Row label="First day">{safeDate(item?.leaveStartDate)}</Row>
                <Row label="Last day">{safeDate(item?.leaveEndDate)}</Row>
                <Row label="Added by admin">
                  {item?.addByAdmin ? "Yes" : "No"}
                </Row>
                <Row label="Employee reason">{item?.leaveReason}</Row>
              </Section>

              <Separator />

              <Section title={`Booked dates (${leaveDates.length})`}>
                {leaveDates.length ? (
                  <div className="flex flex-wrap gap-2">
                    {leaveDates.map((date, index) => (
                      <Badge
                        key={index}
                        variant="outline"
                        className="font-normal"
                      >
                        {safeDate(date, "EEE, dd MMM yyyy")}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No individual dates recorded.
                  </p>
                )}
              </Section>

              <Separator />

              <Section title="Decision">
                <Row label="Status">
                  <Status title={item?.leaveStatus ?? "Unknown"} />
                </Row>
                <Row label="Actioned by">{item?.approvedBy?.name}</Row>
                <Row label="Actioned on">{safeDate(item?.approvedDate)}</Row>
                <Row label="Admin comment">{item?.adminComment}</Row>
              </Section>

              {item?.leaveBreakdown?.length > 0 && (
                <>
                  <Separator />
                  <Section title="Balance breakdown">
                    {item.leaveBreakdown.map((entry, index) => (
                      <Row key={index} label={entry.leaveType}>
                        {entry.leaveDays} day(s) · {entry.leaveYear}
                      </Row>
                    ))}
                  </Section>
                </>
              )}

              {item?.sickNote?.key && (
                <>
                  <Separator />
                  <Section title="Sick note">
                    <Row label="Uploaded on">
                      {safeDate(item.sickNote.uploadedAt)}
                    </Row>
                    <div className="pt-1">
                      <SickNoteLink sickNote={item.sickNote} />
                    </div>
                  </Section>
                </>
              )}

              {item?.rollback?.rolledBackAt && (
                <>
                  <Separator />
                  <Section title="Rollback">
                    <Row label="Rolled back on">
                      {safeDate(item.rollback.rolledBackAt, "PPP p")}
                    </Row>
                    <Row label="Previous status">
                      {item.rollback.previousStatus}
                    </Row>
                    <Row label="Days returned">
                      {item.rollback.restoredDays} day(s) to{" "}
                      {item.rollback.restoredLeaveType}
                    </Row>
                    <Row label="Reason">{item.rollback.reason}</Row>
                  </Section>
                </>
              )}

              <Separator />

              <Section title={`Overlapping leave (${overlaps.length})`}>
                {overlaps.length ? (
                  <div className="space-y-2">
                    {overlaps.map((overlap, index) => (
                      <div
                        key={index}
                        className="rounded-lg border p-3 text-sm space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {overlap.employeeName}
                          </span>
                          <Badge className="bg-indigo-600 text-white">
                            {overlap.overLappingDays} day(s)
                          </Badge>
                        </div>
                        <p className="text-muted-foreground">
                          {overlap.leaveType} · {overlap.leaveStatus} ·{" "}
                          {safeDate(overlap.leaveStartDate, "dd MMM")} –{" "}
                          {safeDate(overlap.leaveEndDate, "dd MMM yyyy")}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nobody else is off on these days.
                  </p>
                )}
              </Section>

              {isSuperAdmin && item?.leaveStatus === "Approved" && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                      Super admin
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Rolling back keeps this request in the history and returns{" "}
                      {item?.leaveDays} day(s) to {item?.leaveType}. A reason is
                      required.
                    </p>
                    <LeaveRollbackDialog
                      item={item}
                      invalidateKey={queryKey}
                      trigger={
                        <Button
                          variant="outline"
                          className="gap-2 border-orange-600 text-orange-700 hover:bg-orange-50"
                        >
                          <Undo2Icon className="h-4 w-4" />
                          Roll back approval
                        </Button>
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default LeaveDetailsSheet;
