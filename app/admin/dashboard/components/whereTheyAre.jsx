"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, HardHat } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery } from "@/hooks/use-query";
import { getAttendancePulse } from "@/server/dashboardServer/attendancePulse";

/**
 * Where people actually are, right now.
 *
 * This replaces a table of who clocked in, and it answers a different and
 * better question. A list of names and times is a thing to read; a breakdown
 * by place is a thing to notice — twelve at Head Office and nobody at Elm
 * Street on a day Elm Street is supposed to be running tells somebody
 * something, and a table of twelve rows does not.
 *
 * It is also the report this codebase could not produce until recently. Every
 * office record was `siteId: null`, so a company with two offices had one
 * indistinguishable blur and "how many at each" had no answer at all.
 *
 * Bars rather than a chart library: there are as many rows as the company has
 * places, the numbers are small, and a proportion drawn as a filled width is
 * read faster than an axis.
 */
export default function WhereTheyAre() {
  // The same query key the tile row uses. React Query serves both from one
  // request, so this costs nothing extra and cannot drift out of step with
  // the numbers above it — which passing the data down as a prop would have
  // avoided too, at the price of threading it through the page.
  const { data } = useFetchQuery({
    queryKey: ["attendancePulse"],
    fetchFn: getAttendancePulse,
    refetchInterval: 120_000,
  });

  const pulse = data?.newData;
  const locations = pulse?.locations || [];
  const here = (pulse?.working || 0) + (pulse?.onBreak || 0);
  const most = locations.length ? locations[0].total : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Where people are</CardTitle>
            <CardDescription>
              {here === 0
                ? "Nobody is clocked in"
                : `${here} ${here === 1 ? "person" : "people"} across ${
                    locations.length
                  } ${locations.length === 1 ? "place" : "places"}`}
            </CardDescription>
          </div>
          <Link
            href="/admin/clockSettings"
            className="inline-flex items-center gap-0.5 text-xs text-indigo-600 hover:underline"
          >
            Locations <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </CardHeader>

      <CardContent>
        {!locations.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nobody has clocked in yet today.
          </p>
        ) : (
          <ul className="space-y-3">
            {locations.map((place) => (
              <li key={place.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {place.kind === "site" ? (
                      <HardHat className="size-3.5 shrink-0 text-amber-600" />
                    ) : (
                      <Building2 className="size-3.5 shrink-0 text-indigo-600" />
                    )}
                    <span className="truncate">{place.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <strong>{place.working}</strong>
                    {place.onBreak ? (
                      <span className="ml-1.5 text-xs text-amber-700">
                        +{place.onBreak} on a break
                      </span>
                    ) : null}
                  </span>
                </div>
                {/* Widths are relative to the busiest place rather than to the
                    headcount: with four people spread over three sites, bars
                    scaled against the whole company are three slivers that
                    compare nothing. */}
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-indigo-500"
                    style={{
                      width: `${most ? Math.max(6, (place.total / most) * 100) : 0}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
