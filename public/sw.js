/**
 * Push notifications for clock-out reminders.
 *
 * The previous version of this file never showed a single notification. It
 * parsed the push payload into a variable called `payload` and then read every
 * field off `data` — a variable that was never declared — so the handler threw
 * ReferenceError before reaching showNotification(). Nothing was displayed, on
 * any browser, ever; and because a push subscription promises
 * `userVisibleOnly`, repeatedly failing to show anything is also what gets a
 * subscription throttled or dropped by the push service.
 *
 * It also registered two `notificationclick` listeners, so a tap ran both and
 * opened the page twice.
 */

// Take over as soon as this file changes. Without these, a browser that
// already has the broken worker installed keeps running it until every tab is
// closed — so the fix above would not reach the people who need it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

const ICON =
  "https://res.cloudinary.com/drcjzx0sw/image/upload/v1769877067/192_b6yksa.png";
const BADGE =
  "https://res.cloudinary.com/drcjzx0sw/image/upload/v1769877067/72_outdki.png";

self.addEventListener("push", (event) => {
  // Defaults first, so a malformed or empty payload still shows something.
  // A push that displays nothing counts against the subscription.
  let payload = {
    title: "Reminder",
    body: "You have a new reminder",
    url: "/",
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: ICON,
      badge: BADGE,
      vibrate: [100, 50, 100],
      // Replaces an earlier unread reminder rather than stacking three of them
      // on someone's lock screen.
      tag: payload.tag || "attendance-reminder",
      renotify: true,
      data: { url: payload.url || "/" },
    }),
  );
});

// One listener, not two. Focus a tab that is already open on the target before
// opening another — someone who is looking at the app should not get a second
// copy of it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          // Same-path match, ignoring the origin's trailing differences.
          if (client.url.includes(target) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
