"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EditIcon, SaveIcon, TriangleAlert, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { editCommonLeave } from "@/server/leaveServer/getLeaveServer";
import {
  isBelowStatutory,
  useEntitlementBounds,
} from "./useEntitlementBounds";

/**
 * Change one employee's allowance for one leave type.
 *
 * HOW IT WORKS. The figure is nudged with a stepper (leave-total-input.jsx), and
 * Save opens this dialog, which will not let go until a reason has been given.
 * When the new figure is below what the employee is actually entitled to —
 * annual leave only, worked out from their own start date and contracted week —
 * the dialog says so *before* the save rather than after, and asks for that to
 * be acknowledged as well.
 *
 * WHY A REASON EVERY TIME. The leave history already records who, when, and from
 * what to what. "Why" is the only part that cannot be reconstructed later, and
 * it is the only part anybody ever asks about. The quick options exist because a
 * mandatory free-text box collects "adjustment" and ".": offering the five real
 * answers as one click is what keeps the record worth having.
 *
 * WHAT WAS WRONG BEFORE. `onSubmit` read a bare `value` that was never a prop —
 * the parent held it in state and passed only `setValue` — so Save threw
 * `ReferenceError: value is not defined` on the first click, and
 * `editCommonLeave` was never imported either. Neither shows up in lint, because
 * `no-undef` is off for JSX files. That is what the "*This feature under
 * development" note in the sheet footer was standing in for.
 *
 * Uses `useMutation` directly rather than `useSubmitMutation` because the server
 * has a third answer besides done and failed — `requiresConfirmation`, which
 * that hook would throw as an error.
 */

/**
 * The reasons an allowance actually changes, as one-click options.
 *
 * Deliberately short and deliberately specific. A longer list becomes a menu
 * nobody reads, and a vaguer one ("Other", "Adjustment") defeats the point.
 */
const COMMON_REASONS = [
  "Contract change — hours or days per week",
  "Carry-forward from the previous leave year",
  "Correcting an earlier mistake",
  "Leaver — pro-rated to their last day",
  "Additional days at company discretion",
];

const MIN_REASON = 5;

export default function LeaveEdit({
  initialValues,
  entitlement,
  item,
  onEdit,
  queryKey,
  value,
  setValue,
  setInitialValues,
}) {
  const queryClient = useQueryClient();

  const [asking, setAsking] = React.useState(false);
  const [reason, setReason] = React.useState("");
  // Set only when the server disagrees with what this screen worked out — a
  // backstop, not the normal path.
  const [serverFloor, setServerFloor] = React.useState(null);

  const bounds = useEntitlementBounds({
    entitlement,
    employee: item,
    leaveYear: item?.leaveYear,
  });

  const done = () => {
    setAsking(false);
    setReason("");
    setServerFloor(null);
    setValue(null);
    setInitialValues(null);
  };

  const { mutate: updateLeave, isPending } = useMutation({
    mutationFn: async ({ newValue, acknowledgement }) =>
      await editCommonLeave({
        value: newValue,
        reason: reason.trim(),
        initialValues,
        acknowledgement,
      }),
    onSuccess: (response) => {
      // The screen and the server disagreed about the floor — it knows the
      // employee record better than the row this table projected. Show what it
      // said and let the same dialog ask again.
      if (response?.requiresConfirmation) {
        setServerFloor(response);
        setAsking(true);
        return;
      }
      if (!response?.success) {
        toast.error(response?.message || "Could not change the allowance");
        return;
      }
      queryClient.invalidateQueries({
        queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
      });
      toast.success(response.message);
      done();
    },
    onError: (error) => {
      toast.error(error?.message || "Could not change the allowance");
    },
  });

  const proposed = value === "" || value === null ? null : Number(value);
  const belowStatutory =
    proposed !== null &&
    (serverFloor ? true : isBelowStatutory(proposed, bounds.statutory));
  const statutory = serverFloor?.statutory ?? bounds.statutory;

  /** Everything that can be checked without the server, so the dialog opens clean. */
  function openDialog() {
    // An empty box is not zero. Number("") is 0, and zero is a real allowance
    // meaning "none" — so blank has to be rejected as blank.
    if (proposed === null) {
      return toast.warning(`Enter a number of ${bounds.unit}`);
    }
    if (!Number.isFinite(proposed) || !Number.isInteger(proposed)) {
      return toast.warning("Whole numbers only");
    }
    if (proposed < bounds.min) {
      return toast.warning(
        bounds.used > 0
          ? `Cannot go below the ${bounds.used} ${bounds.unit} already taken`
          : "Cannot be negative"
      );
    }
    if (proposed > bounds.max) {
      return toast.warning(
        `${entitlement?.leaveType} cannot be set above ${bounds.max} ${bounds.unit}`
      );
    }
    if (proposed === Number(entitlement?.total)) {
      return toast.info("That is already the allowance");
    }
    setAsking(true);
  }

  const editing = initialValues?.leaveType === entitlement?.leaveType;
  const reasonTooShort = reason.trim().length < MIN_REASON;

  return (
    <>
      {editing ? (
        <div className="space-x-2">
          <Button
            size="icon"
            variant="outline"
            onClick={openDialog}
            disabled={isPending}
            aria-label={`Save ${entitlement?.leaveType}`}
          >
            <SaveIcon />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={done}
            disabled={isPending}
            aria-label="Cancel"
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <Button
          size="icon"
          variant="outline"
          onClick={() => onEdit(entitlement, item)}
          aria-label={`Edit ${entitlement?.leaveType}`}
          disabled={
            isPending ||
            // Statutory figures, not company allowances: these three come from
            // the law and from the employee's own contract, so they are not an
            // admin's number to change here.
            entitlement?.leaveType === "Maternity Leave" ||
            entitlement?.leaveType === "Paternity Leave" ||
            entitlement?.leaveType === "Sick Leave"
          }
        >
          <EditIcon />
        </Button>
      )}

      <Dialog
        open={asking}
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setAsking(false);
            setServerFloor(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {entitlement?.leaveType}: {entitlement?.total} → {proposed}{" "}
              {bounds.unit}
            </DialogTitle>
            <DialogDescription>
              {item?.name
                ? `Changing ${item.name}'s allowance for ${item?.leaveYear}.`
                : `Changing this allowance for ${item?.leaveYear}.`}{" "}
              The change and your reason are both recorded under History.
            </DialogDescription>
          </DialogHeader>

          {belowStatutory && statutory !== null && (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="text-sm">
                <p className="font-medium">
                  {proposed === 0
                    ? "This leaves them with no annual leave at all"
                    : `This is below their entitlement of ${statutory} ${bounds.unit}`}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Annual leave is a statutory minimum — 5.6 weeks × their
                  contracted week, pro-rated by the days they are employed this
                  leave year. There are good reasons to go under it, and it is
                  recorded as a deliberate decision either way.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="entitlement-reason">
              Why is it changing?{" "}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>

            <div className="flex flex-wrap gap-1.5">
              {COMMON_REASONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setReason(option)}
                  aria-pressed={reason === option}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    reason === option
                      ? "border-primary/40 bg-primary/10 font-medium"
                      : "hover:bg-muted"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>

            <Textarea
              id="entitlement-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Pick one above, or write your own"
              rows={3}
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setAsking(false);
                setServerFloor(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              className={belowStatutory ? "bg-amber-600 hover:bg-amber-700" : ""}
              // The server enforces this too — there is just no reason to make
              // somebody press a button to be told.
              disabled={isPending || reasonTooShort}
              onClick={() =>
                updateLeave({
                  newValue: proposed,
                  // Only ever sent when this screen has actually shown the
                  // warning above. A caller that has not seen it gets the
                  // server's question instead.
                  acknowledgement: belowStatutory
                    ? { confirmed: true }
                    : undefined,
                })
              }
            >
              {isPending
                ? "Saving..."
                : belowStatutory
                  ? `Set to ${proposed} anyway`
                  : "Save change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
