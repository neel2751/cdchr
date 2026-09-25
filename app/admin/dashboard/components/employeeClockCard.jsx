"use client";

import React from "react";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { format } from "date-fns";
import {
  AlertTriangle,
  Clock4,
  Coffee,
  Loader2,
  LogOut,
  Palmtree,
  TimerOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CLOCK_STATUS, deriveClockStatus } from "@/lib/clockStatus";
import { diffMinutes, getClockTime } from "@/lib/clockTime";
import { describeMinutes } from "@/lib/clockRules";
import { useFetchQuery } from "@/hooks/use-query";
import { fetchLiveOfficeClock } from "@/server/timeOffServer/timeOffServer";
import { SiteEmployeeScannerDialog } from "@/app/hr/employeeScan/page";

/**
 * An employee's own clock, on their dashboard.
 *
 * The old version showed four grey boxes reading "Clock In --", "Break In --",
 * and so on, with the whole status card commented out above a row of buttons.
 * Four dashes do not answer the question somebody actually opens this page to
 * ask, which is "am I clocked in, and for how long".
 *
 * So the shape here follows that question:
 *
 *   1. ARE YOU WORKING — one line, in words, at the size of a headline.
 *   2. FOR HOW LONG — counted up live, because a number that only moves on a
 *      refresh gets refreshed.
 *   3. WHAT CAN YOU DO NEXT — the legal actions and nothing else. The old code
 *      already worked this out correctly; it was just rendered last.
 *   4. WHAT HAPPENED TODAY — the breaks, in order, so a forgotten break-out is
 *      visible to the person who can still explain it.
 *
 * WHAT THIS DOES NOT ADD is a way to clock in without proving you are there.
 * Every action still goes through the scanner dialog and the location policy
 * behind it. A button that recorded attendance on somebody's word would be a
 * nicer screen and a worse system, and it would quietly undo the whole point
 * of the codes, the geofence and the tags.
 */

const ACTION_LABEL = {
  clockIn: { label: "Clock in", Icon: Clock4 },
  breakIn: { label: "Take a break", Icon: Coffee },
  breakOut: { label: "Back from break", Icon: TimerOff },
  clockOut: { label: "Clock out", Icon: LogOut },
};

/** The actions the record allows, in the order somebody would want them. */
function availableActions(record) {
  if (!record?.clockIn) return ["clockIn"];

  const breaks = record.breaks || [];
  const open = breaks.length ? breaks[breaks.length - 1] : null;
  if (open && open.breakIn && !open.breakOut) return ["breakOut"];
  if (!record.clockOut) return ["breakIn", "clockOut"];
  return [];
}

/**
 * Minutes worked so far: the span to now, less every finished break.
 *
 * An open break is deliberately not deducted while it is running — the clock
 * on screen stops moving instead, which is what somebody standing there
 * expects to see, and the total corrects itself the moment they come back.
 */
function workedSoFar(record, nowTime) {
  if (!record?.clockIn) return null;

  const end = record.clockOut || nowTime;
  const span = diffMinutes(record.clockIn, end);
  if (span === null) return null;

  const breaks = record.breaks || [];
  let deducted = 0;
  let onBreakSince = null;
  for (const br of breaks) {
    if (br?.breakIn && br?.breakOut) {
      deducted += diffMinutes(br.breakIn, br.breakOut) || 0;
    } else if (br?.breakIn) {
      onBreakSince = br.breakIn;
    }
  }

  if (onBreakSince) {
    // Frozen at the moment the break started.
    const upToBreak = diffMinutes(record.clockIn, onBreakSince);
    return Math.max(0, (upToBreak ?? 0) - deducted);
  }
  return Math.max(0, span - deducted);
}

export default function EmployeeClockCard() {
  const { data: session } = useSession();
  const employeeId = session?.user?._id;

  const queryClient = useQueryClient();
  const [action, setAction] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // The codebase's own fetching hook rather than a hand-rolled effect. The
  // first draft here loaded in a useEffect, which React flags as a cascading
  // render and which this app had already solved everywhere else.
  const { data, isLoading } = useFetchQuery({
    queryKey: ["myClockToday", employeeId],
    fetchFn: fetchLiveOfficeClock,
    params: { employeeId },
    enabled: Boolean(employeeId),
  });
  const record = data?.newData || null;
  const loading = isLoading;

  const load = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["myClockToday", employeeId] }),
    [queryClient, employeeId],
  );

  // Ticks once a minute so the elapsed figure moves on its own. A number that
  // only updates on a refresh is a number people refresh the page for.
  const [now, setNow] = React.useState(() => getClockTime());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(getClockTime()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // The same socket the reception screen emits on, so a scan at the desk
  // updates this card without anybody refreshing.
  React.useEffect(() => {
    if (!employeeId) return;
    const socket = io({ withCredentials: true });
    socket.on("refresh-clock-table", (id) => {
      if (id === employeeId) load();
    });
    return () => socket.disconnect();
  }, [employeeId, load]);

  const status = deriveClockStatus(record);
  const actions = availableActions(record);
  const worked = workedSoFar(record, now);
  const openBreak = (record?.breaks || []).find((b) => b?.breakIn && !b?.breakOut);

  const headline = record?.onLeave
    ? { text: `On ${record.leaveType || "leave"} today`, tone: "text-sky-700" }
    : status === CLOCK_STATUS.ON_BREAK
      ? { text: `On a break since ${openBreak?.breakIn}`, tone: "text-amber-700" }
      : status === CLOCK_STATUS.CHECKED_IN
        ? { text: `Working since ${record.clockIn}`, tone: "text-green-700" }
        : record?.clockOut
          ? { text: `Finished at ${record.clockOut}`, tone: "text-neutral-600" }
          : { text: "Not clocked in yet", tone: "text-neutral-600" };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-neutral-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                {session?.user?.name
                  ? `${session.user.name.split(" ")[0]}'s day`
                  : "Your day"}
              </CardTitle>
              <CardDescription>
                {format(new Date(), "EEEE d MMMM")}
              </CardDescription>
            </div>
            {record?.needsReview ? (
              <span
                className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900"
                title={record.reviewReason}
              >
                <AlertTriangle className="size-3.5" />
                Needs checking
              </span>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* The question people open this page to ask, answered at the size
              of an answer rather than as four dashes in a grey box. */}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={`text-xl font-semibold ${headline.tone}`}>
              {record?.onLeave ? (
                <span className="flex items-center gap-2">
                  <Palmtree className="size-5" />
                  {headline.text}
                </span>
              ) : (
                headline.text
              )}
            </p>
            {worked !== null ? (
              <p className="text-sm text-muted-foreground">
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {describeMinutes(worked)}
                </span>{" "}
                {status === CLOCK_STATUS.ON_BREAK ? "before the break" : "so far"}
              </p>
            ) : null}
          </div>

          {actions.length ? (
            <div className="flex flex-wrap gap-2">
              {actions.map((key) => {
                const { label, Icon } = ACTION_LABEL[key];
                // Clocking out is the one that ends the day, so it does not
                // share the emphasis of the action somebody is most likely to
                // want next.
                const secondary = key === "clockOut" && actions.length > 1;
                return (
                  <Button
                    key={key}
                    size="lg"
                    variant={secondary ? "outline" : "default"}
                    className="h-12 flex-1 text-base"
                    onClick={() => {
                      setAction(key);
                      setDialogOpen(true);
                    }}
                  >
                    <Icon className="mr-2 size-5" />
                    {label}
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-md border bg-neutral-50 p-3 text-sm text-muted-foreground">
              {record?.onLeave
                ? "Nothing to do — enjoy the day off."
                : "That is the day recorded. Anything else needs your manager."}
            </p>
          )}

          {/* Today, in order. A break that was started and never ended is the
              thing most worth seeing, and the person who can still explain it
              is the one looking at this screen. */}
          {record?.clockIn ? (
            <div className="space-y-1.5 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Today</p>
              <ol className="space-y-1 text-sm">
                <li className="flex items-center gap-2">
                  <span className="w-12 tabular-nums text-muted-foreground">
                    {record.clockIn}
                  </span>
                  <span>Clocked in</span>
                </li>
                {(record.breaks || []).map((br, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-12 tabular-nums text-muted-foreground">
                      {br.breakIn}
                    </span>
                    <span>
                      Break
                      {br.breakOut ? (
                        <>
                          {" "}
                          until {br.breakOut}{" "}
                          <span className="text-muted-foreground">
                            ({describeMinutes(diffMinutes(br.breakIn, br.breakOut) || 0)})
                          </span>
                        </>
                      ) : (
                        <span className="ml-1 text-amber-700">
                          — still running
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                {record.clockOut ? (
                  <li className="flex items-center gap-2">
                    <span className="w-12 tabular-nums text-muted-foreground">
                      {record.clockOut}
                    </span>
                    <span>Clocked out</span>
                  </li>
                ) : null}
              </ol>
            </div>
          ) : null}

          <p className="border-t pt-3 text-xs text-muted-foreground">
            Every action is confirmed at the place you are working — by scanning
            the code at reception, tapping a tag, or being on the site network.
            That is what stops somebody clocking in for somebody else.
          </p>
        </CardContent>
      </Card>

      <SiteEmployeeScannerDialog
        action={action}
        open={dialogOpen}
        // Reloaded on close as well as on the socket event. The dialog emits
        // and the server echoes back, but a card that silently stays on the
        // old state after a successful scan invites somebody to do it twice —
        // and one wasted read costs nothing.
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) load();
        }}
        employeeId={employeeId}
      />
    </>
  );
}
