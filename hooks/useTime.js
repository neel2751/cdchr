"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, ticking.
 *
 * WHAT THIS REPLACED, and why none of it was obvious from the outside:
 *
 *   · `const TODAY_DATE = new Date()` sat at MODULE SCOPE, so the first value
 *     every consumer got was whenever the module happened to be evaluated —
 *     process boot time on the server, first page load in the browser — and it
 *     was shared between them. On the client the interval corrected it within a
 *     second, which is exactly why nobody noticed.
 *   · The effect listed `[currentTime]` as a dependency and `currentTime`
 *     changed every second, so the interval was torn down and recreated on
 *     every tick. One timer per second, for ever, per mounted consumer.
 *   · `if (!currentTime) setCurrentTime(new Date())` could never run:
 *     `currentTime` was initialised to a Date, which is truthy.
 *   · Reading the clock during render and then correcting it in an effect is a
 *     hydration mismatch plus a cascading render — the second of which the React
 *     Compiler flags, and is right to.
 *
 * `useSyncExternalStore` is the primitive for this: the clock is a value that
 * lives outside React and only exists in the browser. `getServerSnapshot`
 * returns null, so the server renders no time at all and there is nothing for
 * hydration to disagree with.
 *
 * ONE TIMER PER INTERVAL, shared by every consumer and cleared after the last
 * unsubscribes. A live clock wants a second; a greeting that says "good
 * morning" wants a minute and should not be re-rendering sixty times for each
 * change it could possibly show.
 *
 * NOTE THE CONTRACT: null until mounted. Callers must handle it — `format(null,
 * …)` throws. That is the honest shape, because before mount there genuinely is
 * no browser clock to report.
 */

const getServerSnapshot = () => null;

/**
 * An external store that reports the clock, re-read every `intervalMs`.
 *
 * Exported because it is the part worth testing on its own: the timer lifecycle
 * (one timer however many subscribers, cleared after the last) and the cached
 * snapshot are where this kind of code goes wrong, and neither is observable
 * through a hook without rendering React.
 *
 * Starts no timer until something subscribes, so importing this module costs
 * nothing.
 */
export function createTicker(intervalMs) {
  const listeners = new Set();
  let snapshot = null;
  let timer = null;

  return {
    subscribe(onStoreChange) {
      listeners.add(onStoreChange);

      if (timer === null) {
        // The first reading taken in the browser. React re-reads getSnapshot
        // immediately after subscribing, so this lands without notifying
        // anybody by hand.
        snapshot = Date.now();
        timer = setInterval(() => {
          snapshot = Date.now();
          for (const listener of listeners) listener();
        }, intervalMs);
      }

      return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
          // Dropped so the next mount takes a fresh reading rather than
          // rendering however stale the last one was.
          snapshot = null;
        }
      };
    },
    // Must return the same value between ticks, or React warns that the
    // snapshot is uncached and re-renders in a loop — which is why the reading
    // is stored rather than taken fresh on each call.
    getSnapshot: () => snapshot,
    getServerSnapshot,
  };
}

/**
 * intervalMs → its shared ticker.
 *
 * Cached rather than rebuilt per render: `useSyncExternalStore` re-subscribes
 * whenever the `subscribe` identity changes, so a fresh closure each render
 * would tear the timer down and set it up again on every pass — which is the
 * shape of the bug this hook used to have.
 */
const tickers = new Map();

function tickerFor(intervalMs) {
  let ticker = tickers.get(intervalMs);
  if (!ticker) {
    ticker = createTicker(intervalMs);
    tickers.set(intervalMs, ticker);
  }
  return ticker;
}

/**
 * @param {number} [intervalMs] how often to re-read the clock. One second suits
 *   a visible clock; a minute suits anything that only changes by the hour.
 * @returns {Date|null} null before mount, and on the server
 */
export const useTime = (intervalMs = 1000) => {
  const { subscribe, getSnapshot } = tickerFor(intervalMs);
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return now === null ? null : new Date(now);
};

/** A minute is plenty for anything that only changes with the hour. */
export const MINUTE = 60 * 1000;
