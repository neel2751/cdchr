"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetPasswordWithToken } from "@/server/authServer/passwordResetServer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ResetPasswordForm({ uid, token }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const invalidLink = !uid || !token;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      return toast.warning("Password must be at least 8 characters");
    }
    if (newPassword !== confirmPassword) {
      return toast.warning("Passwords do not match");
    }
    startTransition(async () => {
      const res = await resetPasswordWithToken({ uid, token, newPassword });
      if (res?.success) {
        setDone(true);
        toast.success(res.message);
        setTimeout(() => router.push("/auth"), 1500);
      } else {
        toast.error(res?.message || "Something went wrong");
      }
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>
            Choose a new password for your CDC HR account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invalidLink ? (
            <div className="space-y-4 text-sm">
              <p className="text-rose-600">
                This reset link is invalid. Please request a new one.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          ) : done ? (
            <div className="space-y-4 text-sm">
              <p>Your password has been reset. Redirecting you to sign in…</p>
              <Button asChild className="w-full">
                <Link href="/auth">Go to sign in</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                Reset password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
