/**
 * Service worker tests for the clock-out reminder.
 *
 * Runs public/sw.js inside a fake ServiceWorkerGlobalScope and checks that a
 * push actually produces a notification.
 *
 * This exists because the previous version never showed one. It parsed the
 * payload into `payload` and then read every field off `data`, a variable that
 * was never declared — so the handler threw ReferenceError before reaching
 * showNotification(). Nothing displayed on any browser, and a subscription
 * that repeatedly shows nothing is one the push service eventually throttles.
 *
 * A service worker cannot be imported or unit-tested normally, which is most
 * of why a bug that obvious lived that long. This is the cheapest thing that
 * would have caught it.
 *
 *   node scripts/test-push-sw.mjs
 */
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync("public/sw.js", "utf8");
const listeners = {};
const shown = [];
const opened = [];

const self = {
  addEventListener: (k, fn) => { (listeners[k] ||= []).push(fn); },
  skipWaiting: () => {},
  registration: {
    showNotification: (title, options) => { shown.push({ title, options }); },
  },
  clients: {
    claim: () => Promise.resolve(),
    matchAll: () => Promise.resolve([]),
    openWindow: (u) => { opened.push(u); return Promise.resolve(); },
  },
};
vm.createContext(self);
self.self = self;
vm.runInContext(src, self);

let fails = 0;
const eq = (n, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log(`${ok ? "pass" : "FAIL"}  ${n}${ok ? "" : `\n        got ${got}\n       want ${want}`}`);
};

eq("exactly one notificationclick listener", (listeners.notificationclick||[]).length, 1);
eq("a push listener is registered", (listeners.push||[]).length, 1);

const fire = async (data) => {
  shown.length = 0;
  const event = { data, waitUntil: (p) => p };
  await listeners.push[0](event);
  return shown[0];
};

// The real payload the server sends.
const real = await fire({ json: () => ({ title: "Attendance Reminder", body: "Hi Ava, it looks like you forgot to clock out!", url: "/admin/dashboard" }) });
eq("a normal push shows a notification", Boolean(real), true);
eq("  title", real?.title, "Attendance Reminder");
eq("  body", real?.options?.body, "Hi Ava, it looks like you forgot to clock out!");
eq("  click url", real?.options?.data?.url, "/admin/dashboard");

// Malformed payloads must still show something: a push that displays nothing
// is what gets a subscription throttled.
const text = await fire({ json: () => { throw new Error("not json"); }, text: () => "plain text" });
eq("a non-JSON push still shows", text?.options?.body, "plain text");

const empty = await fire(null);
eq("an empty push still shows", Boolean(empty), true);
eq("  falls back to a title", empty?.title, "Reminder");

const partial = await fire({ json: () => ({ body: "only a body" }) });
eq("a partial payload keeps defaults", partial?.title, "Reminder");
eq("  and uses the body given", partial?.options?.body, "only a body");

// Click with no data must not throw.
await listeners.notificationclick[0]({
  notification: { close(){}, data: undefined },
  waitUntil: (p) => p,
});
eq("clicking a notification with no data opens the root", opened.at(-1), "/");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exitCode = fails ? 1 : 0;
