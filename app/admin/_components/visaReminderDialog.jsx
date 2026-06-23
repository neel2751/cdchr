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
import { daysUntil, getMilestone, milestoneLabel } from "@/lib/visaMilestones";

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
  const open = Boolean(target);

  useEffect(() => {
    if (open) setCcHr(false);
  }, [open, target?.employeeId]);

  const milestone = target?.visaEndDate
    ? getMilestone(daysUntil(target.visaEndDate))
    : null;
  const prettyDate = target?.visaEndDate
    ? format(new Date(target.visaEndDate), "PPP")
    : "—";

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
            <span className="text-gray-500">Reminder</span>
            <span className="font-medium text-right">
              {milestone ? milestoneLabel(milestone) : "—"}
            </span>
          </div>

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
          <Button onClick={() => onConfirm(ccHr)} disabled={isPending || !milestone}>
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
