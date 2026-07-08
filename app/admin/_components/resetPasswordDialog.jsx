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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

/**
 * Super-admin dialog to reset an employee's password. Requires a new password,
 * confirmation, and a mandatory reason which is written to the audit log.
 * Works for both office (name) and site (firstName/lastName) employee shapes.
 *
 * @param {{ target: object|null,
 *           onOpenChange: (open:boolean)=>void,
 *           onConfirm: (payload:{newPassword:string, reason:string})=>void,
 *           isPending: boolean }} props
 */
const ResetPasswordDialog = ({ target, onOpenChange, onConfirm, isPending }) => {
  const open = Boolean(target);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setNewPassword("");
      setConfirmPassword("");
      setReason("");
    }
  }, [open, target?._id]);

  const displayName =
    target?.name ||
    [target?.firstName, target?.lastName].filter(Boolean).join(" ") ||
    "—";

  const handleConfirm = () => {
    if (!newPassword || newPassword.length < 8) {
      return toast.warning("New password must be at least 8 characters");
    }
    if (newPassword !== confirmPassword) {
      return toast.warning("New and confirm password do not match");
    }
    if (!reason.trim()) {
      return toast.warning("Please provide a reason for the reset");
    }
    onConfirm({ newPassword, reason: reason.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for this employee. The action and your reason are
            recorded in the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-gray-500">Employee</span>
            <span className="font-medium text-right">
              {displayName}
              {target?.email ? (
                <span className="block text-xs text-gray-400">
                  {target.email}
                </span>
              ) : null}
            </span>
          </div>

          {target?.isLocked ? (
            <Badge variant="destructive" className="gap-1">
              <Lock className="h-3 w-3" /> Account locked — reset will unlock it
            </Badge>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="reset-new-password">New password</Label>
            <Input
              id="reset-new-password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm-password">Confirm password</Label>
            <Input
              id="reset-confirm-password"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-reason">Reason (required)</Label>
            <Textarea
              id="reset-reason"
              placeholder="e.g. Account locked after failed logins; employee requested reset"
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
            {isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ResetPasswordDialog;
