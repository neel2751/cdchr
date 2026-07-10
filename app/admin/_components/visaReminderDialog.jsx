"use client";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { Loader2, Mail } from "lucide-react";
import {
  daysUntil,
  getMilestone,
  formatVisaRemaining,
} from "@/lib/visaMilestones";
import { getVisaReminderCount } from "@/server/visaServer/visaServer";

/**
 * Confirmation dialog for sending a visa-expiry reminder. Shows the employee,
 * the actual visa expiry date and the current milestone, and lets the admin
 * opt to send a copy to HR for the record.
 *
 * @param {{ target: {employeeId,employeeType,name,visaEndDate}|null,
 *           onOpenChange: (open:boolean)=>void,
 *           onConfirm: (ccHr:boolean)=>void,
 *           isPending: boolean }} props
 */
const VisaReminderDialog = ({ target, onOpenChange, onConfirm, isPending }) => {
  const [ccHr, setCcHr] = useState(false);
  const [countInfo, setCountInfo] = useState(null);
  const open = Boolean(target);

  useEffect(() => {
    if (open) setCcHr(false);
  }, [open, target?.employeeId]);

  // Load how many times this reminder has already been sent so HR gets a
  // pre-send warning and we can block once the limit is reached.
  useEffect(() => {
    if (!open || !target?.employeeId) {
      setCountInfo(null);
      return;
    }
    let active = true;
    getVisaReminderCount({
      employeeId: target.employeeId,
      employeeType: target.employeeType,
    }).then((res) => {
      if (active) setCountInfo(res?.success ? res : null);
    });
    return () => {
      active = false;
    };
  }, [open, target?.employeeId, target?.employeeType]);

  const limitReached = Boolean(countInfo && countInfo.remaining <= 0);

  const milestone = target?.visaEndDate
    ? getMilestone(daysUntil(target.visaEndDate))
    : null;
  const prettyDate = target?.visaEndDate
    ? format(new Date(target.visaEndDate), "PPP")
    : "—";
  // Actual time remaining (e.g. "1 month 5 days" / "1 year 3 months"), not the
  // coarse milestone bucket.
  const remaining = target?.visaEndDate
    ? formatVisaRemaining(target.visaEndDate)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send visa reminder</DialogTitle>
          <DialogDescription>
            An email will be sent to the employee.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">Employee</span>
            <span className="font-medium text-right">{target?.name || "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">Visa expiry date</span>
            <span className="font-medium text-right">{prettyDate}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">Expires in</span>
            <span className="font-medium text-right">{remaining || "—"}</span>
          </div>
          {countInfo && (
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Sent so far</span>
              <span className="font-medium text-right">
                {countInfo.sentCount} of {countInfo.maxSends}
              </span>
            </div>
          )}
          {countInfo && countInfo.sentCount > 0 && (
            <p
              className={`text-xs ${
                limitReached ? "text-rose-600" : "text-amber-600"
              }`}
            >
              {limitReached
                ? `You have reached the maximum of ${countInfo.maxSends} sends for this reminder.`
                : `Already sent ${countInfo.sentCount} time${
                    countInfo.sentCount === 1 ? "" : "s"
                  } — ${countInfo.remaining} left.`}
            </p>
          )}

          <label className="mt-3 flex items-center gap-2 cursor-pointer pt-2">
            <Checkbox
              checked={ccHr}
              onCheckedChange={(v) => setCcHr(Boolean(v))}
            />
            <span>Send a copy to HR (for records)</span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(ccHr)}
            disabled={isPending || !milestone || limitReached}
          >
            {isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Mail />
            )}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VisaReminderDialog;
