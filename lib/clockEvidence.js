/**
 * What the browser can say about where it is.
 *
 * Gathered on every clock-in and judged on none of them yet (Phase B). The
 * whole contract of this module is that **it never blocks and never throws**:
 * a person standing at a gate trying to start work must not be held up by a
 * permission prompt, a cold GPS chip or a browser that has no geolocation at
 * all. Everything here degrades to "unknown", which the policy treats as
 * "cannot tell" rather than "was not there".
 */

// Long enough for a cold fix on a phone outdoors, short enough that nobody
// standing in the rain notices. A refused or slow fix is not worth waiting on:
// the answer is recorded as unavailable and the clock-in proceeds.
const POSITION_TIMEOUT_MS = 8000;

// A fix from the last two minutes is good enough — the person has not moved
// far, and reusing it avoids waking the GPS chip for every scan.
const POSITION_MAX_AGE_MS = 120000;

/**
 * The device's position, or null.
 *
 * Deliberately resolves rather than rejects. Permission denied, no hardware,
 * timeout, insecure context — all the same answer to the caller, because none
 * of them tells us anything about where the person is.
 */
export function getPosition() {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }

    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // Belt and braces: some browsers never call either callback when a prompt
    // is dismissed rather than answered.
    const timer = setTimeout(() => done(null), POSITION_TIMEOUT_MS + 500);

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          done({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            // Rounded: a sub-metre figure implies a precision GPS does not
            // have, and the exact value is not used for anything.
            accuracyMetres: Math.round(pos.coords.accuracy ?? 0),
          });
        },
        () => {
          clearTimeout(timer);
          done(null);
        },
        {
          enableHighAccuracy: true,
          timeout: POSITION_TIMEOUT_MS,
          maximumAge: POSITION_MAX_AGE_MS,
        },
      );
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}

/**
 * This browser's fingerprint — the same one sign-in computes, so a clock-in
 * and a login can be recognised as the same device.
 */
export async function getDeviceId() {
  try {
    if (typeof window === "undefined") return null;
    const fingerprintjs = await import("@fingerprintjs/fingerprintjs");
    const fp = await fingerprintjs.load();
    const { visitorId } = await fp.get();
    return visitorId || null;
  } catch {
    return null;
  }
}

/**
 * Everything the client can contribute, gathered in parallel.
 *
 * The IP is not here — a browser cannot know its own public address, and one
 * it reported would be worth nothing anyway. The server reads that from the
 * hop its own proxy observed (lib/clientIp.js).
 */
export async function collectClockEvidence() {
  const [coords, deviceId] = await Promise.all([getPosition(), getDeviceId()]);
  return { coords, deviceId };
}
