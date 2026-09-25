"use client";

import React, { useEffect, useState } from "react";
import { BellRing, PlusSquare, Share, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { subscriberUser } from "@/lib/notifications";
import { sendTestNotification } from "@/server/attendanceServer/notificationServer";

/**
 * Offering clock-out reminders.
 *
 * Rewritten for volume rather than content. This was the loudest thing on the
 * dashboard — a dashed orange box with a bouncing bell — for a feature that is
 * optional and secondary, sitting above the clock card that is the reason
 * anybody opened the page. A prompt that shouts over the main task is a prompt
 * people learn to scroll past.
 *
 * Now it is one quiet line, and:
 *
 *   · it can be dismissed, and stays dismissed. An offer that cannot be
 *     refused is not an offer.
 *   · once granted it renders NOTHING. The old version kept a green "active"
 *     banner and a Send Test button on screen for ever — a permanent strip
 *     confirming something that already works, with a developer's button on
 *     it.
 *   · the iPhone instructions stay, because there they are the whole point:
 *     on iOS notifications genuinely need the app on the Home Screen, and
 *     somebody who does not know that will tap Allow and wonder why nothing
 *     happens.
 */

const DISMISSED_KEY = "cdchr:remindersDismissed";

export default function NotificationSetup() {
  const { data: session } = useSession();
  const userId = session?.user?._id;

  const [status, setStatus] = useState("loading");
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [testing, setTesting] = useState(false);

  // Reading the browser's own state, which is what an effect is for — and it
  // cannot be a lazy useState initialiser, because this renders on the server
  // first and `window` does not exist there. Doing it any earlier would mean
  // the server rendering one thing and the client another, which is a
  // hydration mismatch rather than a fix.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!("Notification" in window)) {
      setStatus("unsupported");
    } else {
      setStatus(
        Notification.permission === "default"
          ? "prompt"
          : Notification.permission,
      );
    }

    const isIosDevice =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(isIosDevice);
    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        navigator.standalone === true,
    );

    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "1");
    } catch {
      // Private window, or storage blocked. Asking again is the safe default.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Dismissed for this visit at least.
    }
  };

  const handleSubscribe = async () => {
    // Reaches Notification.requestPermission() while this click is still the
    // active user gesture, or Safari dismisses the prompt without showing it.
    const result = await subscriberUser(userId);
    if (result?.ok) {
      setStatus("granted");
      toast.success(result.message || "Reminders are on");
      return;
    }
    // The real reason, not "Failed to enable" — an iPhone that has not
    // installed the app and a permission somebody denied need different
    // things done about them.
    setStatus(
      typeof Notification !== "undefined" ? Notification.permission : "denied",
    );
    toast.error(result?.message || "Could not turn reminders on.");
  };

  // Nothing to offer, or nothing to say.
  if (status === "loading" || status === "unsupported" || dismissed) return null;

  // Already on. Deliberately silent: a permanent banner confirming a working
  // feature is a banner people stop reading, and it was carrying a Send Test
  // button that belongs to whoever built it rather than whoever uses it.
  if (status === "granted" || status === "enabled") {
    return process.env.NODE_ENV === "development" ? (
      <button
        type="button"
        disabled={testing}
        className="text-xs text-muted-foreground underline"
        onClick={async () => {
          setTesting(true);
          const res = await sendTestNotification(userId);
          setTesting(false);
          if (res?.success) toast.success("Test notification sent");
          else toast.error(res?.message || "Could not send a test");
        }}
      >
        Send a test notification
      </button>
    ) : null;
  }

  // iPhone, not installed. The instructions are the substance here — tapping
  // Allow in Safari does nothing until the app is on the Home Screen.
  if (isIOS && !isStandalone) {
    return (
      <div className="relative rounded-lg border bg-neutral-50 p-3 text-sm">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-2 text-neutral-400 hover:text-neutral-600"
        >
          <X className="size-4" />
        </button>
        <p className="pr-6 font-medium">Get a nudge before you forget to clock out</p>
        <p className="mt-1 text-xs text-muted-foreground">
          On iPhone this needs the app on your Home Screen first: tap{" "}
          <Share className="inline size-3.5" /> <strong>Share</strong> in
          Safari, then <strong>Add to Home Screen</strong>{" "}
          <PlusSquare className="inline size-3.5" />. Open it from there and
          this will offer again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-neutral-50 p-3 text-sm">
      <BellRing className="size-4 shrink-0 text-neutral-500" />
      <p className="flex-1">
        Get a reminder before you forget to clock out.
        {status === "denied" ? (
          <span className="mt-0.5 block text-xs text-red-600">
            Your browser is blocking notifications for this site — that has to
            be changed in its settings, not here.
          </span>
        ) : null}
      </p>
      {status !== "denied" ? (
        <Button size="sm" onClick={handleSubscribe}>
          Turn on
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={dismiss}>
        No thanks
      </Button>
    </div>
  );
}
