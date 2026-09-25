"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Hours worked over the last fortnight.
 *
 * Replaces an interactive area chart that plotted TOTAL HOURS AND TOTAL PAY ON
 * ONE AXIS. Hours and pounds are different units; a line where one is a
 * thousand times the other is a flat line and a spiky one sharing a scale that
 * describes neither. And pay does not belong on an attendance dashboard at
 * all — the people who need it look at payroll, and the people who look at
 * this do not need it on screen when somebody walks past.
 *
 * So: hours only, two weeks, and bars rather than an area. Fourteen values
 * with weekends in them are a pattern to recognise, not a trend to
 * interpolate, and an area chart draws a slope between Friday and Monday that
 * nobody worked.
 */

const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

export default function HoursTrend({ dayData = [] }) {
  const days = React.useMemo(() => {
    const byDate = new Map(
      (dayData || [])
        .filter((d) => d?.date)
        .map((d) => [
          new Date(d.date).toISOString().slice(0, 10),
          Number(d.TotalHours) || 0,
        ]),
    );

    // Built forward from a fixed start rather than filtered from the data, so
    // a day nobody worked is a gap in the row instead of being missing from
    // it. An absent Tuesday that simply is not drawn reads as a short week.
    const out = [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 13);

    for (let i = 0; i < 14; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const key = day.toISOString().slice(0, 10);
      out.push({
        key,
        hours: byDate.get(key) || 0,
        weekday: day.getDay(),
        label: day.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      });
    }
    return out;
  }, [dayData]);

  const peak = Math.max(...days.map((d) => d.hours), 1);
  const total = days.reduce((t, d) => t + d.hours, 0);
  const thisWeek = days.slice(7).reduce((t, d) => t + d.hours, 0);
  const lastWeek = days.slice(0, 7).reduce((t, d) => t + d.hours, 0);
  const change = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Hours worked</CardTitle>
        <CardDescription>
          {Math.round(total)} hours over the last fortnight
          {change !== null ? (
            <>
              {" · "}
              <span
                className={
                  change > 0
                    ? "text-green-700"
                    : change < 0
                      ? "text-amber-700"
                      : ""
                }
              >
                {change > 0 ? "+" : ""}
                {change}% on the week before
              </span>
            </>
          ) : null}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex h-28 items-end gap-1">
          {days.map((day) => {
            const weekend = day.weekday === 0 || day.weekday === 6;
            return (
              <div
                key={day.key}
                className="group flex flex-1 flex-col items-center gap-1"
                title={`${day.label}: ${Math.round(day.hours)} hours`}
              >
                <div className="flex h-24 w-full items-end">
                  <div
                    className={`w-full rounded-t transition-colors ${
                      // Weekends are drawn lighter rather than hidden: a
                      // Saturday with hours on it is worth seeing, and one
                      // without still marks where the week breaks.
                      weekend
                        ? "bg-neutral-200 group-hover:bg-neutral-300"
                        : "bg-indigo-500 group-hover:bg-indigo-600"
                    }`}
                    style={{
                      height: `${day.hours > 0 ? Math.max(4, (day.hours / peak) * 100) : 2}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {DAY_LETTER[day.weekday]}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
