"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  getWorkSettings,
  updateWorkSettings,
} from "@/server/settingsServer/workSettings";

/**
 * Rules the clock in/out scanner enforces.
 *
 * All three policy rules start off, which is what every company has today —
 * they existed in the scanner as hard-coded constants, but the check behind
 * them compared two "HH:mm" strings by subtracting them, so not one had ever
 * refused a scan. Turning them on here is therefore a real change to what
 * employees can do, which is why it is a decision rather than a default.
 *
 * The shift cap is separate and always on: it is what tells a night shift
 * apart from a mistyped clock out, since both read as ending before they
 * started.
 */
export default function ClockRulesSettings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useFetchSelectQuery({
    queryKey: ["workSettings"],
    fetchFn: getWorkSettings,
  });

  const [draft, setDraft] = React.useState(null);
  const set = (key) => (value) =>
    setDraft((d) => ({ ...(d ?? {}), [key]: value }));

  const saved = (key, fallback) => String(settings?.[key] ?? fallback);
  const maxShiftHours = draft?.maxShiftHours ?? saved("maxShiftHours", 16);
  const beforeBreak =
    draft?.beforeBreak ?? saved("minMinutesBeforeBreak", 0);
  const minBreak = draft?.minBreak ?? saved("minBreakMinutes", 0);
  const beforeClockOut =
    draft?.beforeClockOut ?? saved("minMinutesBeforeClockOut", 0);

  // Stored as a Date, edited as a "YYYY-MM-DD" string. Sliced off the ISO form
  // rather than formatted locally, because the value is a UTC midnight and a
  // local format would show the day before for anyone west of London.
  const savedCutover = settings?.clockCutoverDate
    ? String(settings.clockCutoverDate).slice(0, 10)
    : "";
  const cutover = draft?.cutover ?? savedCutover;
  const today = new Date().toISOString().slice(0, 10);

  // A rule is "on" when it has a number above zero. The switch is the plain
  // way to say that: flipping it off sends 0 rather than leaving a stale
  // figure that would come back the next time it is enabled.
  const rules = [
    {
      key: "beforeBreak",
      value: beforeBreak,
      label: "Wait before a break can start",
      unit: "minutes after clocking in",
      off: "Employees can take a break at any point in their shift.",
      on: (v) => `A break cannot start within ${v} minutes of clocking in.`,
      max: 720,
    },
    {
      key: "minBreak",
      value: minBreak,
      label: "Minimum break length",
      unit: "minutes",
      off: "A break can be any length, including a minute.",
      on: (v) => `An employee cannot break back in until ${v} minutes have passed.`,
      max: 720,
    },
    {
      key: "beforeClockOut",
      value: beforeClockOut,
      label: "Minimum time before clocking out",
      unit: "minutes after clocking in",
      off: "Employees can clock out at any time after clocking in.",
      on: (v) => `Clocking out is refused until ${v} minutes after clocking in.`,
      max: 1440,
    },
  ];

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      updateWorkSettings({
        maxShiftHours: Number(maxShiftHours),
        minMinutesBeforeBreak: Number(beforeBreak),
        minBreakMinutes: Number(minBreak),
        minMinutesBeforeClockOut: Number(beforeClockOut),
        // "" clears it, which the action reads as "review all history".
        clockCutoverDate: cutover || null,
      }),
    onSuccess: (res) => {
      if (!res?.success) {
        toast.error(res?.message || "Could not save settings");
        return;
      }
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["workSettings"] });
    },
    onError: (err) => toast.error(err?.message || "Could not save settings"),
  });

  const anyOn = rules.some((r) => Number(r.value) > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clock In &amp; Out Rules</CardTitle>
        <CardDescription>
          What the scanner refuses. These apply to employees clocking
          themselves in and out — an admin correcting a record on the
          attendance screen is not blocked by them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maxShiftHours">Longest possible shift</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="maxShiftHours"
                  type="number"
                  min={1}
                  max={24}
                  className="w-24"
                  value={maxShiftHours}
                  disabled={isPending}
                  onChange={(e) => set("maxShiftHours")(e.target.value)}
                />
                <span className="text-sm text-neutral-500">hours</span>
              </div>
              <p className="text-xs text-neutral-500">
                A shift longer than this is treated as a missed clock out
                rather than a real one. It is also how a night shift is told
                apart from a typo: 22:00 to 06:00 and 09:00 to 08:00 both end
                &ldquo;before&rdquo; they start, and only the length
                distinguishes them.
              </p>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Break and shift policy</p>
                <p className="text-xs text-neutral-500">
                  {anyOn
                    ? "Employees are held to the rules below at the scanner."
                    : "All off — the scanner accepts any timing, which is how it has always behaved."}
                </p>
              </div>

              {rules.map((rule) => {
                const on = Number(rule.value) > 0;
                return (
                  <div
                    key={rule.key}
                    className="flex items-start justify-between gap-4 border-t pt-3"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor={rule.key} className="text-sm">
                        {rule.label}
                      </Label>
                      {on ? (
                        <div className="flex items-center gap-2">
                          <Input
                            id={rule.key}
                            type="number"
                            min={1}
                            max={rule.max}
                            className="w-24"
                            value={rule.value}
                            disabled={isPending}
                            onChange={(e) => set(rule.key)(e.target.value)}
                          />
                          <span className="text-sm text-neutral-500">
                            {rule.unit}
                          </span>
                        </div>
                      ) : null}
                      <p className="text-xs text-neutral-500">
                        {on
                          ? rule.on(rule.value)
                          : rule.off}
                      </p>
                    </div>
                    <Switch
                      checked={on}
                      disabled={isPending}
                      onCheckedChange={(next) =>
                        // Off means zero, not a remembered figure: a rule that
                        // is off should read as off everywhere, including in
                        // the audit log.
                        set(rule.key)(next ? "30" : "0")
                      }
                    />
                  </div>
                );
              })}
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="clockCutoverDate">
                Review open shifts from
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="clockCutoverDate"
                  type="date"
                  max={today}
                  className="w-44"
                  value={cutover}
                  disabled={isPending}
                  onChange={(e) => set("cutover")(e.target.value)}
                />
                {cutover ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => set("cutover")("")}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-neutral-500">
                {cutover
                  ? `Shifts before ${cutover} are left alone — not flagged for review, and not
                     given an overtime figure. Set this to the day your attendance data became
                     reliable, so the review queue only holds shifts someone can actually answer.`
                  : `Every shift in the system is checked, including any imported history. If
                     attendance was migrated from an older system, this will flag months of
                     missing clock outs that nobody can now answer.`}
              </p>
            </div>

            <Button disabled={isPending} onClick={() => mutate()}>
              {isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Save rules
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
