import { saveSubscription } from "@/server/attendanceServer/notificationServer";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Why a browser cannot take push, in words the person can act on.
 *
 * "Failed to enable" was the only message this flow had, for half a dozen
 * genuinely different causes — an iPhone that has not installed the app, a
 * missing VAPID key, a permission the person actively denied. They are not the
 * same problem and they do not have the same fix.
 */
export function pushSupportProblem() {
  if (typeof window === "undefined") return "Not in a browser.";
  if (!("serviceWorker" in navigator)) {
    return "This browser does not support background notifications.";
  }
  if (!("PushManager" in window)) {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (isIOS && !isStandalone) {
      return "On iPhone, add this app to your Home Screen first — Safari only delivers notifications to an installed app.";
    }
    return "This browser does not support push notifications.";
  }
  if (!("Notification" in window)) {
    return "This browser does not support notifications.";
  }
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return "Notifications are not configured on the server.";
  }
  return null;
}

/**
 * Subscribe this browser to push, and store the endpoint against the user.
 *
 * Returns `{ ok, message }` rather than a bare boolean so the caller can say
 * what went wrong.
 *
 * ORDER MATTERS HERE. `Notification.requestPermission()` has to be called
 * while the browser still considers itself inside the click that triggered it.
 * This used to register the service worker and await `serviceWorker.ready`
 * first — both of which can take seconds on a cold load — and by the time the
 * permission request ran the user gesture had expired, so Safari and some
 * Android browsers dismissed the prompt without ever showing it. That is the
 * "works on my phone but not hers" failure. Permission first, everything else
 * after.
 */
export const subscriberUser = async (userId) => {
  const unsupported = pushSupportProblem();
  if (unsupported) return { ok: false, message: unsupported };

  try {
    // 1. Permission, immediately, while the gesture is still live.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        ok: false,
        message:
          permission === "denied"
            ? "Notifications are blocked for this site. Allow them in your browser settings, then try again."
            : "Notification permission was not granted.",
      };
    }

    // 2. Now the slow part.
    const registration = await navigator.serviceWorker.register("/sw.js");
    // Pick up a newer sw.js on a browser still holding the old one. The
    // previous worker threw on every push, so existing subscribers are exactly
    // the people who need the update.
    try {
      await registration.update();
    } catch {
      // An update check failing is not a reason to abandon the subscription.
    }
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        ),
      });
    }

    // 3. Store it. `toJSON()` — the raw object has getters rather than plain
    // keys, so stringifying it server-side produced an endpoint-less blob that
    // web-push could not use.
    const saved = await saveSubscription(userId, subscription.toJSON());
    if (!saved?.success) {
      return {
        ok: false,
        message: saved?.message || "Could not save the subscription.",
      };
    }
    return { ok: true, message: "Notifications enabled." };
  } catch (error) {
    console.error("Error during subscription process:", error);
    return {
      ok: false,
      message: error?.message || "Could not enable notifications.",
    };
  }
};
