"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFetchQuery } from "@/hooks/use-query";
import { fetchLeaveCategory } from "@/server/category/category";
import {
  getLeaveSettingsClient,
  updateLeaveSettings,
} from "@/server/leaveSettingServer";

/**
 * Leave settings.
 *
 * Rewritten because the old shape was genuinely hard to use rather than merely
 * plain:
 *
 *   · The leave year start month sat inside a card titled "Carry Forward
 *     Settings". It is not a carry-forward setting — it is the date everything
 *     else is measured from, including entitlement and accrual — so it now has
 *     its own card above.
 *   · Each leave type rendered a whole nested form with its own Save button.
 *     Five leave types meant six save buttons on one screen and no way to tell
 *     which one saved what. They are now rows in one table with one Save.
 *   · The per-type toggle was labelled "Allowed Carry Forward" directly under
 *     a master switch called "Enable Carry Forward", which read as the same
 *     setting twice. The relationship is now stated instead of implied.
 *
 * The old code also seeded state from an effect, which React flags as a
 * cascading render. State here is a DRAFT that starts empty and falls back to
 * whatever the server last said, so nothing has to be copied on arrival.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A leave type with no rule yet is simply not carried forward. */
const BLANK_RULE = {
  allowed: false,
  maxDays: 0,
  expireAfterMonths: 0,
  proRated: false,
};

export default function CarryForwardSettings() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useFetchQuery({
    queryKey: ["leave-settings"],
    fetchFn: getLeaveSettingsClient,
  });
  const saved = data?.newData;

  const { data: categories } = useFetchQuery({
    fetchFn: fetchLeaveCategory,
    queryKey: ["leave-categories"],
  });
  const leaveTypes = categories?.newData || [];

  // Unsaved edits only. Anything not touched reads through to `saved`, so
  // there is nothing to copy in when the query resolves.
  const [draft, setDraft] = React.useState({});
  const [saving, setSaving] = React.useState(false);

  const value = (key, fallback) =>
    draft[key] !== undefined ? draft[key] : (saved?.[key] ?? fallback);
  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));

  const rules = value("carryForwardRules", []);
  const ruleFor = (leaveType) =>
    rules.find((r) => r.leaveType === leaveType) || {
      leaveType,
      ...BLANK_RULE,
    };

  const setRule = (leaveType, patch) => {
    const next = rules.some((r) => r.leaveType === leaveType)
      ? rules.map((r) => (r.leaveType === leaveType ? { ...r, ...patch } : r))
      : [...rules, { leaveType, ...BLANK_RULE, ...patch }];
    set("carryForwardRules", next);
  };

  const dirty = Object.keys(draft).length > 0;
  const enabled = Boolean(value("carryForwardEnabled", false));

  const save = async () => {
    // Validated before it goes, and by rule rather than by field: "at least 1"
    // on a number input says nothing about which of five rows is wrong.
    for (const type of leaveTypes) {
      const rule = ruleFor(type.leaveType);
      if (!rule.allowed) continue;
      if (!(Number(rule.maxDays) > 0)) {
        toast.error(`${type.leaveType}: how many days may be carried forward?`);
        return;
      }
      if (!(Number(rule.expireAfterMonths) > 0)) {
        toast.error(`${type.leaveType}: carried days need an expiry, in months.`);
        return;
      }
    }

    setSaving(true);
    try {
      const res = await updateLeaveSettings({
        // A Number, because the model is one and the month is used in date
        // arithmetic. Mongoose would cast "4" for us, but a value that only
        // works because of a cast is one that breaks when the cast moves.
        leaveYearStartMonth: Number(value("leaveYearStartMonth", 4)),
        carryForwardEnabled: enabled,
        carryForwardRules: rules,
      });
      if (!res?.success) {
        toast.error(res?.message || "Could not save those settings");
        return;
      }
      toast.success("Leave settings saved");
      // Cleared rather than replaced with the response: the query is the one
      // source, and two of them drift.
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ["leave-settings"] });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-24 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-neutral-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Leave year</CardTitle>
          <CardDescription>
            The month every leave year starts in. Entitlement, accrual and
            carry-forward are all measured from it, so changing it moves
            everybody&apos;s balances.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="leaveYearStart">Starts in</Label>
            <Select
              value={String(value("leaveYearStartMonth", 4))}
              onValueChange={(v) => set("leaveYearStartMonth", v)}
            >
              <SelectTrigger id="leaveYearStart" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((label, i) => (
                  <SelectItem key={label} value={String(i + 1)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Carrying leave into the next year</CardTitle>
          <CardDescription>
            Unused days can roll over, and each leave type decides for itself.
            Turning this off overrides every row below without clearing them —
            switch it back on and the rules are as you left them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="cfEnabled"
              checked={enabled}
              onCheckedChange={(v) => set("carryForwardEnabled", v)}
            />
            <Label htmlFor="cfEnabled" className="text-sm">
              {enabled
                ? "Unused leave can be carried forward"
                : "Unused leave is lost at the end of the year"}
            </Label>
          </div>

          {enabled ? (
            !leaveTypes.length ? (
              <p className="text-sm text-muted-foreground">
                No leave types yet — add them under Category first, then decide
                which of them carry forward.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2 font-medium">Leave type</th>
                      <th className="p-2 font-medium">Carries forward</th>
                      <th className="p-2 font-medium">Max days</th>
                      <th className="p-2 font-medium">Expires after</th>
                      <th className="p-2 font-medium">Pro-rated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaveTypes.map((type) => {
                      const rule = ruleFor(type.leaveType);
                      const on = Boolean(rule.allowed);
                      return (
                        <tr key={type.leaveType} className="border-t">
                          <td className="p-2 font-medium">{type.leaveType}</td>
                          <td className="p-2">
                            <Switch
                              checked={on}
                              onCheckedChange={(v) =>
                                setRule(type.leaveType, { allowed: v })
                              }
                            />
                          </td>
                          <td className="p-2">
                            {on ? (
                              <Input
                                type="number"
                                min={1}
                                max={365}
                                className="h-8 w-24"
                                value={rule.maxDays ?? ""}
                                onChange={(e) =>
                                  setRule(type.leaveType, {
                                    maxDays: Number(e.target.value),
                                  })
                                }
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          <td className="p-2">
                            {on ? (
                              <span className="flex items-center gap-1.5">
                                <Input
                                  type="number"
                                  min={1}
                                  max={12}
                                  className="h-8 w-20"
                                  value={rule.expireAfterMonths ?? ""}
                                  onChange={(e) =>
                                    setRule(type.leaveType, {
                                      expireAfterMonths: Number(e.target.value),
                                    })
                                  }
                                />
                                <span className="text-xs text-muted-foreground">
                                  months
                                </span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          <td className="p-2">
                            {on ? (
                              <Switch
                                checked={Boolean(rule.proRated)}
                                onCheckedChange={(v) =>
                                  setRule(type.leaveType, { proRated: v })
                                }
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {enabled && leaveTypes.length ? (
            <p className="text-xs text-muted-foreground">
              <strong>Max days</strong> caps what rolls over, however much is
              left. <strong>Expires after</strong> is how long the carried days
              survive into the new year before they are lost.{" "}
              <strong>Pro-rated</strong> scales the cap for somebody who joined
              part way through the year.
            </p>
          ) : null}

          {/* One save for the whole screen. The old version had a button per
              leave type, which made "did that save?" a question somebody had
              to ask five times. */}
          <div className="flex items-center gap-3 border-t pt-3">
            <Button disabled={saving || !dirty} onClick={save}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Save leave settings
            </Button>
            <span className="text-xs text-muted-foreground">
              {dirty ? "Unsaved changes" : "Everything is saved"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
