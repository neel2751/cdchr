import crypto from "node:crypto";

/**
 * Verifying that a webhook really came from Stripe.
 *
 * This is the whole reason the webhook was deferred rather than written
 * alongside the rest of billing: it is an unauthenticated public endpoint that
 * writes payment records. The signature is the ONLY thing standing between a
 * stranger and marking any invoice paid, so it is here on its own, pure, and
 * tested against Stripe's published scheme rather than buried in a route.
 *
 * The scheme, from Stripe's manual verification documentation:
 *
 *   Stripe-Signature: t=1492774577,v1=5257a869…,v0=6ffbb59b…
 *
 *   signed_payload = `${timestamp}.${rawBody}`
 *   expected       = HMAC-SHA256(signing secret, signed_payload), hex
 *
 * Four things here are load-bearing, and each is a real attack if skipped:
 *
 *   1. ONLY `v1` IS ACCEPTED. Stripe sends a `v0` too, and it is deliberately
 *      fake — it exists for testing. Accepting any scheme that verifies is a
 *      downgrade attack with the door held open.
 *   2. THE RAW BODY, byte for byte. Parsing and re-serialising JSON changes
 *      key order and whitespace, and the signature is over bytes.
 *   3. CONSTANT-TIME COMPARISON. A normal === leaks how much of the signature
 *      was right through timing, which is enough to forge one given patience.
 *   4. A TIMESTAMP TOLERANCE. Without it a captured-and-replayed request is
 *      valid for ever. Five minutes is Stripe's own default, and zero is
 *      explicitly not allowed — it disables the check rather than tightening
 *      it.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Equal-length, constant-time. Node throws on a length mismatch. */
function safeEqual(a, b) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Lengths differing is itself a mismatch, and comparing anyway would throw.
  // Checked first because a hex digest's length is not a secret.
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Pull the timestamp and the v1 signatures out of the header.
 *
 * Several v1 values are normal rather than suspicious: while a signing secret
 * is being rolled, Stripe signs with both the old and the new one for up to a
 * day and sends a signature for each.
 */
export function parseStripeSignature(header) {
  const parts = String(header || "").split(",");
  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === "t") timestamp = value;
    // v0 is Stripe's fake test scheme; anything else is a scheme we have
    // never heard of. Both are ignored rather than tried.
    else if (key === "v1") signatures.push(value);
  }

  return { timestamp, signatures };
}

/**
 * Is this request genuinely from Stripe?
 *
 * @param payload the raw request body, exactly as received.
 * @param header  the Stripe-Signature header.
 * @param secret  the endpoint's signing secret (whsec_…).
 * @returns `{ ok: true }`, or `{ ok: false, reason }` — the reason is for a
 *          server log, never for the response body. Telling a caller *why*
 *          their forgery failed helps them write a better one.
 */
export function verifyStripeSignature({
  payload,
  header,
  secret,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  now = Date.now(),
} = {}) {
  if (!secret) return { ok: false, reason: "no signing secret is configured" };
  if (typeof payload !== "string" || !payload) {
    return { ok: false, reason: "empty body" };
  }

  const { timestamp, signatures } = parseStripeSignature(header);
  if (!timestamp || !signatures.length) {
    return { ok: false, reason: "no timestamp or v1 signature in the header" };
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    return { ok: false, reason: "unreadable timestamp" };
  }

  // Checked before the HMAC: a stale request is rejected whether or not its
  // signature is good, and there is no reason to do the work.
  const ageSeconds = Math.abs(now / 1000 - seconds);
  const tolerance = Number(toleranceSeconds) || DEFAULT_TOLERANCE_SECONDS;
  if (ageSeconds > tolerance) {
    return {
      ok: false,
      reason: `timestamp is ${Math.round(ageSeconds)}s away, outside the ${tolerance}s tolerance`,
    };
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");

  // Any one matching is enough — see the note on rolling secrets above. Every
  // candidate is compared rather than short-circuiting, so the time taken does
  // not reveal which one matched.
  let matched = false;
  for (const signature of signatures) {
    if (safeEqual(expected, signature)) matched = true;
  }

  return matched
    ? { ok: true, timestamp: seconds }
    : { ok: false, reason: "no v1 signature matched" };
}

/**
 * Build a header the way Stripe does. FOR TESTS ONLY.
 *
 * Exported because the alternative is a test that hard-codes a digest, which
 * would pass just as happily against a broken implementation that produced the
 * same wrong answer twice.
 */
export function signPayloadForTest(payload, secret, timestampSeconds) {
  const t = timestampSeconds ?? Math.floor(Date.now() / 1000);
  const v1 = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${payload}`, "utf8")
    .digest("hex");
  return `t=${t},v1=${v1}`;
}
