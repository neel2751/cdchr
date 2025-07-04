"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { verifyPassword } from "@/server/authServer/authServer";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { Label } from "./ui/label";

export default function PasswordConfirmModal({ open, onClose, onSuccess }) {
  const [password, setPassword] = useState("");

  const { mutate: handleConfirm, isPending: loading } = useSubmitMutation({
    mutationFn: async () => await verifyPassword(password),
    invalidateKey: ["password"],
    onSuccessMessage: () => "Password verified successfully!",
    onClose: () => {
      onSuccess();
      setPassword("");
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={"lg:max-w-sm"}>
        <DialogHeader>
          <div>
            <DialogTitle className={"tracking-tight text-base"}>
              Confirm your password
            </DialogTitle>
            <DialogDescription className={"tracking-tight"}>
              Please enter your password to confirm your action.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="password" className={"text-stone-800"}>
            Password
          </Label>
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
            size={"sm"}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={password.length <= 6 || loading}
            size={"sm"}
          >
            {loading ? "Checking..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
