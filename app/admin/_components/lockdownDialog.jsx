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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

/**
 * Confirmation dialog for an emergency account lockdown. Deactivates the
 * account and terminates its sessions. Requires a mandatory reason (audited).
 */
const LockdownDialog = ({ target, onOpenChange, onConfirm, isPending }) => {
  const open = Boolean(target);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open, target?._id]);

  const displayName =
    target?.name ||
    [target?.firstName, target?.lastName].filter(Boolean).join(" ") ||
    "—";

  const handleConfirm = () => {
    if (!reason.trim()) {
      return toast.warning("Please provide a reason for the lockdown");
    }
    onConfirm({ reason: reason.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600">
            <ShieldAlert className="h-5 w-5" /> Emergency lockdown
          </DialogTitle>
          <DialogDescription>
            This immediately deactivates the account, blocks new logins and
            terminates active sessions on the next request. Recorded in the audit
            log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-gray-500">Account</span>
            <span className="font-medium text-right">
              {displayName}
              {target?.email ? (
                <span className="block text-xs text-gray-400">
                  {target.email}
                </span>
              ) : null}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lockdown-reason">Reason (required)</Label>
            <Textarea
              id="lockdown-reason"
              placeholder="e.g. Suspected account compromise / unusual login activity"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
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
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="animate-spin" /> : <ShieldAlert />}
            Lock down account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LockdownDialog;
