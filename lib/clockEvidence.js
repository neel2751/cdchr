/**
 * What the browser can say about where it is.
 *
 * The whole contract of this module is that **it never blocks and never throws**:
 * a person standing at a gate trying to start work must not be held up by a
 * permission prompt, a cold GPS chip or a browser that has no geolocation at
 * all. Everything here degrades to "unknown", which the policy treats as
 * "cannot tell" rather than "was not there".
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHY THE FAILURES ARE NAMED NOW.
 *
 * This used to resolve `null` for every failure — permission refused, no
 * hardware, slow fix, blocked by the Permissions-Policy header, no prompt
 * shown at all. One answer for five causes with five different fixes. The cost
 * showed up the first time one phone recorded a position and another never
 * even asked for permission: there was nothing stored, logged or shown that
 * could tell the two phones apart, so the only way to find out was to borrow
 * the phone.
 *
 * So a failure now says which failure it was, and how long it took. The timing
 * matters more than it looks: iOS refuses INSTANTLY, with no prompt, when
 * Location Services are off for Safari in the phone's own Settings, and it
 * refuses after a pause when the person read the prompt and pressed Don't
 * Allow. Same error code, completely different conversation to have — one is
 * three taps in Settings, the other is a decision somebody made.
 *
 * None of it is evidence: it is the browser's own account of itself, sent by a
 * client that could say anything. It is for diagnosis, never for judging a
 * clock-in, which is why lib/locationPolicy.js does not read it.
 */

// Long enough for a cold fix on a phone outdoors, short enough that nobody
// standing in the rain notices.
const POSITION_TIMEOUT_MS = 8000;

/**
 * The same, for a browser that has not granted permission yet.
 *
 * The short timeout was being spent on the wrong thing. On a first-ever
 * request the clock does not start when the GPS wakes up, it starts when the
 * permission sheet appears — and eight seconds to notice a sheet, read it and
 * press Allow is a race an honest person loses. Losing it recorded "no
 * position", which under `requirePositionForTaps` now means a REFUSED tap. So
 * a first request waits as long as somebody plausibly takes to answer.
 */
const FIRST_REQUEST_TIMEOUT_MS = 25000;

// A fix from the last two minutes is good enough — the person has not moved
// far, and reusing it avoids waking the GPS chip for every scan.
const POSITION_MAX_AGE_MS = 120000;

/**
 * A refusal faster than this cannot have been read by a human.
 *
 * Nobody sees a prompt, reads it and declines inside a quarter of a second, so
 * a denial this quick was decided by the phone and not by the person. That is
 * the difference between "turn location on for Safari" and "you pressed Don't
 * Allow", which is the whole question this module exists to answer.
 */
const NO_PROMPT_MS = 250;

/** Why there is no position. */
export const POSITION_ERROR = {
  /** The person, or their phone's settings, said no. */
  DENIED: "denied",
  /** Said no instantly, so no prompt was ever shown — a device-level block. */
  DENIED_NO_PROMPT: "deniedNoPrompt",
  /** Asked, allowed, and the phone still could not get a fix. */
  UNAVAILABLE: "unavailable",
  /** Ran out of time: a cold chip indoors, or a prompt nobody answered. */
  TIMEOUT: "timeout",
  /** Switched off before it could be asked — no API, http, or our own header. */
  BLOCKED: "blocked",
  /** The browser called neither callback. Known Safari behaviour on dismiss. */
  DISMISSED: "dismissed",
};

/** Plain English for each, for a screen somebody is standing in front of. */
export const POSITION_ERROR_TEXT = {
  [POSITION_ERROR.DENIED]: "Location access was declined on this phone.",
  [POSITION_ERROR.DENIED_NO_PROMPT]:
    "This phone refused without asking, which means location is switched off for Safari in its own Settings.",
  [POSITION_ERROR.UNAVAILABLE]: "This phone could not get a location fix.",
  [POSITION_ERROR.TIMEOUT]: "Getting a location took too long.",
  [POSITION_ERROR.BLOCKED]: "This browser will not provide a location here.",
  [POSITION_ERROR.DISMISSED]: "The location request was never answered.",
};

/**
 * What the browser thinks the permission is: granted | denied | prompt | unknown.
 *
 * A HINT, never a decision. Safari has shipped versions that report `prompt`
 * while the user's own Safari setting is Deny, and older ones throw on the
 * geolocation descriptor entirely, so `unknown` is a perfectly ordinary answer
 * and every caller has to work without it.
 */
export async function permissionState() {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      return "unknown";
    }
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status?.state || "unknown";
  } catch {
    // An unsupported descriptor throws. Not knowing is not a failure.
    return "unknown";
  }
}

/**
 * The device's position, with the reason when there isn't one.
 *
 * Deliberately resolves rather than rejects, for every cause.
 *
 * @param {{ firstRequest?: boolean }} opts `firstRequest` grants the longer
 *   timeout, for a call that is expected to raise a permission prompt.
 * @returns {Promise<{ coords: object|null, error: string|null, afterMs: number }>}
 */
export function requestPosition({ firstRequest = false } = {}) {
  const timeout = firstRequest ? FIRST_REQUEST_TIMEOUT_MS : POSITION_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const elapsed = () => Date.now() - startedAt;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ coords: null, error: POSITION_ERROR.BLOCKED, afterMs: elapsed() });
      return;
    }

    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve({ afterMs: elapsed(), ...value });
    };

    // Belt and braces: some browsers never call either callback when a prompt
    // is dismissed rather than answered.
    const timer = setTimeout(
      () => done({ coords: null, error: POSITION_ERROR.DISMISSED }),
      timeout + 500,
    );

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          done({
            coords: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              // Rounded: a sub-metre figure implies a precision GPS does not
              // have, and the exact value is not used for anything.
              accuracyMetres: Math.round(pos.coords.accuracy ?? 0),
            },
            error: null,
          });
        },
        (err) => {
          clearTimeout(timer);
          done({ coords: null, error: classify(err, elapsed()) });
        },
        {
          enableHighAccuracy: true,
          timeout,
          maximumAge: POSITION_MAX_AGE_MS,
        },
      );
    } catch {
      clearTimeout(timer);
      done({ coords: null, error: POSITION_ERROR.BLOCKED });
    }
  });
}

/**
 * Which failure a GeolocationPositionError actually is.
 *
 * The codes under-describe it. PERMISSION_DENIED covers a person declining, a
 * phone with Location Services off, and our own Permissions-Policy header
 * refusing before the browser ever asked — and that last one is a bug on our
 * side, not on the phone, so it must not be reported as somebody's choice.
 */
function classify(err, afterMs) {
  const code = err?.code;
  const message = String(err?.message || "").toLowerCase();

  if (/permissions policy|feature policy|secure|insecure|disabled/.test(message)) {
    return POSITION_ERROR.BLOCKED;
  }
  if (code === 1) {
    return afterMs < NO_PROMPT_MS
      ? POSITION_ERROR.DENIED_NO_PROMPT
      : POSITION_ERROR.DENIED;
  }
  if (code === 3) return POSITION_ERROR.TIMEOUT;
  if (code === 2) return POSITION_ERROR.UNAVAILABLE;
  return POSITION_ERROR.UNAVAILABLE;
}

/**
 * The device's position, or null.
 *
 * The older, simpler shape, for callers that only want the coordinates —
 * the admin screen's "use my current position" button, which is a deliberate
 * press by somebody who can read a toast and try again.
 */
export async function getPosition() {
  const { coords } = await requestPosition();
  return coords;
}

/**
 * This browser's fingerprint — the same one sign-in computes, so a clock-in
 * and a login can be recognised as the same device.
 *
 * Not unique. The open-source fingerprint is a hash of what the browser will
 * tell any site about itself, so two identical phones on the same iOS version
 * can and do produce the same value. Fine for "is this the usual phone",
 * useless as an identity.
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
export async function collectClockEvidence({ firstRequest = false } = {}) {
  const [position, deviceId] = await Promise.all([
    requestPosition({ firstRequest }),
    getDeviceId(),
  ]);
  return {
    coords: position.coords,
    deviceId,
    // Only when there is something to explain. An absent field reads as "the
    // position worked", which is the common case and should cost nothing.
    positionError: position.error || undefined,
    positionErrorAfterMs: position.error ? position.afterMs : undefined,
  };
}
