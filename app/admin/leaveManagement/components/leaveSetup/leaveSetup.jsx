"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Info,
  Loader2,
  Lock,
  ShieldAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetchQuery } from "@/hooks/use-query";
import {
  completeLeaveSetup,
  getLeaveSetupState,
  previewEntitlements,
} from "@/server/leaveServer/leaveSetupServer";

/**
 * Leave setup — the one screen a new company has to visit before leave works.
 *
 * Two decisions and a consequence, in that order:
 *
 *   1. Which month the leave year starts. Everything else is measured from it,
 *      and it is the decision that is expensive to get wrong, so it is first and
 *      it shows the twelve months it implies rather than just a month name.
 *   2. Which leave types exist. The five the module cannot work without are
 *      ticked and locked; the rest are a starting point.
 *   3. What that produces for the people already on the list — one row each,
 *      with the arithmetic. This is the part that makes a pro-rata rule
 *      defensible instead of mysterious.
 *
 * Deliberately usable more than once. It is a first-run screen, but a company
 * that picked the wrong month on day one has to be able to fix it, and a company
 * that has just imported four hundred staff needs step 3 on its own.
 */
export default function LeaveSetup() {
  const queryClient = useQueryClient();

  const {
    data: state,
    isLoading,
    isError,
    error,
  } = useFetchQuery({
    queryKey: ["leave-setup-state"],
    fetchFn: getLeaveSetupState,
  });
  const setup = state?.newData;

  const [month, setMonth] = useState(null);
  const [picked, setPicked] = useState(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  const chosenMonth = month ?? setup?.leaveYearStartMonth ?? 4;

  // Everything already on file stays ticked — unticking it here would not
  // delete it, so offering that would be a lie.
  const selected = useMemo(() => {
    if (picked) return picked;
    if (!setup) return new Set();
    return new Set(
      setup.catalogue
        .filter((type) => type.required || type.exists)
        .map((type) => type.key)
    );
  }, [picked, setup]);

  const toggle = (key) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  const { data: preview, isFetching: previewing } = useFetchQuery({
    queryKey: ["leave-setup-preview", chosenMonth],
    fetchFn: previewEntitlements,
    params: { month: chosenMonth },
    enabled: Boolean(setup),
  });
  const previewData = preview?.newData;

  const monthChanging =
    Boolean(setup?.configured) && chosenMonth !== setup?.leaveYearStartMonth;

  const save = async () => {
    setSaving(true);
    try {
      const response = await completeLeaveSetup({
        leaveYearStartMonth: chosenMonth,
        leaveTypeKeys: [...selected],
        generateEntitlements: true,
      });
      if (!response?.success) {
        toast.error(response?.message || "Could not save the leave setup");
        return;
      }
      const result = JSON.parse(response.data);
      setDone(result);
      setPicked(null);
      setMonth(null);
      toast.success(
        result.entitlements?.created
          ? `Leave set up — entitlements built for ${result.entitlements.created} employees`
          : "Leave set up"
      );
      // Every leave screen reads one of these.
      for (const key of [
        "leave-setup-state",
        "leave-setup-preview",
        "leave-settings",
        "leave-categories",
        "leave-entitlement",
        "leave-entitlement-sync-status",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch (error) {
      toast.error("Could not save the leave setup");
    } finally {
      setSaving(false);
    }
  };

  // An admin who typed the URL lands here: the tab is super admin only, but a
  // route is not a permission. Says which, rather than spinning forever.
  if (isError) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <ShieldAlert className="mt-0.5 size-5 text-destructive" />
        <div>
          <p className="text-sm font-medium">Leave setup is not available to you</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {error?.message ||
              "Only a super admin can change the leave year and leave types."}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !setup) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading leave setup…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {setup.configured ? (
        <div className="flex items-start gap-3 rounded-lg border p-4">
          <CheckCircle2 className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="text-sm font-medium">Leave is set up</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Your leave year is {setup.leaveYear} —{" "}
              {format(new Date(setup.leaveYearStart), "d MMMM yyyy")} to{" "}
              {format(new Date(setup.leaveYearEnd), "d MMMM yyyy")}. You can add
              leave types or fix the entitlements of new staff from here at any
              time.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 size-5 text-amber-600" />
          <div>
            <p className="text-sm font-medium">Leave is not set up yet</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Leave needs two things before it can count anything: the month your
              leave year starts, and the types of leave your company gives. Until
              then nobody has an entitlement.
            </p>
          </div>
        </div>
      )}

      {setup.staff.missing > 0 && setup.configured && (
        <div className="flex items-start gap-3 rounded-lg border p-4">
          <Users className="mt-0.5 size-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">
              {setup.staff.missing} of {setup.staff.eligible} staff have no
              entitlement for {setup.leaveYear}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Usually staff added or imported since the leave year began. Saving
              below builds theirs, and leaves everybody else&apos;s alone.
            </p>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="size-4" />
            1. When does your leave year start?
          </CardTitle>
          <CardDescription>
            Every entitlement and every booking is measured from this. Most UK
            companies run April to March, matching the tax year; a calendar year
            starts in January.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {setup.months.map((option) => {
              const active = option.value === chosenMonth;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMonth(option.value)}
                  aria-pressed={active}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                    active
                      ? "border-primary/40 bg-primary/5"
                      : "hover:bg-muted/60"
                  }`}
                >
                  <span className="block font-medium">{option.label}</span>
                  {option.hint && (
                    <span className="block text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {previewData && (
            <p className="text-sm text-muted-foreground">
              Your current leave year would be{" "}
              <strong className="text-foreground">{previewData.leaveYear}</strong>{" "}
              — {format(new Date(previewData.leaveYearStart), "d MMM yyyy")} to{" "}
              {format(new Date(previewData.leaveYearEnd), "d MMM yyyy")}.
            </p>
          )}

          {monthChanging && (
            <p className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <span>
                You are moving the leave year from month{" "}
                {setup.leaveYearStartMonth} to {chosenMonth}. Entitlements and
                bookings already recorded stay filed under the old twelve months,
                so balances will look wrong until you rebuild them. Only do this
                if the current setting was a mistake.
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            2. Which types of leave do you give?
          </CardTitle>
          <CardDescription>
            The first five are always on — the leave module needs them, and two
            of them are statutory rights. Everything else is a starting point you
            can edit or remove later on the Category tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            {setup.catalogue.map((type) => {
              const locked = type.required;
              const on = selected.has(type.key);
              return (
                <label
                  key={type.key}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 transition ${
                    on ? "border-primary/30 bg-primary/5" : "hover:bg-muted/40"
                  } ${locked ? "cursor-default" : ""}`}
                >
                  <Checkbox
                    checked={on}
                    disabled={locked || type.exists}
                    onCheckedChange={() => !locked && !type.exists && toggle(type.key)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{type.label}</span>
                      {locked && (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="size-2.5" />
                          required
                        </Badge>
                      )}
                      {type.exists && !locked && (
                        <Badge variant="secondary">already added</Badge>
                      )}
                      {!type.computed && !locked && (
                        <Badge variant="outline">{type.total} days</Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {type.note}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {setup.ownTypes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Your own leave types — {setup.ownTypes.join(", ")} — are untouched
              by this screen.
            </p>
          )}

          <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{setup.halfDayExplanation}</span>
          </p>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            3. What your staff will get
          </CardTitle>
          <CardDescription>
            Annual leave is 5.6 weeks × contracted days a week. Anybody who
            joined part way through the leave year gets the share of it they are
            employed for, counted in days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {previewing && !previewData ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Working it out…
            </p>
          ) : !previewData?.rows?.length ? (
            <p className="text-sm text-muted-foreground">
              No staff on the list yet. Entitlements are built as you add people,
              or all at once after a staff import.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">
                  {previewData.totals.eligible} will get an entitlement
                </Badge>
                {previewData.totals.proRated > 0 && (
                  <Badge variant="outline">
                    {previewData.totals.proRated} pro-rated
                  </Badge>
                )}
                {previewData.totals.alreadyHave > 0 && (
                  <Badge variant="outline">
                    {previewData.totals.alreadyHave} already have one
                  </Badge>
                )}
                {previewData.totals.blocked > 0 && (
                  <Badge variant="destructive">
                    {previewData.totals.blocked} missing details
                  </Badge>
                )}
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="w-28">Started</TableHead>
                      <TableHead className="w-20">Days/week</TableHead>
                      <TableHead className="w-24">Annual leave</TableHead>
                      <TableHead>How</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.rows.map((row) => (
                      <TableRow key={row._id}>
                        <TableCell className="font-medium">
                          {row.name}
                          {row.hasEntitlement && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              (unchanged)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.joinDate
                            ? format(new Date(row.joinDate), "d MMM yyyy")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.dayPerWeek ?? "—"}
                        </TableCell>
                        <TableCell>
                          {row.eligible ? (
                            <span className="font-medium tabular-nums">
                              {row.annualLeave}
                              {row.proRated && (
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  of {row.fullYear}
                                </span>
                              )}
                            </span>
                          ) : (
                            <Badge variant="destructive">none</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.explanation || `Needs ${row.blockedBy}`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {previewData.totals.shown < setup.staff.eligible && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the first {previewData.totals.shown}. All of them are
                  built when you save.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {setup.configured
            ? "Save and build missing entitlements"
            : "Finish leave setup"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Existing entitlements are never overwritten — only people who have none
          for {previewData?.leaveYear || setup.leaveYear} get one.
        </p>
      </div>

      {done && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <p className="font-medium">Saved</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            <li>Leave year: {done.leaveYear}</li>
            {done.created.length > 0 && (
              <li>Leave types created: {done.created.join(", ")}</li>
            )}
            {done.skipped.length > 0 && (
              <li>Already existed: {done.skipped.join(", ")}</li>
            )}
            {done.entitlements && (
              <li>
                Entitlements built: {done.entitlements.created} · already had one:{" "}
                {done.entitlements.skipped} · missing details:{" "}
                {done.entitlements.notEligible}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
