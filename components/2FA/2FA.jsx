"use client";

import { useState } from "react";
import { Shield, Copy, KeyRound, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useFetchQuery } from "@/hooks/use-query";
import {
  check2FA,
  enable2FA,
  onEnableChange,
  regenerateBackupCodes,
} from "@/server/2FAServer/TwoAuthserver";
import { toast } from "sonner";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import Image from "next/image";
import { Separator } from "../ui/separator";
import { useSubmitMutation } from "@/hooks/use-mutate";
import BackupCodes from "./BackupCodes";

export function TwoFactorAuthCard({ className }) {
  // const [enabled, setEnabled] = useState(defaultEnabled);
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [backupCodes, setBackupCodes] = useState(null);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [regenerateCode, setRegenerateCode] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  const queryKey = ["generate2FA"];

  const { data: check } = useFetchQuery({
    fetchFn: check2FA,
    queryKey,
  });
  const { isEnabled: enabled, backupCodesRemaining = 0 } = check?.newData || {};

  const { mutate: submit2FA, isPending } = useSubmitMutation({
    mutationFn: async () => {
      const result = await enable2FA(code, secret);
      // Capture the one-time recovery codes before the success handler tears
      // the setup dialog down — the server will never return them again.
      if (result?.success) setBackupCodes(result.backupCodes || []);
      return result;
    },
    invalidateKey: queryKey,
    onSuccessMessage: (message) => toast.success(message),
    onClose: () => {
      setSecret("");
      setQrCodeUrl("");
      setCode("");
      setShowSetupDialog(false);
    },
  });
  const { mutate: disable2FA } = useSubmitMutation({
    mutationFn: async () => await onEnableChange(false),
    invalidateKey: queryKey,
    onSuccessMessage: (message) => toast.success(message),
    onClose: () => {
      setSecret("");
      setQrCodeUrl("");
      setCode("");
      setShowSetupDialog(false);
    },
  });

  const handleToggleChange = async (check) => {
    if (check) {
      const result = await onEnableChange(true);
      if (!result.success) return toast.error(result.message);
      const data = JSON.parse(result?.data);
      const { isEnabled, isVerified, secret, qrCodeUrl } = data;
      if (!isEnabled || !isVerified) {
        setSecret(secret);
        setQrCodeUrl(qrCodeUrl);
        setShowSetupDialog(true);
      } else {
        toast.success("2FA is already enabled");
      }
    } else {
      disable2FA();
    }
  };

  const onComplete = async () => {
    submit2FA(code, secret);
  };

  const copySecretKey = () => {
    navigator.clipboard.writeText(secret);
    toast.success("Secret key copied to clipboard");
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    const result = await regenerateBackupCodes(regenerateCode);
    setRegenerating(false);
    setRegenerateCode("");
    if (!result?.success) {
      return toast.error(result?.message || "Could not generate recovery codes");
    }
    setShowRegenerateDialog(false);
    setBackupCodes(result.backupCodes || []);
  };

  return (
    <>
      <Card
        className={cn(
          "w-full max-w-md transition-all duration-300 mx-auto mt-2.5",
          enabled ? "border-primary shadow-md" : "border-muted",
          className
        )}
      >
        <CardHeader className="flex flex-row sm:items-center justify-between space-y-0 pb-2">
          <div className="flex flex-row items-center space-x-2">
            <Shield
              className={cn(
                "h-5 w-5 sm:block hidden",
                enabled ? "text-primary" : "text-muted-foreground"
              )}
            />
            <div>
              <CardTitle className="text-base tracking-tight">
                Two-Factor Authentication
              </CardTitle>
              <CardDescription className="mt-1 tracking-tight">
                Add an extra layer of security to your account
              </CardDescription>
            </div>
          </div>
          <Badge
            variant={enabled ? "default" : "outline"}
            className={cn(
              "transition-all",
              enabled
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            )}
          >
            {enabled ? "Enabled" : "Disabled"}
          </Badge>
        </CardHeader>
        <CardContent className="pb-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="toggle-2fa" className="text-sm font-medium">
              {enabled ? "2FA is Active" : "2FA is Inactive"}
            </Label>
            <Switch
              id="toggle-2fa"
              checked={enabled}
              onCheckedChange={handleToggleChange}
              disabled={isPending}
              aria-label="Toggle two-factor authentication"
            />
          </div>
        </CardContent>
        <CardFooter className="flex-col items-start gap-3 text-sm text-muted-foreground">
          {enabled ? (
            <p>
              Your account is protected with two-factor authentication. You'll
              need to enter a verification code from your authenticator app when
              you sign in.
            </p>
          ) : (
            <p>
              Protect your account with two-factor authentication. You'll need
              to enter a verification code from your authenticator app when you
              sign in.
            </p>
          )}

          {enabled && (
            <>
              <Separator />
              <div className="w-full space-y-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  <span className="text-sm font-medium text-foreground">
                    Recovery codes
                  </span>
                </div>
                <p
                  className={cn(
                    "tracking-tight",
                    backupCodesRemaining === 0 && "text-rose-600"
                  )}
                >
                  {backupCodesRemaining === 0
                    ? "You have no recovery codes. Without them you will be locked out if you lose your authenticator app."
                    : `${backupCodesRemaining} unused single-use code(s) remaining. Each one can sign you in once if you lose your authenticator app.`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRegenerateDialog(true)}
                >
                  {backupCodesRemaining === 0
                    ? "Generate recovery codes"
                    : "Regenerate recovery codes"}
                </Button>
              </div>
            </>
          )}
        </CardFooter>
      </Card>
      <Dialog open={showSetupDialog} onOpenChange={setShowSetupDialog}>
        <DialogContent className="w-full max-w-2xl max-h-screen overflow-y-auto bg-white rounded-lg shadow-lg p-6 sm:max-w-md md:max-w-lg lg:max-w-md">
          <DialogHeader>
            <DialogTitle className={"tracking-tight text-base"}>
              Setup Authenticator App
            </DialogTitle>
            <DialogDescription className={"tracking-tight"}>
              Each time you log in, in addition to your password, you'll use an
              authenticator app to generate a one-time code.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <span className="inline-flex items-center justify-center rounded-full bg-stone-200 text-primary h-5 p-2 text-xs">
                  Step 1
                </span>
                Scan QR code
              </h3>
              <CardDescription className="tracking-tight mt-1">
                Scan the QR code below or manually enter the secret key into
                your authenticator app.
              </CardDescription>

              <div className="mt-4 flex flex-col items-center space-y-4">
                <div className="border p-0.5 rounded-md bg-white">
                  {qrCodeUrl ? (
                    <Image
                      src={qrCodeUrl}
                      alt="QR Code for 2FA setup"
                      className="w-48 h-48 object-contain"
                      width={192}
                      height={192}
                    />
                  ) : (
                    <div className="w-64 h-64 bg-gradient-to-tl from-blue-500 to-blue-300 animate-pulse rounded-md mb-8"></div>
                  )}
                </div>
                <div className="relative w-full text-center text-sm">
                  <div
                    className="absolute inset-0 flex items-center"
                    aria-hidden="true"
                  >
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <span className="relative z-10 bg-white px-2 text-muted-foreground tracking-tight">
                    Can't scan QR code?
                  </span>
                </div>
                <div className="w-full">
                  <p className="text-sm mb-1">Enter this secret instead:</p>
                  <div className="flex items-center space-x-2">
                    <div className="bg-stone-100 p-1.5 rounded text-sm w-full pl-3">
                      {secret}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copySecretKey}
                      aria-label="Copy secret key"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <span className="inline-flex items-center justify-center rounded-full bg-stone-200 text-primary h-5 p-2 text-xs">
                  Step 2
                </span>
                Get verification Code
              </h3>
              <CardDescription className="tracking-tight mt-1">
                Enter the 6-digit code you see in your authenticator app.
              </CardDescription>

              <div className="mt-4">
                <Label htmlFor="code-input-0" className="sr-only">
                  Enter verification code
                </Label>
                <div className="flex gap-2">
                  <InputOTP
                    maxLength={6}
                    pattern={REGEXP_ONLY_DIGITS}
                    name="code"
                    value={code}
                    onChange={(value) => setCode(value)}
                    onComplete={onComplete}
                  >
                    {Array.from({ length: 6 }).map((_, index) => (
                      <InputOTPGroup key={index}>
                        <InputOTPSlot index={index} />
                      </InputOTPGroup>
                    ))}
                  </InputOTP>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* One-time reveal of freshly issued recovery codes. */}
      <Dialog
        open={!!backupCodes}
        onOpenChange={(open) => {
          if (!open) setBackupCodes(null);
        }}
      >
        <DialogContent className="lg:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-base tracking-tight">
              Save your recovery codes
            </DialogTitle>
            <DialogDescription className="tracking-tight">
              Use one of these if you ever lose access to your authenticator app.
            </DialogDescription>
          </DialogHeader>
          <BackupCodes
            codes={backupCodes || []}
            onDone={() => setBackupCodes(null)}
            doneLabel="Done"
          />
        </DialogContent>
      </Dialog>

      {/* Regenerating invalidates every existing code, so we require a live
          authenticator code first. */}
      <Dialog
        open={showRegenerateDialog}
        onOpenChange={(open) => {
          setShowRegenerateDialog(open);
          if (!open) setRegenerateCode("");
        }}
      >
        <DialogContent className="lg:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base tracking-tight">
              Generate new recovery codes
            </DialogTitle>
            <DialogDescription className="tracking-tight">
              Enter the 6-digit code from your authenticator app. Any recovery
              codes you were given previously will stop working.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              value={regenerateCode}
              disabled={regenerating}
              onChange={setRegenerateCode}
              onComplete={handleRegenerate}
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <InputOTPGroup key={index}>
                  <InputOTPSlot index={index} />
                </InputOTPGroup>
              ))}
            </InputOTP>
          </div>
          <Button
            className="w-full"
            disabled={regenerating || regenerateCode.length < 6}
            onClick={handleRegenerate}
          >
            {regenerating && <Loader2 className="h-4 w-4 animate-spin" />}
            Generate new codes
          </Button>
        </DialogContent>
      </Dialog>
      {/* TO DO : Set the alert while disable */}
    </>
  );
}
