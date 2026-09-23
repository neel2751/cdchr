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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BANK_HOLIDAY_REGIONS } from "@/data/bankHolidayRegions";
import { useFetchSelectQuery } from "@/hooks/use-query";
import {
  getWorkSettings,
  updateWorkSettings,
} from "@/server/settingsServer/workSettings";

/**
 * Company-wide working time. This is the figure every employee left on "fixed"
 * weekly hours inherits, so it is what values their paid leave — changing it
 * moves those numbers across the attendance screens at once.
 */
export default function WorkHoursSettings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useFetchSelectQuery({
    queryKey: ["workSettings"],
    fetchFn: getWorkSettings,
  });

  // The inputs show the saved values until someone types, at which point the
  // draft takes over. Deriving them this way means no effect has to copy the
  // fetched settings into state once they arrive.
  const [draft, setDraft] = React.useState(null);
  const hours = draft?.hours ?? String(settings?.fixedWeeklyHours ?? 40);
  const days = draft?.days ?? String(settings?.defaultDaysPerWeek ?? 5);
  // Absent means false — the same as the schema default, and what every company
  // did before this setting existed.
  const observes =
    draft?.observes ?? settings?.observesBankHolidays === true;
  const region =
    draft?.region ?? settings?.bankHolidayRegion ?? "england-and-wales";
  const setHours = (v) => setDraft({ hours: v, days, observes, region });
  const setDays = (v) => setDraft({ hours, days: v, observes, region });
  const setObserves = (v) => setDraft({ hours, days, observes: v, region });
  const setRegion = (v) => setDraft({ hours, days, observes, region: v });

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      updateWorkSettings({
        fixedWeeklyHours: Number(hours),
        defaultDaysPerWeek: Number(days),
        observesBankHolidays: observes,
        bankHolidayRegion: region,
      }),
    onSuccess: (res) => {
      if (!res?.success) {
        toast.error(res?.message || "Could not save settings");
        return;
      }
      toast.success(res.message);
      // Everything priced off these figures has to be refetched.
      queryClient.invalidateQueries({ queryKey: ["workSettings"] });
      queryClient.invalidateQueries({ queryKey: ["attendanceData"] });
    },
    onError: (err) => toast.error(err?.message || "Could not save settings"),
  });

  const perDay =
    Number(hours) > 0 && Number(days) > 0
      ? (Number(hours) / Number(days)).toFixed(2)
      : "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Working Time</CardTitle>
        <CardDescription>
          The standard week for employees set to &ldquo;Fixed hours&rdquo;. Paid
          leave is valued from this — weekly hours divided by the days an
          employee works gives one day&rsquo;s pay. Anyone on custom hours keeps
          their own figure and is not affected.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fixedWeeklyHours">Fixed hours per week</Label>
                <Input
                  id="fixedWeeklyHours"
                  type="number"
                  min={1}
                  max={80}
                  step="0.5"
                  value={hours}
                  disabled={isPending}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultDaysPerWeek">
                  Default days per week
                </Label>
                <Input
                  id="defaultDaysPerWeek"
                  type="number"
                  min={1}
                  max={7}
                  step="0.5"
                  value={days}
                  disabled={isPending}
                  onChange={(e) => setDays(e.target.value)}
                />
                <p className="text-xs text-neutral-500">
                  Used only when an employee has no days recorded of their own.
                </p>
              </div>
            </div>

            <div className="rounded-md border bg-neutral-50 p-3 text-sm">
              A standard day is worth{" "}
              <span className="font-semibold">{perDay} hours</span> — that is
              what one day of paid leave counts as. A half day counts as half.
            </div>

            {/* Worded as the consequence rather than the setting: "observe bank
                holidays" does not tell an HR manager whose allowance pays for
                Christmas Day, which is the only thing they are deciding. */}
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="observesBankHolidays" className="text-sm">
                  Close on UK bank holidays
                </Label>
                <p className="text-xs text-neutral-500">
                  {observes
                    ? "The office is closed, so these days are removed from a leave request rather than taken out of anyone's allowance."
                    : "Bank holidays are ordinary working days. Booking one off is deducted from the annual allowance like any other day."}
                </p>
                <p className="text-xs text-neutral-400">
                  Applies to leave booked from now on. Requests already approved
                  are not re-calculated.
                </p>
              </div>
              <Switch
                id="observesBankHolidays"
                checked={observes}
                disabled={isPending}
                onCheckedChange={setObserves}
              />
            </div>

            {/* Only asked once the answer matters. The three gov.uk lists are
                genuinely different — Scotland takes 2 January and not Easter
                Monday — so a company on the wrong one is told to work days it
                is closed and charged for days it is not. */}
            {observes ? (
              <div className="space-y-1.5">
                <Label htmlFor="bankHolidayRegion">
                  Which bank holidays do you follow?
                </Label>
                <Select
                  value={region}
                  disabled={isPending}
                  onValueChange={setRegion}
                >
                  <SelectTrigger id="bankHolidayRegion" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BANK_HOLIDAY_REGIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-neutral-500">
                  The published lists differ by nation. Scotland has 2 January
                  and St Andrew&apos;s Day but not Easter Monday; Northern
                  Ireland adds St Patrick&apos;s Day and the Twelfth.
                </p>
              </div>
            ) : null}

            <Button disabled={isPending} onClick={() => mutate()}>
              {isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Save settings
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
