"use client";
import { useState } from "react";
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
import { Loader2, ShieldOff } from "lucide-react";
import { toast } from "sonner";

/**
 * Confirmation dialog for a super-admin 2FA reset. Used when someone can satisfy
 * neither their authenticator app nor a recovery code. Requires a mandatory
 * reason (audited).
 */
const ResetTwoFactorDialog = ({ target, onOpenChange, onConfirm, isPending }) => {
  const open = Boolean(target);
  const [reason, setReason] = useState("");

  // Clear the reason whenever the dialog is pointed at a different account, so a
  // justification written for one person can never be submitted for another.
  // Adjusted during render rather than in an effect to avoid a cascading render.
  const targetId = target?._id ?? null;
  const [lastTargetId, setLastTargetId] = useState(targetId);
  if (targetId !== lastTargetId) {
    setLastTargetId(targetId);
    setReason("");
  }

  const displayName =
    target?.name ||
    [target?.firstName, target?.lastName].filter(Boolean).join(" ") ||
    "—";

  const codesLeft = target?.twoFactorBackupCodes ?? 0;

  const handleConfirm = () => {
    if (!reason.trim()) {
      return toast.warning("Please provide a reason for the reset");
    }
    onConfirm({ reason: reason.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <ShieldOff className="h-5 w-5" /> Reset two-factor authentication
          </DialogTitle>
          <DialogDescription>
            Removes this account&apos;s 2FA enrolment and its recovery codes. At
            their next login they will be required to set up an authenticator app
            again and will be issued fresh recovery codes. Recorded in the audit
            log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-gray-500">Account</span>
            <span className="text-right font-medium">
              {displayName}
              {target?.email ? (
                <span className="block text-xs text-gray-400">
                  {target.email}
                </span>
              ) : null}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-gray-500">Recovery codes left</span>
            <span className="font-medium">{codesLeft}</span>
          </div>

          {codesLeft > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs tracking-tight text-amber-900">
              This account still has {codesLeft} unused recovery code(s). If the
              user can find them, they can sign in themselves — a reset is only
              needed when those are lost too.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reset-2fa-reason">Reason (required)</Label>
            <Textarea
              id="reset-2fa-reason"
              placeholder="e.g. Phone replaced, authenticator app lost and recovery codes unavailable — identity confirmed by phone"
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
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" /> : <ShieldOff />}
            Reset 2FA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ResetTwoFactorDialog;
