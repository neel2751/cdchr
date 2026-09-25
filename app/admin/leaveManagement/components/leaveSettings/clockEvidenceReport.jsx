"use client";

import React from "react";
import { Building2, HardHat, Loader2, MapPin } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchSelectQuery } from "@/hooks/use-query";
import { getClockEvidenceReport } from "@/server/clockServer/evidenceReport";

/**
 * What turning a location rule on would cost.
 *
 * Nothing is enforced yet — every clock-in records what each configured method
 * *would* have decided, and this reads those verdicts back. It exists so a
 * geofence radius is chosen from what actually happens at a place rather than
 * from a number that sounds about right, because a radius set too tight does
 * not produce a warning: it produces somebody standing outside a cabin at 7am
 * unable to start work.
 */
export default function ClockEvidenceReport() {
  const { data, isLoading } = useFetchSelectQuery({
    queryKey: ["clockEvidenceReport"],
    fetchFn: getClockEvidenceReport,
  });

  const locations = data?.locations || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where People Clock In</CardTitle>
        <CardDescription>
          The last 30 days. Nothing here is being enforced — this is what the
          rules <em>would</em> have decided, so you can see the cost of turning
          one on before anybody is turned away by it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-neutral-400" />
          </div>
        ) : locations.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-neutral-500">
            No clock-ins with evidence yet. This fills in as people clock in
            from their phones — give it a few days before reading anything into
            it.
          </p>
        ) : (
          <div className="space-y-4">
            {locations.map((loc) => {
              const positionRate = loc.scans
                ? Math.round((loc.withPosition / loc.scans) * 100)
                : 0;

              return (
                <div key={loc.locationId || "none"} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium">
                      {loc.kind === "site" ? (
                        <HardHat className="size-4 text-amber-600" />
                      ) : (
                        <Building2 className="size-4 text-indigo-600" />
                      )}
                      {loc.name}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {loc.scans} clock-in{loc.scans === 1 ? "" : "s"} ·{" "}
                      {positionRate}% sent a position
                      {loc.medianAccuracyMetres != null
                        ? ` · typically accurate to ±${loc.medianAccuracyMetres}m`
                        : ""}
                    </span>
                  </div>

                  {loc.wouldRefuse > 0 ? (
                    <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      {loc.wouldRefuse} of {loc.scans} would have been refused
                      if the current rules were enforced.
                    </p>
                  ) : null}

                  {Object.keys(loc.methods || {}).length ? (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-600">
                      {Object.entries(loc.methods).map(([name, m]) => (
                        <span key={name} className="rounded bg-neutral-100 px-2 py-1">
                          <span className="font-medium">{name}</span> · {m.pass}{" "}
                          pass / {m.fail} fail
                          {m.unknown ? ` / ${m.unknown} couldn't tell` : ""}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-neutral-500">
                      No rules set up for this location yet.
                    </p>
                  )}

                  {/* The decision support. "150m sounds right" is a guess;
                      "250m would have admitted 99% of what we actually saw"
                      is not. */}
                  {loc.radiusOptions?.length ? (
                    <div className="mt-3 space-y-1">
                      <p className="flex items-center gap-1 text-xs font-medium text-neutral-700">
                        <MapPin className="size-3" />
                        Distance from the geofence centre ({loc.distance.count}{" "}
                        scans: {loc.distance.min}m–{loc.distance.max}m, median{" "}
                        {loc.distance.median}m)
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {loc.radiusOptions.map((opt) => (
                          <span
                            key={opt.radius}
                            className={`rounded px-2 py-0.5 text-[11px] ${
                              opt.percent >= 99
                                ? "bg-green-100 text-green-800"
                                : opt.percent >= 90
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-neutral-100 text-neutral-600"
                            }`}
                            title={`${opt.admitted} of ${loc.distance.count} scans`}
                          >
                            {opt.radius}m → {opt.percent}%
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {loc.noEvidence > 0 ? (
                    <p className="mt-2 text-xs text-neutral-500">
                      {loc.noEvidence} clock-in
                      {loc.noEvidence === 1 ? "" : "s"} arrived with nothing to
                      judge — usually a declined location permission. Those are
                      never refused; they say nothing about where the person
                      was.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
