"use client";

import React from "react";
import {
  CircleAlert,
  CloudOff,
  Loader2,
  Nfc,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getClockAnomalies } from "@/server/clockServer/anomalyReport";

/**
 * Everything the system noticed and could not decide on its own.
 *
 * Each phase of this work produced a signal and then left it in the database —
 * shifts nobody clocked out of, breaks left open, clock-ins a rule would have
 * refused, tags tapping from the wrong place. All visible if you know where to
 * look, which means in practice nobody looks.
 *
 * Ordered by what it costs to ignore: pay first, then hardware, then rules.
 */
export default function ClockAnomalies() {
  const { data, isLoading } = useFetchSelectQuery({
    queryKey: ["clockAnomalies"],
    fetchFn: getClockAnomalies,
  });

  const needsReview = data?.needsReview || [];
  const refused = data?.refused || [];
  const tagsElsewhere = data?.tagsElsewhere || [];
  const nothing =
    !isLoading &&
    !needsReview.length &&
    !refused.length &&
    !tagsElsewhere.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-amber-600" />
          Needs Attention
        </CardTitle>
        <CardDescription>
          The last 30 days. Anything the system spotted but could not settle on
          its own — most of it costs money if it is left alone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : nothing ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-neutral-500">
            Nothing outstanding. Shifts are closing properly, no rule is turning
            anybody away, and every tag is tapping where it should be.
          </p>
        ) : (
          <div className="space-y-5">
            {/* Pay first: an unclosed shift contributes nothing to somebody's
                hours, and an unfinished break deducts nothing from them. */}
            {needsReview.length ? (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <TriangleAlert className="size-3.5 text-red-600" />
                  {needsReview.length} attendance record
                  {needsReview.length === 1 ? "" : "s"} to settle
                  <span className="font-normal text-neutral-500">
                    — before payroll
                  </span>
                </p>
                {needsReview.slice(0, 8).map((r) => (
                  <div
                    key={r._id}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded border px-2 py-1.5 text-xs"
                  >
                    <span>
                      <strong>{r.name}</strong>{" "}
                      <span className="text-neutral-500">
                        {new Date(r.date).toLocaleDateString("en-GB")} ·{" "}
                        {r.location} · {r.clockIn || "--"}–{r.clockOut || "--"}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-amber-700">
                      {/* Recorded with no signal. Worth its own mark: the time
                          on it came from a phone, not from us, which is the
                          only reason it needs confirming at all. */}
                      {r.offline ? (
                        <CloudOff
                          className="size-3 flex-none"
                          title={
                            r.offline.driftMinutes != null
                              ? `Reached us ${r.offline.driftMinutes} minutes later`
                              : "Recorded offline"
                          }
                        />
                      ) : null}
                      {r.reason}
                    </span>
                  </div>
                ))}
                {needsReview.length > 8 ? (
                  <p className="text-xs text-neutral-500">
                    …and {needsReview.length - 8} more. Fix them on the
                    attendance screen.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Hardware: a tag in the wrong place is either cloned or moved. */}
            {tagsElsewhere.length ? (
              <div className="space-y-1.5 border-t pt-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Nfc className="size-3.5 text-red-600" />
                  {tagsElsewhere.length} tag
                  {tagsElsewhere.length === 1 ? "" : "s"} tapping somewhere else
                </p>
                <p className="text-xs text-neutral-500">
                  Either the tag was moved without being reassigned, or it has
                  been copied. Suspend it if you did not move it.
                </p>
                {tagsElsewhere.map((t) => (
                  <div
                    key={t._id}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs"
                  >
                    <span>
                      <strong>{t.label}</strong>{" "}
                      <span className="text-neutral-500">{t.uid}</span>
                    </span>
                    <span className="text-red-700">
                      bound to {t.boundTo}, last tapped at {t.seenAt}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Rules last: while a location is only measuring these are free
                information, and the wording has to say which. */}
            {refused.length ? (
              <div className="space-y-1.5 border-t pt-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <CircleAlert className="size-3.5 text-amber-600" />
                  Clock-ins a rule did not accept
                </p>
                {refused.map((r) => (
                  <div
                    key={r.locationId || r.name}
                    className={`flex flex-wrap items-baseline justify-between gap-2 rounded border px-2 py-1.5 text-xs ${
                      r.enforcing ? "border-amber-300 bg-amber-50" : ""
                    }`}
                  >
                    <span>
                      <strong>{r.name}</strong> — {r.count} clock-in
                      {r.count === 1 ? "" : "s"}
                    </span>
                    <span
                      className={r.enforcing ? "text-amber-800" : "text-neutral-500"}
                    >
                      {r.enforcing
                        ? "refused — these people could not start work"
                        : "measuring only — nobody was turned away"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
