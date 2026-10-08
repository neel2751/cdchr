"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toDayKey } from "@/lib/bankHolidays";
import { useBankHolidayRule } from "@/lib/holiday";
import { holidayPlannerNew } from "@/server/leaveServer/getLeaveServer";
import PlannerDay from "./holiday-planner/plannerDay";
import { leaveTone } from "./holiday-planner/leaveTone";
import {
  MONTHS,
  WEEKDAYS,
  buildWeeks,
  dateKeyOf,
  isWeekend,
  toDateKey,
} from "./holiday-planner/plannerGrid";

/** How far back and forward the month picker reaches. */
const YEAR_SPAN = 2;

/**
 * Who is off, when.
 *
 * WHAT THIS REWRITE FIXED, beyond the look of it:
 *
 *   · The week started on SUNDAY. This is a UK app — `dayPerWeek`, the weekly
 *     rota and every leave calculation treat Monday as the start of the week —
 *     so the planner split the weekend across both ends of the row and nobody
 *     could see a working week as a block.
 *   · Weekends looked exactly like Wednesdays, which is noise on the one screen
 *     whose entire job is "which working days are covered".
 *   · BANK HOLIDAYS WERE NOT SHOWN AT ALL, despite the company already having a
 *     region setting, a published list and lib/bankHolidays.js to read it. A
 *     holiday planner that cannot show the public holidays is missing the thing
 *     people open it for.
 *   · A busy day grew the cell and pushed its week out of alignment — see
 *     plannerDay.jsx.
 *   · Getting to next June took eight presses of a chevron.
 *   · An empty month and a month still loading looked identical: blank.
 *
 * The data source is unchanged (holidayPlannerNew), including the deliberate
 * "yyyy-MM-dd" keys — see toDateKey below.
 */

export default function HolidayPlannerCalendar() {
  const today = new Date();
  const [cursor, setCursor] = React.useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  // Which leave types to show. Empty means all of them — the same
  // "empty is everything" default the carry-forward rules use.
  const [hiddenTypes, setHiddenTypes] = React.useState([]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const weeks = React.useMemo(() => buildWeeks(year, month), [year, month]);

  // The grid shows a few days either side of the month, so the request covers
  // them too — otherwise the overflow cells are always empty and a leave
  // starting on the 29th of last month shows nothing on the 1st.
  const rangeStart = weeks[0][0];
  const rangeEnd = weeks[5][6];

  const { data: plannerData = {}, isLoading } = useQuery({
    queryKey: ["holiday-planner", year, month],
    queryFn: async () => {
      // Sent as plain yyyy-MM-dd so the range cannot drift across the
      // client/server timezone boundary — passing Date objects previously
      // dropped the last day of the month during British Summer Time.
      const response = await holidayPlannerNew({
        startDate: toDateKey(
          rangeStart.getFullYear(),
          rangeStart.getMonth(),
          rangeStart.getDate()
        ),
        endDate: toDateKey(
          rangeEnd.getFullYear(),
          rangeEnd.getMonth(),
          rangeEnd.getDate()
        ),
      });
      return response?.success ? JSON.parse(response.data) : {};
    },
    // A month's bookings do not change second to second, and moving back and
    // forth through the year should not refetch what was just shown.
    staleTime: 1000 * 60,
  });

  const { observes, holidays } = useBankHolidayRule();

  /**
   * Day key → holiday name.
   *
   * Built here rather than calling `holidayTitleFor(date, holidays)` per cell:
   * that walks the whole published list for each of forty-two days, and a Set
   * cannot be passed to it — it reads `entry.title`, which a Set of day keys
   * does not have, so every lookup would come back null and no bank holiday
   * would ever show.
   */
  const holidayTitles = React.useMemo(() => {
    const map = new Map();
    for (const entry of holidays || []) {
      const key = toDayKey(entry?.date ?? entry);
      if (key !== null) map.set(key, entry?.title || "Bank holiday");
    }
    return map;
  }, [holidays]);

  // `observes` is false before the settings have arrived, so the note below
  // would flash on every load. The published list landing is the signal that
  // the answer is real.
  const holidayRuleKnown = (holidays || []).length > 0;

  /** Every leave type present this month, for the filter row. */
  const typesPresent = React.useMemo(() => {
    const found = new Set();
    for (const key of Object.keys(plannerData)) {
      for (const leave of plannerData[key] || []) {
        if (leave?.leaveType) found.add(leave.leaveType);
      }
    }
    return [...found].sort();
  }, [plannerData]);

  const leavesFor = (date) => {
    const all = plannerData[dateKeyOf(date)] || [];
    if (!hiddenTypes.length) return all;
    return all.filter((leave) => !hiddenTypes.includes(leave.leaveType));
  };

  /**
   * How many people are off this month, and the busiest day.
   *
   * Distinct employees, not person-days: "14 people off in June" is the useful
   * figure, and counting rows would say 58 because a two-week absence appears
   * on ten of them.
   */
  const summary = React.useMemo(() => {
    const people = new Set();
    let busiestCount = 0;
    let busiestDate = null;

    for (const week of weeks) {
      for (const date of week) {
        if (date.getMonth() !== month) continue;
        const leaves = leavesFor(date);
        for (const leave of leaves) {
          if (leave?.employeeId) people.add(String(leave.employeeId));
        }
        if (leaves.length > busiestCount) {
          busiestCount = leaves.length;
          busiestDate = date;
        }
      }
    }
    return { people: people.size, busiestCount, busiestDate };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannerData, hiddenTypes, weeks, month]);

  const years = [];
  for (let offset = -YEAR_SPAN; offset <= YEAR_SPAN; offset++) {
    years.push(today.getFullYear() + offset);
  }

  const step = (by) => setCursor(new Date(year, month + by, 1));
  const isThisMonth =
    year === today.getFullYear() && month === today.getMonth();

  const toggleType = (type) =>
    setHiddenTypes((current) =>
      current.includes(type)
        ? current.filter((value) => value !== type)
        : [...current, type]
    );

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Holiday planner</CardTitle>
            <CardDescription>
              Approved leave across the company, with bank holidays.
            </CardDescription>
          </div>

          {/* Month and year as pickers rather than only arrows: reaching next
              June used to be eight presses of a chevron. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => step(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft />
            </Button>

            <Select
              value={String(month)}
              onValueChange={(value) => setCursor(new Date(year, Number(value), 1))}
            >
              <SelectTrigger className="w-[8.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, index) => (
                  <SelectItem key={name} value={String(index)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={String(year)}
              onValueChange={(value) => setCursor(new Date(Number(value), month, 1))}
            >
              <SelectTrigger className="w-[5.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={() => step(1)}
              aria-label="Next month"
            >
              <ChevronRight />
            </Button>

            <Button
              variant={isThisMonth ? "secondary" : "outline"}
              onClick={() =>
                setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
              }
              disabled={isThisMonth}
            >
              Today
            </Button>
          </div>
        </div>

        {/* What the month actually looks like, in one line. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" />
            {isLoading ? (
              <Skeleton className="h-3 w-24" />
            ) : summary.people === 0 ? (
              "Nobody off this month"
            ) : (
              <>
                <strong className="text-foreground">{summary.people}</strong>{" "}
                {summary.people === 1 ? "person" : "people"} off
              </>
            )}
          </span>

          {!isLoading && summary.busiestDate && summary.busiestCount > 1 && (
            <span className="flex items-center gap-1.5">
              <CalendarRange className="size-3.5" />
              Busiest: {summary.busiestDate.getDate()} {MONTHS[month].slice(0, 3)}{" "}
              <strong className="text-foreground">
                ({summary.busiestCount} off)
              </strong>
            </span>
          )}

          {holidayRuleKnown && !observes && (
            <span>Bank holidays are worked at this company.</span>
          )}
        </div>

        {/* A legend that is also the filter — clicking a type hides it. With
            eleven leave types in the starter catalogue, "what colour is that"
            and "show me only sick leave" are the same question. */}
        {typesPresent.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {typesPresent.map((type) => {
              const tone = leaveTone(type);
              const hidden = hiddenTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  aria-pressed={!hidden}
                  title={hidden ? `Show ${type}` : `Hide ${type}`}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition ${
                    hidden
                      ? "text-muted-foreground/60 line-through"
                      : "hover:bg-muted"
                  }`}
                >
                  <span
                    className={`size-2 rounded-full ${tone.dot} ${
                      hidden ? "opacity-30" : ""
                    }`}
                  />
                  {type}
                </button>
              );
            })}
            {hiddenTypes.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => setHiddenTypes([])}
              >
                Show all
              </Button>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((day, index) => (
            <div
              key={day}
              className={`rounded-md py-1 text-center text-xs font-medium ${
                // Saturday and Sunday are the last two columns now, so the
                // working week reads as one block.
                index >= 5
                  ? "bg-muted/60 text-muted-foreground"
                  : "bg-muted/30 text-foreground"
              }`}
            >
              {day}
            </div>
          ))}

          {isLoading
            ? // A month still loading and a month with nobody off used to look
              // identical: blank.
              Array.from({ length: 42 }).map((_, index) => (
                <Skeleton key={index} className="h-[128px] rounded-lg" />
              ))
            : weeks.flat().map((date) => (
                <PlannerDay
                  key={dateKeyOf(date)}
                  date={date}
                  leaves={leavesFor(date)}
                  isToday={date.toDateString() === today.toDateString()}
                  isWeekend={isWeekend(date)}
                  isOutsideMonth={date.getMonth() !== month}
                  bankHoliday={holidayTitles.get(toDayKey(date)) || null}
                  observesBankHolidays={observes}
                />
              ))}
        </div>

        {!isLoading && summary.people === 0 && (
          <div className="mt-4 rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm font-medium">
              No approved leave in {MONTHS[month]} {year}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hiddenTypes.length
                ? "Some leave types are hidden — show them to check."
                : "Requests appear here once they are approved."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
