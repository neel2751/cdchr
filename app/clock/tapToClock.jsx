"use client";

import React from "react";
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
 *   ready   — bound to a location. Show the actions this person can take.
 *   enrol   — a new tag, tapped by a super admin. Bind it here, on the spot,
 *             rather than transcribing its UID off a sticker into a form.
 *   ...     — unassigned / suspended / retired: say which, plainly.
 */
const ACTION_LABELS = {
  clockIn: { label: "Clock In", Icon: Clock4 },
  breakIn: { label: "Start Break", Icon: Coffee },
  breakOut: { label: "End Break", Icon: TimerOff },
  clockOut: { label: "Clock Out", Icon: LogOut },
};

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

  const act = async (action) => {
    setBusy(true);
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
        toast[stored ? "success" : "error"](
          stored
            ? "No signal — saved on this phone and sent when you are back online."
            : "No signal, and this phone could not save it. Tell your manager.",
        );
        return;
      }

      if (res.success) toast.success(res.message);
      else toast.error(res.message || "That did not work");
      await refetch();
    } finally {
      setBusy(false);
    }
  };

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
          <CardTitle>New tag</CardTitle>
          <CardDescription>
            Tag <code className="text-xs">{state.uid}</code> has not been used
            before. Choose where it is mounted — the code was read from the chip
            itself, so there is nothing to type.
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
        <CardContent>
          <p className="text-xs text-neutral-500">
            {session?.user?.role === "superAdmin"
              ? "You can set this tag up from Leave Management → Settings → Clock-in Tags."
              : "Your manager can set this up, or you can clock in the usual way."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hi, {session?.user?.name || "there"}</CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <MapPin className="size-3.5" />
          {state.location?.name || "this location"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Every action is offered; the record's own state decides which are
            legal, and says why when one is not. Hiding them would mean
            guessing that state on the client, where it is already stale. */}
        {Object.entries(ACTION_LABELS).map(([action, { label: text, Icon }]) => (
          <Button
            key={action}
            className="h-12 w-full justify-start text-base"
            variant={action === "clockIn" ? "default" : "outline"}
            disabled={busy}
            onClick={() => act(action)}
          >
            <Icon className="mr-2 size-4.5" />
            {text}
          </Button>
        ))}
        {busy ? (
          <p className="flex items-center justify-center gap-2 pt-1 text-xs text-neutral-500">
            <Loader2 className="size-3 animate-spin" /> Checking where you are…
          </p>
        ) : null}
        {waiting > 0 ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            {waiting} clock action{waiting === 1 ? "" : "s"} saved on this phone,
            waiting for a signal. They will send on their own — your manager
            will confirm the times.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
