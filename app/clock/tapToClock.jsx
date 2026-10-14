"use client";

import React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Clock4,
  Coffee,
  Loader2,
  LogOut,
  MapPin,
  TimerOff,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

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
import { useFetchQuery } from "@/hooks/use-query";
import { homePathForRole } from "@/lib/roleHome";
import { collectClockEvidence } from "@/lib/clockEvidence";
import { flushQueue, queueTap, queuedCount } from "@/lib/offlineQueue";
import { syncOfflineTaps } from "@/server/clockServer/offlineSync";
import { getClockLocations } from "@/server/clockServer/locations";
import {
  assignClockTag,
  inspectTag,
  storeClockTimeByTag,
} from "@/server/clockServer/tags";

/**
 * What happens after someone taps a tag.
 *
 * Four states, because a tap can mean four different things and telling them
 * apart is most of the value:
 *
 *   ready   — bound to a location. Carry out what this tap means, or ask.
 *   enrol   — a new tag, tapped by a super admin. Bind it here, on the spot,
 *             rather than transcribing its UID off a sticker into a form.
 *   ...     — unassigned / suspended / retired: say which, plainly.
 *
 * ONE TAP IS ONE ACTION. This screen used to render all four buttons every
 * time, and the comment defending it said the record's own state would decide
 * which were legal. It does — but only after the press, as a refusal. So
 * somebody who had not clocked in was offered End Break and Clock Out, three
 * of the four buttons could not work, and nothing said which. Worse, one tap
 * on the chip left the whole menu sitting there: a person could clock in,
 * break, and clock out again without touching the tag again, which is the
 * opposite of what a tag is for — the tap IS the evidence of being there.
 *
 * So the server sends the stage and what this tap can mean (lib/clockRules.js
 * `tapStage`), and:
 *
 *   One possible meaning  -> do it, immediately, with no button at all. Arrive,
 *                            tap, clocked in.
 *   Two                   -> ask, with exactly those two.
 *   Done for the day      -> say so.
 *
 * and once an action has happened this view does not offer the next one. It
 * shows what was recorded and says to tap again, so every action costs a tap.
 */
const ACTION_LABELS = {
  clockIn: { label: "Clock In", Icon: Clock4, verb: "Clocking you in" },
  breakIn: { label: "Start Break", Icon: Coffee, verb: "Starting your break" },
  breakOut: { label: "End Break", Icon: TimerOff, verb: "Ending your break" },
  clockOut: { label: "Clock Out", Icon: LogOut, verb: "Clocking you out" },
};

/**
 * Where the shift stands, in one line.
 *
 * Shown on every tap because the screen is now mostly automatic: when a tap
 * clocks somebody in without asking, the only thing that tells them it worked
 * — and the only way to notice a tag that recorded yesterday's shift or
 * somebody else's — is seeing the day read back.
 *
 * Breaks are counted rather than listed. Several breaks a day is the normal
 * case here, and "break 2" is what makes the third tap of the morning legible.
 */
function ShiftSoFar({ tap }) {
  if (!tap || tap.stage === "beforeShift") return null;

  const parts = [];
  if (tap.clockIn) parts.push(`in at ${tap.clockIn}`);
  if (tap.openBreakSince) {
    parts.push(`on break ${tap.breaksTaken + 1} since ${tap.openBreakSince}`);
  } else if (tap.breaksTaken > 0) {
    parts.push(`${tap.breaksTaken} break${tap.breaksTaken === 1 ? "" : "s"} taken`);
  }
  if (tap.clockOut) parts.push(`out at ${tap.clockOut}`);
  if (!parts.length) return null;

  return (
    <p className="rounded-md border bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
      Today: {parts.join(" · ")}
    </p>
  );
}

/** What a further tap would do from here — the instruction after an action. */
function nextTapHint(stage) {
  if (stage === "beforeShift") return "Tap the tag again to start your shift.";
  if (stage === "onBreak") return "Tap the tag again when your break ends.";
  if (stage === "working") {
    return "Tap the tag again to start a break, or to clock out.";
  }
  if (stage === "finished") return "That is you finished for today.";
  return "Tap the tag again for your next action.";
}

export default function TapToClock({ uid, picc, cmac }) {
  const { data: session } = useSession();
  const [busy, setBusy] = React.useState(false);
  const [waiting, setWaiting] = React.useState(0);

  // Enrolment
  const [chosenLocation, setChosenLocation] = React.useState("");
  const [label, setLabel] = React.useState("");

  // Through the app's own query hook rather than an effect that loads into
  // state: the effect version has to call setState from inside the effect
  // body, which is the cascading-render pattern the lint rule is there to stop.
  const {
    data: tagData,
    isLoading,
    isError,
    refetch,
  } = useFetchQuery({
    fetchFn: inspectTag,
    params: { uid, picc, cmac },
    queryKey: ["clockTag", uid, picc, cmac],
    enabled: Boolean(uid),
  });

  const state = uid
    ? tagData?.newData || null
    : { state: "error", message: "No tag in that link." };

  // Only fetched when it is actually needed — an employee tapping a working
  // tag never sees the location list.
  const { data: locationData } = useFetchQuery({
    fetchFn: getClockLocations,
    queryKey: ["clockLocations"],
    enabled: state?.state === "enrol",
  });
  const locations = locationData?.newData || [];

  // Anything queued from an earlier tap goes as soon as there is a connection
  // — on arrival here, and again the moment the browser says it is back.
  const drain = React.useCallback(async () => {
    const outcome = await flushQueue((batch) => syncOfflineTaps(batch));
    if (outcome.sent) {
      const ok = outcome.results.filter((r) => r?.success).length;
      toast.success(
        `Sent ${ok} clock action${ok === 1 ? "" : "s"} recorded offline.`,
      );
      const refused = outcome.results.filter((r) => r && !r.success);
      for (const r of refused) toast.error(r.message);
      await refetch();
    }
    setWaiting(await queuedCount());
  }, [refetch]);

  React.useEffect(() => {
    // Deferred rather than called straight from the effect body: draining
    // eventually sets state, and nothing here needs to happen before the
    // first paint — the buttons are usable whether or not a queue exists.
    const timer = setTimeout(drain, 0);
    const onOnline = () => drain();
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [drain]);

  // What this tap meant and what came of it. Set by `act`, and the reason the
  // next action is not offered in the same view: one tap, one action.
  const [done, setDone] = React.useState(null);

  // Guards the automatic action against running twice. Keyed on the tag and
  // the stage, so a re-render or a refetch cannot repeat it, while a genuinely
  // new situation (a second tap, a different tag) still fires.
  const autoFired = React.useRef(null);

  const act = React.useCallback(async (action) => {
    setBusy(true);
    setDone(null);
    try {
      // Never blocks: a declined permission or a cold GPS chip resolves to
      // nothing rather than holding someone up at a cabin door.
      const evidence = await collectClockEvidence();

      let res;
      try {
        res = await storeClockTimeByTag(uid, action, evidence, { picc, cmac });
      } catch {
        // The request never left the phone. On a site with no signal that is
        // the normal case, not an error — keep the tap and send it later.
        //
        // Only reached for a genuine transport failure: a server that answers
        // "you are already clocked in" is a decision, and queueing a decision
        // would replay it for ever.
        res = null;
      }

      if (!res) {
        const stored = await queueTap({
          uid,
          action,
          evidence,
          signature: { picc, cmac },
        });
        setWaiting(await queuedCount());
        setDone({
          action,
          ok: stored,
          queued: stored,
          message: stored
            ? "No signal — saved on this phone and sent when you are back online."
            : "No signal, and this phone could not save it. Tell your manager.",
        });
        return;
      }

      setDone({
        action,
        ok: res.success === true,
        message: res.message || (res.success ? "Recorded" : "That did not work"),
      });
      await refetch();
    } finally {
      setBusy(false);
    }
  }, [uid, picc, cmac, refetch]);

  const tap = state?.state === "ready" ? state.tap || null : null;

  // THE TAP THAT NEEDS NO BUTTON.
  //
  // Three of the four stages have one possible meaning, so pressing a button
  // to confirm what the tap already said is a step that carries no
  // information. Arrive in the morning, tap, clocked in.
  //
  // Safe to run on its own because carrying out the single action always moves
  // the stage out of the state that implied it — after a clock-in the stage is
  // `working`, which never fires automatically — so this cannot loop or double
  // up. `done` blocks it from the moment an action has happened in this view,
  // and the ref blocks a repeat within the same stage if an action failed.
  React.useEffect(() => {
    if (!tap?.auto || done || busy) return;
    const key = `${uid}:${tap.stage}:${tap.auto}`;
    if (autoFired.current === key) return;
    autoFired.current = key;
    act(tap.auto);
  }, [tap, done, busy, uid, act]);

  const enrol = async () => {
    setBusy(true);
    try {
      const res = await assignClockTag({
        uid,
        locationId: chosenLocation,
        label: label.trim() || undefined,
      });
      if (res?.success) {
        toast.success(res.message);
        await refetch();
      } else {
        toast.error(res?.message || "Could not assign that tag");
      }
    } finally {
      setBusy(false);
    }
  };

  if (isLoading && uid) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (state?.state === "enrol") {
    return (
      <Card>
        <CardHeader>
          {/* A tag we provisioned is not "new" to the person placing it — they
              ordered it, and it arrived keyed and verified. Calling it new
              reads like something went wrong. */}
          <CardTitle>
            {state.existing ? "Where is this tag?" : "New tag"}
          </CardTitle>
          <CardDescription>
            {state.existing
              ? "This tag is ready to use — it just needs to know where it is mounted."
              : "This tag has not been used before."}{" "}
            Tag <code className="text-xs">{state.uid}</code>. The code was read
            from the chip itself, so there is nothing to type.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Label, e.g. Elm Street — cabin door"
            value={label}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Select value={chosenLocation} onValueChange={setChosenLocation}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Where is this tag?" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l._id} value={l._id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="w-full"
            disabled={busy || !chosenLocation}
            onClick={enrol}
          >
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Assign this tag
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state?.state !== "ready") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="size-4 text-amber-600" />
            This tag cannot be used
          </CardTitle>
          <CardDescription>
            {state?.message ||
              (isError ? "Could not read that tag." : "Unknown tag.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* WHAT THE TAP ACTUALLY SENT. The screen knew this all along and
              did not show it, which turned "this tag has not been set up yet"
              into a dead end: the id is either absent (the chip is not
              mirroring), mangled (a writer that shifted or watermarked the
              URL), or simply not the one registered — three different fixes,
              and the id tells you which in one glance. Shown to everybody
              because the person holding the phone is the one who can read it
              out, and it is printed on the tag's own packaging anyway. */}
          {uid ? (
            <p className="rounded border bg-neutral-50 px-2 py-1.5 font-mono text-[11px] break-all text-neutral-600">
              this tap sent: {uid}
            </p>
          ) : (
            <p className="rounded border bg-neutral-50 px-2 py-1.5 text-[11px] text-neutral-600">
              this tap sent no tag id at all
            </p>
          )}
          {/* What to do next depends on who can actually fix it. "Your manager
              can set this up" is right for a tag nobody has registered and
              wrong for a tag that was programmed badly — no manager can fix
              that from a screen, and sending an employee to ask makes them
              chase something nobody on their side can do. */}
          <p className="text-xs text-neutral-500">
            {state?.state === "invalid" || state?.state === "unverifiable"
              ? "This is how the tag was written, not anything to do with your account. Whoever supplied the tag needs to programme it again."
              : state?.state === "unregistered"
                ? "Nothing is wrong with the tag itself — the last step of setting it up was never finished."
                : session?.user?.role === "superAdmin"
                ? "You can set this tag up from Leave Management → Settings → Clock-in Tags."
                : "Your manager can set this up."}
          </p>
          {/* Always offered, because the point of this screen is somebody
              standing at a door trying to start their shift. A dead end that
              mentions "the usual way" without being it is not help. */}
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href={homePathForRole(session?.user?.role)}>
              Clock in the usual way
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // The actions this tap could mean. Null `tap` is the fallback for a stage the
  // server could not work out: offer everything rather than show nothing, which
  // is the old behaviour and still better than a dead screen.
  const choices =
    tap?.actions ||
    Object.keys(ACTION_LABELS).map((action) => ({ action, allowed: true, reason: null }));

  const queuedNotice =
    waiting > 0 ? (
      <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
        {waiting} clock action{waiting === 1 ? "" : "s"} saved on this phone,
        waiting for a signal. They will send on their own — your manager will
        confirm the times.
      </p>
    ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hi, {session?.user?.name || "there"}</CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <MapPin className="size-3.5" />
          {state.location?.name || "this location"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ShiftSoFar tap={tap} />

        {/* Mid-action. Named, because "Checking where you are…" over a blank
            card leaves somebody holding a phone with no idea whether their
            shift started. */}
        {busy ? (
          <p className="flex items-center justify-center gap-2 rounded-md border bg-neutral-50 py-3 text-sm text-neutral-600">
            <Loader2 className="size-4 animate-spin" />
            {ACTION_LABELS[done?.action || tap?.auto]?.verb || "Recording that"}…
          </p>
        ) : done ? (
          /* WHAT JUST HAPPENED, AND NOTHING ELSE OFFERED. The next action
             deliberately needs another tap: the tap is the evidence of being
             at the tag, so collecting several actions from one of them would
             throw away the only thing the hardware proves. */
          <div className="space-y-2">
            <p
              className={
                done.ok
                  ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900"
                  : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
              }
            >
              {done.message}
            </p>
            <p className="text-center text-xs text-neutral-500">
              {done.ok || done.queued
                ? nextTapHint(tap?.stage)
                : "Nothing was recorded. Tap the tag again to try."}
            </p>
          </div>
        ) : tap?.stage === "finished" ? (
          <div className="space-y-2">
            <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-700">
              You have already clocked out today.
            </p>
            <p className="text-center text-xs text-neutral-500">
              If that is wrong, ask your manager to correct it.
            </p>
          </div>
        ) : (
          /* THE ONLY STATE THAT ASKS ANYTHING: clocked in and not on a break,
             where the tap really is ambiguous. Both get a full-height button
             because this is a phone held at a door, often one-handed. */
          <div className="space-y-2">
            {choices.length > 1 ? (
              <p className="text-center text-xs text-neutral-500">
                What are you doing?
              </p>
            ) : null}
            {choices.map(({ action, allowed, reason }) => {
              const { label: text, Icon } = ACTION_LABELS[action];
              return (
                <div key={action}>
                  <Button
                    className="h-13 w-full justify-start text-base"
                    variant={action === "clockOut" ? "outline" : "default"}
                    disabled={busy || !allowed}
                    onClick={() => act(action)}
                  >
                    <Icon className="mr-2 size-4.5" />
                    {text}
                  </Button>
                  {/* A rule that blocks the action says so here, next to the
                      button it blocks, instead of after the press. */}
                  {!allowed && reason ? (
                    <p className="px-1 pt-1 text-xs text-neutral-500">{reason}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {queuedNotice}
      </CardContent>
    </Card>
  );
}
