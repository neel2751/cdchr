"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Loader2, ShieldCheck, KeyRound } from "lucide-react";
import { homePathForRole } from "@/lib/roleHome";
import {
  verify2FAWithDB,
  verifyBackupCode,
} from "@/server/2FAServer/TwoAuthserver";

/**
 * The second step of signing in.
 *
 * A page rather than the modal this used to be, because it now has to offer a
 * way out: someone whose authenticator app is gone needs the recovery-code
 * path, and someone who cannot use either needs to be able to sign out rather
 * than sit on a dialog with no exit.
 *
 * Reaching this page at all is decided in proxy.js — it is matched by the
 * middleware, so it requires a session, and a user with nothing outstanding is
 * redirected away before the page renders. The checks below are the client-side
 * echo of that, for the case where the session changes underneath us.
 */
export default function VerifyTwoFactor() {
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { data: session, status, update } = useSession();

  useEffect(() => {
    if (status === "loading") return;

    // No session at all — this page is a step *inside* login, not a public one.
    if (status === "unauthenticated" || !session) {
      router.replace("/auth");
      return;
    }

    // Signed in with nothing left to verify: don't leave them staring at a code
    // prompt they cannot satisfy.
    if (!session?.user?.requiresTwoFactor) {
      router.replace(homePathForRole(session?.user?.role));
    }
  }, [session, status, router]);

  /**
   * Both paths finish the same way, and the order matters.
   *
   * `update()` asks auth.js to re-mint the token; it only clears the 2FA gate if
   * the server can see a recent verification stamp, which both verify2FAWithDB
   * and verifyBackupCode write. Then a full-page navigation, so the middleware
   * re-evaluates with the fresh cookie — a client-side router.push can outrun
   * the cookie and lands the user straight back here.
   */
  const completeVerification = async (successMessage) => {
    await update({ twoFactorVerified: true });
    toast.success(successMessage);
    window.location.assign(homePathForRole(session?.user?.role));
  };

  const submitAuthenticatorCode = (value) => {
    const entered = value ?? code;
    if (!/^\d{6}$/.test(entered)) {
      return toast.warning("Enter the 6-digit code from your authenticator app");
    }
    startTransition(async () => {
      const result = await verify2FAWithDB(entered);
      if (result?.success) {
        await completeVerification("Two-factor authentication verified");
      } else {
        setCode("");
        toast.error(result?.message || "Invalid verification code");
      }
    });
  };

  const submitRecoveryCode = (e) => {
    e.preventDefault();
    if (!recoveryCode.trim()) {
      return toast.warning("Enter one of your recovery codes");
    }
    startTransition(async () => {
      const result = await verifyBackupCode(recoveryCode);
      if (result?.success) {
        // Warned here rather than later: this is the moment the user is holding
        // the list and can do something about it.
        if (result.remaining === 0) {
          toast.warning(
            "That was your last recovery code. Set up your authenticator app again from Account settings."
          );
        } else if (result.remaining <= 3) {
          toast.warning(`${result.remaining} recovery code(s) left.`);
        }
        await completeVerification("Signed in with a recovery code");
      } else {
        setRecoveryCode("");
        toast.error(result?.message || "Invalid recovery code");
      }
    });
  };

  if (status === "loading" || !session?.user?.requiresTwoFactor) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            {useRecovery ? (
              <KeyRound className="h-5 w-5 text-primary" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-primary" />
            )}
            <CardTitle className="text-base tracking-tight">
              {useRecovery ? "Use a recovery code" : "Two-factor authentication"}
            </CardTitle>
          </div>
          <CardDescription className="tracking-tight">
            {useRecovery
              ? "Enter one of the single-use recovery codes you saved when you set up 2FA. Each code works only once."
              : "Enter the 6-digit code from your authenticator app to finish signing in."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {useRecovery ? (
            <form onSubmit={submitRecoveryCode} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="recovery-code">Recovery code</Label>
                <Input
                  id="recovery-code"
                  autoComplete="one-time-code"
                  placeholder="ABCDE-FGHJK"
                  className="font-mono tracking-wider uppercase"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Verify recovery code
              </Button>
            </form>
          ) : (
            <div className="space-y-3">
              <Label htmlFor="code-input-0" className="sr-only">
                Enter verification code
              </Label>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  name="code"
                  value={code}
                  disabled={isPending}
                  onChange={setCode}
                  onComplete={submitAuthenticatorCode}
                >
                  {Array.from({ length: 6 }).map((_, index) => (
                    <InputOTPGroup key={index}>
                      <InputOTPSlot index={index} />
                    </InputOTPGroup>
                  ))}
                </InputOTP>
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={isPending}
                onClick={() => submitAuthenticatorCode()}
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Verify
              </Button>
            </div>
          )}

          <Button
            type="button"
            variant="link"
            className="h-auto w-full p-0 text-sm"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode("");
              setRecoveryCode("");
            }}
          >
            {useRecovery
              ? "Use your authenticator app instead"
              : "Lost your authenticator app? Use a recovery code"}
          </Button>

          <Separator />

          {/* Without this, someone who can satisfy neither factor is stuck on
              this page with no way to reach a different account. */}
          <Button
            type="button"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => signOut({ callbackUrl: "/auth" })}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
