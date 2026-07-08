"use client";
import { useEffect, useState, useTransition } from "react";
import { useSession, signOut } from "next-auth/react";
import { onEnableChange, enable2FA } from "@/server/2FAServer/TwoAuthserver";
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
import { Loader2, ShieldCheck, Copy } from "lucide-react";
import { toast } from "sonner";

export default function ForcedTwoFactorSetup() {
  const { update } = useSession();
  const [secret, setSecret] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [code, setCode] = useState("");
  const [loadingQr, setLoadingQr] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await onEnableChange(true);
      if (!active) return;
      if (res?.success) {
        const data = JSON.parse(res.data);
        setSecret(data.secret);
        setQrCodeUrl(data.qrCodeUrl);
      } else {
        toast.error(res?.message || "Could not start 2FA setup");
      }
      setLoadingQr(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleVerify = (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      return toast.warning("Enter the 6-digit code from your authenticator app");
    }
    startTransition(async () => {
      const res = await enable2FA(code, secret);
      if (res?.success) {
        toast.success("Two-factor authentication enabled");
        // Wait for the updated JWT cookie, then do a full-page navigation so
        // middleware re-evaluates with mustSetup2FA cleared (a client-side
        // push can run before the cookie propagates and bounce back here).
        await update({ twoFactorSetupComplete: true });
        window.location.assign("/admin/dashboard");
      } else {
        toast.error(res?.message || "Invalid code, please try again");
      }
    });
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    toast.success("Secret key copied");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle>Set up two-factor authentication</CardTitle>
          </div>
          <CardDescription>
            Your role requires 2FA. Scan the QR code with an authenticator app
            (Google Authenticator, Microsoft Authenticator, etc.) and enter the
            6-digit code to finish.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            {loadingQr ? (
              <Loader2 className="animate-spin" />
            ) : qrCodeUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrCodeUrl}
                alt="2FA QR code"
                className="h-44 w-44 rounded border"
              />
            ) : (
              <p className="text-sm text-rose-600">Failed to generate QR code</p>
            )}
          </div>

          {secret && (
            <div className="space-y-1.5">
              <Label>Or enter this key manually</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted px-2 py-1 text-xs">
                  {secret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copySecret}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="otp">6-digit code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isPending || loadingQr}
            >
              {isPending && <Loader2 className="animate-spin" />}
              Verify & enable
            </Button>
          </form>

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
