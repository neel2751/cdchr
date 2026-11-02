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

/** 7.43 -> "7h 26m". Rounded to whole hours it read "7 hours" for 7h 26m. */
function formatHours(hours) {
  const minutes = Math.round(hours * 60);
  if (minutes === 0) return "No hours";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function HoursTrend({ dayData = [] }) {
  // The server sends every one of the fourteen days, a day nobody worked
  // included, so an absent Tuesday is a gap rather than a short week. See
  // getHoursLastFortnight.
  //
  // Each date is a UK working day and is read as UTC. Building the days here
  // from local midnight and calling toISOString() moved every bar back a day
  // during BST, when local midnight is 23:00 the evening before.
  const days = React.useMemo(
    () =>
      (dayData || [])
        .filter((d) => d?.date)
        .map((d) => {
          const day = new Date(`${d.date}T00:00:00Z`);
          return {
            key: d.date,
            hours: Number(d.TotalHours) || 0,
            weekday: day.getUTCDay(),
            isToday: Boolean(d.isToday),
            openShifts: Number(d.openShifts) || 0,
            label: day.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            }),
          };
        }),
    [dayData],
  );

  // The bar being pointed at, focused or tapped. It was a `title` attribute:
  // a second's wait for a browser tooltip that never appears on a phone or
  // for a keyboard, so most people hovered, saw nothing, and could not tell
  // what a bar was worth.
  const [activeIndex, setActiveIndex] = React.useState(null);
  const active = activeIndex === null ? null : days[activeIndex];

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
        <div
          className="relative pt-14"
          onMouseLeave={() => setActiveIndex(null)}
        >
          {active ? (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
              style={{
                left: `${((activeIndex + 0.5) / days.length) * 100}%`,
                // Centred over its bar, except at the ends, where centring
                // would push it out of the card.
                transform: `translateX(${
                  activeIndex < 2 ? "-15%" : activeIndex > days.length - 3 ? "-85%" : "-50%"
                })`,
              }}
            >
              <p className="text-sm font-semibold tabular-nums">
                {formatHours(active.hours)}
                {active.isToday && active.hours > 0 ? " so far" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {active.isToday ? `Today, ${active.label}` : active.label}
                {active.isToday && active.openShifts > 0
                  ? ` · ${active.openShifts} still clocked in`
                  : ""}
              </p>
            </div>
          ) : null}

          <div className="relative flex items-end gap-1">
            {/* A scale for the bars. Without one the tallest bar is always
                full height whatever it is worth, and a fortnight of 3 hours
                looks the same as a fortnight of 300. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-neutral-200">
              <span className="absolute bottom-full right-0 mb-0.5 text-[10px] tabular-nums text-muted-foreground">
                {formatHours(peak)}
              </span>
            </div>

            {days.map((day, index) => {
              const weekend = day.weekday === 0 || day.weekday === 6;
              const isActive = index === activeIndex;
              return (
                <button
                  key={day.key}
                  type="button"
                  className="flex flex-1 flex-col items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${day.isToday ? "Today, " : ""}${day.label}: ${formatHours(day.hours)}${day.isToday && day.hours > 0 ? " so far" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex(null)}
                  // A tap on a phone, where there is no hover.
                  onClick={() => setActiveIndex(index)}
                >
                  <div className="flex h-24 w-full items-end">
                    <div
                      className={`w-full rounded-t transition-colors ${
                        // Weekends are drawn lighter rather than hidden: a
                        // Saturday with hours on it is worth seeing, and one
                        // without still marks where the week breaks.
                        weekend
                          ? isActive
                            ? "bg-neutral-300"
                            : "bg-neutral-200"
                          : isActive
                            ? "bg-indigo-700"
                            : "bg-indigo-500"
                      }`}
                      style={{
                        height: `${day.hours > 0 ? Math.max(4, (day.hours / peak) * 100) : 2}%`,
                      }}
                    />
                  </div>
                  <span
                    className={`text-[10px] ${
                      day.isToday
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {DAY_LETTER[day.weekday]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
