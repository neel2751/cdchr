"use client";

import React from "react";
import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { rollbackLeaveRequest } from "@/server/leaveServer/getLeaveServer";
import { Undo2Icon } from "lucide-react";
import { format } from "date-fns";

// A reason is not optional — the server refuses a rollback without one, and the
// form says so up front rather than letting the request bounce back.
const rollbackFields = [
  {
    name: "reason",
    labelText: "Reason for rollback",
    type: "textarea",
    size: true,
    placeholder: "Explain why this approved leave is being reversed",
    validationOptions: {
      required: "A reason is required to roll back this leave",
      validate: (value) =>
        (value || "").trim().length >= 5 ||
        "Please give a little more detail (at least 5 characters)",
    },
  },
];

/**
 * Super-admin only. Reverses an approved leave without deleting it: the request
 * stays in the list as "Rolled Back" and the days go back to the balance.
 */
export function LeaveRollbackDialog({ item, invalidateKey, trigger }) {
  const [open, setOpen] = React.useState(false);

  const { mutate: rollback, isPending } = useSubmitMutation({
    mutationFn: async ({ reason }) =>
      rollbackLeaveRequest({ leaveId: item?._id, reason }),
    invalidateKey,
    onSuccessMessage: (message) => message || "Leave rolled back",
    onClose: () => setOpen(false),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="hover:bg-orange-100 hover:border-orange-600"
              >
                <Undo2Icon className="text-orange-600" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Roll back this approved leave</p>
            </TooltipContent>
          </Tooltip>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Roll back approved leave</DialogTitle>
          <DialogDescription>
            {item?.employee?.name ? `${item.employee.name} — ` : ""}
            {item?.leaveDays} day(s) of {item?.leaveType}
            {item?.leaveStartDate
              ? ` from ${format(new Date(item.leaveStartDate), "PPP")}`
              : ""}
            . The request is kept and marked as rolled back, and the days are
            returned to the balance.
          </DialogDescription>
        </DialogHeader>
        <GlobalForm
          fields={rollbackFields}
          btnName="Roll back"
          isLoading={isPending}
          onSubmit={(data) => rollback(data)}
          btnProps={{ className: "bg-orange-600 hover:bg-orange-700" }}
        />
      </DialogContent>
    </Dialog>
  );
}

export default LeaveRollbackDialog;
