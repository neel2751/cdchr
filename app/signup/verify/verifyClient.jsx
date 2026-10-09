"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  KeyRound,
  Loader2,
  PartyPopper,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { completeSignup } from "@/server/authServer/signupServer";
import { PLATFORM_APP_NAME } from "@/lib/tenant";

/**
 * Redeems the emailed confirmation link, which is what actually creates the
 * company (see server/authServer/signupServer.js).
 *
 * The redemption is fired from the browser rather than during the server
 * render, deliberately. Corporate mail filters and link scanners fetch every
 * URL in an incoming message; if the GET itself created the workspace, the
 * scanner would burn the single-use token and the person would arrive to be
 * told their link was already used. Scanners do not run JavaScript, so moving
 * the call here keeps the one-click experience without that failure mode.
 */
export default function VerifySignup({ token }) {
  const [state, setState] = useState(token ? "working" : "invalid");
  const [result, setResult] = useState(null);
  // React runs effects twice in development StrictMode. The second call would
  // find the token spent and report "already used" over a success that had just
  // landed, so redemption is allowed exactly once per mount.
  const redeemed = useRef(false);

  useEffect(() => {
    if (!token || redeemed.current) return;
    redeemed.current = true;

    (async () => {
      const res = await completeSignup(token);
      if (res?.success) {
        setResult(JSON.parse(res.data));
        setState("done");
      } else {
        setResult({ message: res?.message, alreadyUsed: !!res?.alreadyUsed });
        setState(res?.alreadyUsed ? "used" : "failed");
      }
    })();
  }, [token]);

  return (
    <div className="bg-muted/30 flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-3">
          <Image
            src="/images/Interiorlogo.svg"
            alt=""
            height={32}
            width={32}
            className="h-8 w-8"
          />
          <span className="font-semibold">{PLATFORM_APP_NAME}</span>
        </div>

        {state === "working" && <Working />}
        {state === "done" && <Success result={result} />}
        {state === "used" && (
          <Problem
            title="This link has already been used"
            body={result?.message}
            action={{ href: "/auth", label: "Go to sign in" }}
          />
        )}
        {(state === "failed" || state === "invalid") && (
          <Problem
            title="We couldn't confirm this link"
            body={
              result?.message ||
              "This confirmation link is invalid or has expired. Links are valid for 24 hours."
            }
            action={{ href: "/signup", label: "Start again" }}
          />
        )}
      </div>
    </div>
  );
}

function Working() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-14 text-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
        <p className="mt-5 font-medium">Setting up your workspace…</p>
        <p className="text-muted-foreground mt-1 text-sm">
          This takes a moment. Please don&apos;t close this tab.
        </p>
      </CardContent>
    </Card>
  );
}

function Success({ result }) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <span className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950">
          <PartyPopper className="size-7 text-emerald-600" />
        </span>
        <CardTitle className="text-2xl">
          {result?.companyName} is ready
        </CardTitle>
        <CardDescription>
          Your email is confirmed and you&apos;re the super admin.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <dl className="bg-muted/50 space-y-3 rounded-lg border p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Sign in as</dt>
            <dd className="truncate font-medium">{result?.email}</dd>
          </div>
          {result?.workspaceUrl && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="truncate font-medium">
                {result.workspaceUrl.replace(/^https?:\/\//, "")}
              </dd>
            </div>
          )}
        </dl>

        {/* Signing in immediately sends them to /setup-2fa — saying so here
            means it reads as the next step rather than as something going
            wrong. auth.js forces enrolment for every super admin. */}
        <div className="flex gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-indigo-600" />
          <p className="text-muted-foreground">
            <span className="text-foreground font-medium">
              One more step after you sign in.
            </span>{" "}
            Admin accounts must set up two-factor authentication, so you&apos;ll be
            asked to scan a code with your authenticator app.
          </p>
        </div>

        <Button asChild size="lg" className="w-full">
          <Link href="/auth">
            Sign in to {result?.companyName} <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Problem({ title, body, action }) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <span className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950">
          <AlertCircle className="size-7 text-amber-600" />
        </span>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button asChild className="w-full">
          <Link href={action.href}>{action.label}</Link>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/forgot-password">
            <KeyRound /> Forgot your password?
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
