/**
 * Would this location have accepted this clock-in?
 *
 * Pure — no database, no session — so the same function answers the question
 * for a live scan and for a report run over last month's records.
 *
 * Phase B runs every configured method in **shadow**: each one is evaluated and
 * the verdict recorded, but nothing is refused. That is deliberate and it is
 * the same pattern `TENANT_ENFORCEMENT` already uses in this codebase. Turning
 * a geofence straight on means guessing a radius, and a radius guessed too
 * tight does not produce a warning — it produces a person standing outside a
 * cabin at 7am unable to start work. Measure first, enforce second.
 */

/** Verdicts a single method can return. */
export const CHECK = {
  PASS: "pass",
  FAIL: "fail",
  // The evidence needed was not available — permission denied, no GPS fix, no
  // IP. Deliberately NOT a failure: it says nothing about where the person was,
  // and counting it as one would make an enforced rule punish a flat battery.
  UNKNOWN: "unknown",
};

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres. */
export function distanceMetres(a, b) {
  if (
    !Number.isFinite(a?.lat) ||
    !Number.isFinite(a?.lng) ||
    !Number.isFinite(b?.lat) ||
    !Number.isFinite(b?.lng)
  ) {
    return null;
  }

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/** Is `ip` inside `cidr`? IPv4 and IPv6, returns null when unanswerable. */
export function ipInCidr(ip, cidr) {
  if (!ip || !cidr) return null;
  const [range, bitsRaw] = String(cidr).split("/");
  const bits = Number(bitsRaw);
  if (!range || !Number.isFinite(bits)) return null;

  const a = toBytes(ip);
  const b = toBytes(range);
  if (!a || !b || a.length !== b.length) return null;
  if (bits < 0 || bits > a.length * 8) return null;

  const whole = Math.floor(bits / 8);
  for (let i = 0; i < whole; i++) if (a[i] !== b[i]) return false;

  const rest = bits % 8;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return (a[whole] & mask) === (b[whole] & mask);
}

function toBytes(address) {
  if (address.includes(":")) return ipv6ToBytes(address);
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out[i] = n;
  }
  return out;
}

function ipv6ToBytes(address) {
  const [head, tail] = address.split("::");
  const left = head ? head.split(":").filter(Boolean) : [];
  const right = tail ? tail.split(":").filter(Boolean) : [];
  if (address.includes("::")) {
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    left.push(...Array(fill).fill("0"), ...right);
  } else if (left.length !== 8) {
    return null;
  }

  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const n = parseInt(left[i] || "0", 16);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 0xff;
  }
  return out;
}

/** One method's verdict, with enough detail to explain it on a report. */
function evaluateMethod(method, location, evidence) {
  const type = method?.type;

  if (type === "geofence") {
    const fence = location?.geofence;
    if (!Number.isFinite(fence?.lat) || !Number.isFinite(fence?.lng)) {
      return { verdict: CHECK.UNKNOWN, detail: "no geofence set" };
    }
    const coords = evidence?.coords;
    if (!Number.isFinite(coords?.lat)) {
      return { verdict: CHECK.UNKNOWN, detail: "no position from the device" };
    }

    const distance = distanceMetres(coords, fence);
    const radius = Number(fence.radiusMetres) || 150;
    // A poor fix is not evidence of being elsewhere. The accuracy radius is
    // added to the allowance so a 60m fix at the gate is not read as 60m away
    // — in steel-framed buildings that is the normal case, not the exception.
    const allowance = radius + Math.max(0, Number(coords.accuracyMetres) || 0);

    return {
      verdict: distance <= allowance ? CHECK.PASS : CHECK.FAIL,
      detail: `${distance}m away, allowed ${allowance}m`,
      distanceMetres: distance,
      accuracyMetres: coords.accuracyMetres ?? null,
    };
  }

  if (type === "network") {
    const networks = location?.networks || [];
    if (!networks.length) {
      return { verdict: CHECK.UNKNOWN, detail: "no networks set" };
    }
    if (!evidence?.ip) {
      return { verdict: CHECK.UNKNOWN, detail: "no client address" };
    }
    const matched = networks.some((cidr) => ipInCidr(evidence.ip, cidr) === true);
    return {
      verdict: matched ? CHECK.PASS : CHECK.FAIL,
      detail: matched ? `matched a known network` : `${evidence.ip} is outside`,
    };
  }

  if (type === "deviceQr") {
    // The scan already happened — reaching here means a code was redeemed.
    return evidence?.tokenJti
      ? { verdict: CHECK.PASS, detail: "code redeemed" }
      : { verdict: CHECK.UNKNOWN, detail: "not a code scan" };
  }

  if (type === "nfc") {
    return evidence?.tagId
      ? { verdict: CHECK.PASS, detail: "tag tapped" }
      : { verdict: CHECK.UNKNOWN, detail: "not a tag tap" };
  }

  if (type === "rollCall") {
    // Attested by a manager rather than proven. Always passes; it exists so a
    // location can declare it as the override path.
    return { verdict: CHECK.PASS, detail: "recorded by a manager" };
  }

  return { verdict: CHECK.UNKNOWN, detail: `unknown method "${type}"` };
}

/**
 * Evaluate every method a location has configured.
 *
 * @returns `{ checks, wouldAllow, enforcing }`
 *
 * `wouldAllow` is what an enforcing location *would* have decided. Phase B only
 * records it. `enforcing` says whether any method is actually set to enforce —
 * while it is false, `wouldAllow` is a measurement, not a decision.
 */
export function evaluateLocation(location, evidence = {}) {
  const methods = (location?.methods || []).filter(
    (m) => m?.mode === "shadow" || m?.mode === "enforce",
  );

  if (!methods.length) {
    return { checks: [], wouldAllow: true, enforcing: false };
  }

  const checks = methods.map((method) => ({
    method: method.type,
    mode: method.mode,
    ...evaluateMethod(method, location, evidence),
  }));

  const enforced = checks.filter((c) => c.mode === "enforce");
  const judged = (enforced.length ? enforced : checks).filter(
    (c) => c.verdict !== CHECK.UNKNOWN,
  );

  // Nothing could be judged — no position, no address, nothing. Allow: a
  // control that cannot tell must not be the reason somebody cannot start.
  if (!judged.length) {
    return { checks, wouldAllow: true, enforcing: enforced.length > 0 };
  }

  const wouldAllow = location?.requireAll
    ? judged.every((c) => c.verdict === CHECK.PASS)
    : judged.some((c) => c.verdict === CHECK.PASS);

  return { checks, wouldAllow, enforcing: enforced.length > 0 };
}
