"use client";

import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CircleCheck,
  Coffee,
  Loader2,
  Palmtree,
  UserRound,
  UserRoundX,
} from "lucide-react";

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
 * Today, at the top of the dashboard.
 *
 * The dashboard used to open with three headcount cards — total staff, active,
 * inactive — which are facts about the payroll and do not change from one week
 * to the next. Nobody opens a dashboard at nine in the morning to find out how
 * many people the company employs.
 *
 * They open it to find out who is in. So that goes first, at the size of an
 * answer, and the standing totals move below it.
 *
 * The attention strip underneath only appears when there is something in it.
 * A dashboard that permanently reads "0 needing review" trains people to stop
 * looking at the number, which is the opposite of what a flag is for.
 */

const TILES = [
  {
    key: "working",
    label: "Working",
    Icon: UserRound,
    tone: "text-green-700",
    ring: "border-green-200 bg-green-50",
  },
  {
    key: "onBreak",
    label: "On a break",
    Icon: Coffee,
    tone: "text-amber-700",
    ring: "border-amber-200 bg-amber-50",
  },
  {
    key: "onLeave",
    label: "On leave",
    Icon: Palmtree,
    tone: "text-sky-700",
    ring: "border-sky-200 bg-sky-50",
  },
  {
    key: "finished",
    label: "Finished",
    Icon: CircleCheck,
    tone: "text-neutral-600",
    ring: "border-neutral-200 bg-neutral-50",
  },
  {
    key: "notIn",
    label: "Not in yet",
    Icon: UserRoundX,
    tone: "text-neutral-600",
    ring: "border-neutral-200 bg-neutral-50",
  },
];

export default function AttendanceToday() {
  const { data, isLoading } = useFetchQuery({
    queryKey: ["attendancePulse"],
    fetchFn: getAttendancePulse,
    // A dashboard left open all morning should not be showing nine o'clock's
    // numbers at eleven.
    refetchInterval: 120_000,
  });

  const pulse = data?.newData;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-28 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-neutral-400" />
        </CardContent>
      </Card>
    );
  }
  if (!pulse) return null;

  const attention = [
    pulse.needsReview > 0 && {
      key: "review",
      text: `${pulse.needsReview} of today's records need checking`,
      href: "/admin/attendance",
    },
    pulse.stillOpen > 0 && {
      key: "open",
      text: `${pulse.stillOpen} shift${pulse.stillOpen === 1 ? "" : "s"} from an earlier day were never clocked out`,
      href: "/admin/attendance",
    },
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Right now</CardTitle>
            <CardDescription>
              {pulse.staff} active {pulse.staff === 1 ? "person" : "people"} on
              the books
            </CardDescription>
          </div>
          <Link
            href="/admin/attendance"
            className="inline-flex items-center gap-0.5 text-xs text-indigo-600 hover:underline"
          >
            Attendance board <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {TILES.map(({ key, label, Icon, tone, ring }) => (
            <div key={key} className={`rounded-lg border p-3 ${ring}`}>
              <div className="flex items-center gap-1.5">
                <Icon className={`size-3.5 ${tone}`} />
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>
                {pulse[key]}
              </p>
            </div>
          ))}
        </div>

        {attention.length ? (
          <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3">
            {attention.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center gap-2 text-sm text-amber-900 hover:underline"
              >
                <AlertTriangle className="size-4 shrink-0" />
                {item.text}
                <ArrowUpRight className="size-3.5 shrink-0" />
              </Link>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
