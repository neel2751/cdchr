"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ACCESS_RULES } from "@/lib/tenantAccess";
import {
  setTenantAccessLock,
  setTenantStatus,
  setTenantTrialEnd,
} from "@/server/tenantServer/platformServer";

/**
 * Whether a company can use the app, and the controls to change it — see
 * lib/tenantAccess.js for the ladder:
 *
 *   trial ─▶ grace ─▶ read-only ─▶ locked
 *
 * Three levers: move the trial's end date, mark the company as paying, or
 * lock it by hand (for an unpaid bill), with a note the company sees.
 */

export const ACCESS_LABEL = {
  full: "Full access",
  grace: "Grace period",
  readOnly: "Read-only",
  locked: "Locked",
};

export const ACCESS_VARIANT = {
  full: "secondary",
  grace: "outline",
  readOnly: "destructive",
  locked: "destructive",
};

const day = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const toInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

const addDays = (from, n) => {
  const base = from && new Date(from) > new Date() ? new Date(from) : new Date();
  return new Date(base.getTime() + n * 86400000);
};

/** A sentence for the operator: where the company is, and what comes next. */
function whereItIs(access, status) {
  switch (access.reason) {
    case "active":
      return "Paying customer. No trial, no lock.";
    case "trial":
      return access.trialEndsAt
        ? `On trial until ${day(access.trialEndsAt)} (${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"} left). Then ${ACCESS_RULES.graceDays} days' grace, ${ACCESS_RULES.readOnlyDays} days read-only, then locked.`
        : "On trial with no end date — it will never end. Set one below.";
    case "trialEnded":
      return access.level === "locked"
        ? "Trial over and locked. Only the super admin can sign in, to a page that says why."
        : `Trial ended ${day(access.trialEndsAt)}. ${ACCESS_LABEL[access.level]} until ${day(access.nextAt)}, then ${ACCESS_LABEL[access.nextLevel].toLowerCase()}.`;
    case "manual":
      return access.level === "locked"
        ? "Locked by hand. Only the super admin can sign in."
        : "Read-only by hand. People can look and export, but not change anything. Clocking in still works.";
    case "suspended":
      return "Suspended. Only the super admin can sign in.";
    case "cancelled":
      return "Cancelled. Nobody but the super admin can sign in.";
    default:
      return status;
  }
}

export default function AccessTab({ tenant, run, isPending }) {
  const access = tenant.access || { level: "full", reason: "active" };
  const lock = tenant.billing?.lock || null;
  const onTrial = tenant.status === "trial";

  const [end, setEnd] = useState(toInput(access.trialEndsAt));
  const [level, setLevel] = useState(lock?.level || "none");
  const [message, setMessage] = useState(lock?.message || "");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Access
            <Badge variant={ACCESS_VARIANT[access.level] || "outline"}>
              {ACCESS_LABEL[access.level] || access.level}
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {whereItIs(access, tenant.status)}
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trial</CardTitle>
          <p className="text-sm text-muted-foreground">
            {onTrial
              ? "Give them longer, or end it today. Reminder emails start again from the new date."
              : "Not on a trial. Self sign-ups start on one; you can put a company back on trial from here."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {onTrial && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="trial-end">Trial ends</Label>
                <Input
                  id="trial-end"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-44"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => setEnd(toInput(addDays(access.trialEndsAt, 7)))}
              >
                +7 days
              </Button>
              <Button
                variant="outline"
                onClick={() => setEnd(toInput(addDays(access.trialEndsAt, 14)))}
              >
                +14 days
              </Button>
              <Button
                disabled={isPending || !end}
                onClick={() => run(() => setTenantTrialEnd(tenant._id, end))}
              >
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Save date
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            {tenant.status !== "active" && (
              <Button
                disabled={isPending}
                onClick={() => run(() => setTenantStatus(tenant._id, "active"))}
              >
                Mark as paying customer
              </Button>
            )}
            {!onTrial && (
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => run(() => setTenantStatus(tenant._id, "trial"))}
              >
                Put on a {ACCESS_RULES.trialDays}-day trial
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lock by hand</CardTitle>
          <p className="text-sm text-muted-foreground">
            For a bill that has not been paid. Wins over the trial dates.
            Nothing is ever deleted; unlocking puts everything back.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup value={level} onValueChange={setLevel} className="gap-3">
            {[
              ["none", "No lock", "Access follows the trial and status."],
              [
                "readOnly",
                "Read-only",
                "Everyone can sign in, look and export. Nobody can add or change anything. Clocking in still works.",
              ],
              [
                "locked",
                "Locked",
                "Nobody can sign in except the super admin, who sees a page saying the account is paused. Clocking in stops.",
              ],
            ].map(([value, label, help]) => (
              <Label
                key={value}
                htmlFor={`lock-${value}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
              >
                <RadioGroupItem id={`lock-${value}`} value={value} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{help}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>

          {level !== "none" && (
            <div className="space-y-1.5">
              <Label htmlFor="lock-message">Note for the company (optional)</Label>
              <Textarea
                id="lock-message"
                rows={2}
                maxLength={500}
                placeholder="e.g. Invoice INV-0042 is 30 days overdue. Pay it to reopen the account."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          )}

          <Button
            variant={level === "none" ? "default" : "destructive"}
            disabled={isPending}
            onClick={() =>
              run(() =>
                setTenantAccessLock(tenant._id, {
                  level: level === "none" ? null : level,
                  message,
                })
              )
            }
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {level === "none"
              ? "Unlock"
              : level === "locked"
                ? "Lock the account"
                : "Make read-only"}
          </Button>
          {lock?.at && (
            <p className="text-xs text-muted-foreground">
              {ACCESS_LABEL[lock.level]} since {day(lock.at)}
              {lock.by ? ` by ${lock.by}` : ""}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
