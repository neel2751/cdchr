/**
 * The shared clock ticker behind hooks/useTime.js.
 *
 * Tested on its own because the two things that go wrong here are invisible from
 * the outside and both were wrong in the version this replaced:
 *
 *   · THE TIMER LIFECYCLE. The old hook listed the ticking value as an effect
 *     dependency, so it cleared and recreated its interval on every tick — one
 *     timer teardown and setup per second, per mounted consumer, for ever. A
 *     leaked timer is not something a page shows you.
 *   · THE CACHED SNAPSHOT. `useSyncExternalStore` calls `getSnapshot` on every
 *     render and compares the result; returning `Date.now()` fresh each time
 *     means it never matches and React re-renders in a loop. The reading has to
 *     be stored, and "is it stored" is exactly the sort of thing a refactor
 *     quietly undoes.
 *
 * Driven through a fake timer rather than real waiting, so the whole suite runs
 * in milliseconds.
 *
 *   node scripts/test-ticker.mjs
 */
import assert from "node:assert";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

/* -------------------------------------------------------------------------- */
/* A fake clock and fake timers                                                */
/* -------------------------------------------------------------------------- */

const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const realNow = Date.now;

let fakeNow = 1_700_000_000_000;
let nextTimerId = 1;
const intervals = new Map();

globalThis.setInterval = (fn, ms) => {
  const id = nextTimerId++;
  intervals.set(id, { fn, ms });
  return id;
};
globalThis.clearInterval = (id) => {
  intervals.delete(id);
};
Date.now = () => fakeNow;

/** Advance the clock and fire whatever is due. */
function advance(ms) {
  fakeNow += ms;
  for (const { fn, ms: every } of [...intervals.values()]) {
    if (ms >= every) fn();
  }
}

/** How many timers are currently outstanding. */
const liveTimers = () => intervals.size;

const { createTicker } = await import("@/hooks/useTime");

/* -------------------------------------------------------------------------- */

check("NO TIMER IS STARTED UNTIL SOMETHING SUBSCRIBES", () => {
  // Importing the module, or asking for a ticker, must cost nothing.
  const before = liveTimers();
  createTicker(1000);
  assert.equal(liveTimers(), before);
});

check("the snapshot is null before anybody subscribes", () => {
  const ticker = createTicker(1000);
  assert.equal(ticker.getSnapshot(), null);
  assert.equal(ticker.getServerSnapshot(), null);
});

check("THE SERVER SNAPSHOT IS ALWAYS NULL", () => {
  // The whole reason this is an external store: the server renders no time, so
  // there is nothing for hydration to disagree with.
  const ticker = createTicker(1000);
  ticker.subscribe(() => {});
  advance(1000);
  assert.notEqual(ticker.getSnapshot(), null, "the client reading should exist");
  assert.equal(ticker.getServerSnapshot(), null, "but the server one must not");
});

check("subscribing takes the first reading immediately", () => {
  // React re-reads getSnapshot straight after subscribing, so the value has to
  // be there by the time subscribe() returns — not on the first tick.
  const ticker = createTicker(1000);
  assert.equal(ticker.getSnapshot(), null);
  ticker.subscribe(() => {});
  assert.equal(ticker.getSnapshot(), fakeNow);
});

check("THE SNAPSHOT IS STABLE BETWEEN TICKS", () => {
  // If this returns a fresh reading per call, useSyncExternalStore compares two
  // different values on every render and loops for ever.
  const ticker = createTicker(1000);
  ticker.subscribe(() => {});

  const first = ticker.getSnapshot();
  // The clock moves, but no interval has fired.
  fakeNow += 500;
  assert.equal(ticker.getSnapshot(), first, "snapshot moved without a tick");
  assert.equal(ticker.getSnapshot(), ticker.getSnapshot());
});

check("a tick advances the snapshot and notifies", () => {
  const ticker = createTicker(1000);
  let notified = 0;
  ticker.subscribe(() => notified++);

  const before = ticker.getSnapshot();
  advance(1000);

  assert.equal(notified, 1);
  assert.ok(ticker.getSnapshot() > before, "the reading did not advance");
});

check("ONE TIMER HOWEVER MANY SUBSCRIBERS", () => {
  const before = liveTimers();
  const ticker = createTicker(1000);

  const unsubs = [];
  for (let i = 0; i < 5; i++) unsubs.push(ticker.subscribe(() => {}));

  assert.equal(liveTimers(), before + 1, "a timer per subscriber");

  // And every one of them hears the tick.
  let heard = 0;
  const extra = ticker.subscribe(() => heard++);
  advance(1000);
  assert.equal(heard, 1);

  unsubs.forEach((fn) => fn());
  extra();
});

check("THE TIMER IS CLEARED AFTER THE LAST UNSUBSCRIBE, NOT THE FIRST", () => {
  // The leak this guards against: clearing on the first unsubscribe would stop
  // the clock for everybody still watching it.
  const before = liveTimers();
  const ticker = createTicker(1000);

  const a = ticker.subscribe(() => {});
  const b = ticker.subscribe(() => {});
  assert.equal(liveTimers(), before + 1);

  a();
  assert.equal(liveTimers(), before + 1, "cleared while b was still listening");

  let heardAfterA = 0;
  const c = ticker.subscribe(() => heardAfterA++);
  advance(1000);
  assert.equal(heardAfterA, 1, "b and c stopped hearing ticks");

  b();
  c();
  assert.equal(liveTimers(), before, "the timer leaked");
});

check("the snapshot is dropped when the last subscriber goes", () => {
  // So the next mount reports the time now, rather than however stale the last
  // reading was when the screen was closed.
  const ticker = createTicker(1000);
  const unsubscribe = ticker.subscribe(() => {});
  assert.notEqual(ticker.getSnapshot(), null);

  unsubscribe();
  assert.equal(ticker.getSnapshot(), null);

  fakeNow += 60_000;
  ticker.subscribe(() => {});
  assert.equal(ticker.getSnapshot(), fakeNow, "a stale reading came back");
});

check("resubscribing after a full teardown starts a new timer", () => {
  const before = liveTimers();
  const ticker = createTicker(1000);

  const first = ticker.subscribe(() => {});
  first();
  assert.equal(liveTimers(), before);

  let heard = 0;
  const second = ticker.subscribe(() => heard++);
  assert.equal(liveTimers(), before + 1, "no timer after resubscribing");
  advance(1000);
  assert.equal(heard, 1);
  second();
});

check("DIFFERENT CADENCES DO NOT SHARE A TIMER", () => {
  // A live clock wants a second; a greeting wants a minute and must not
  // re-render sixty times for each change it could show.
  const before = liveTimers();
  const fast = createTicker(1000);
  const slow = createTicker(60_000);

  let fastTicks = 0;
  let slowTicks = 0;
  const a = fast.subscribe(() => fastTicks++);
  const b = slow.subscribe(() => slowTicks++);

  assert.equal(liveTimers(), before + 2);

  advance(1000);
  assert.equal(fastTicks, 1, "the fast ticker did not fire");
  assert.equal(slowTicks, 0, "the slow ticker fired early");

  advance(60_000);
  assert.equal(slowTicks, 1);

  a();
  b();
  assert.equal(liveTimers(), before);
});

check("unsubscribing twice is harmless", () => {
  const before = liveTimers();
  const ticker = createTicker(1000);
  const unsubscribe = ticker.subscribe(() => {});
  unsubscribe();
  unsubscribe();
  assert.equal(liveTimers(), before);
});

/* -------------------------------------------------------------------------- */

globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;
Date.now = realNow;

let failures = 0;
for (const [status, name] of results) {
  if (status === "FAIL") failures++;
  console.log(`${status === "pass" ? "✓" : "✗"} ${name}`);
}
console.log(
  `\n${results.length - failures}/${results.length} passed${failures ? ` — ${failures} FAILED` : ""}`
);
process.exitCode = failures ? 1 : 0;
