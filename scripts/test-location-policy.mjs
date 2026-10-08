/**
 * Location policy: the client IP hop, CIDR matching, geofencing, and what
 * shadow mode would have decided.
 *
 * Pure — no database. Run it directly:
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-location-policy.mjs
 *
 * The two that matter most:
 *
 *   The X-Forwarded-For test. Caddy *appends* to whatever the client sent, so
 *   the first entry in that header is a value the caller chose. Reading it and
 *   calling it an IP address is a spoofable authorisation bypass the moment a
 *   network allowlist depends on it. CLOCK_LOCATION_PLAN.md §7.1.
 *
 *   The "cannot tell is not a refusal" tests. A denied permission, a flat GPS
 *   chip and a missing address all say nothing about where somebody was.
 *   Counting them as failures is how an enforced rule ends up punishing a dead
 *   battery.
 */
import assert from "node:assert";

import { getClientIp } from "@/lib/clientIp";
import {
  CHECK,
  distanceMetres,
  evaluateLocation,
  ipInCidr,
} from "@/lib/locationPolicy";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

/** A minimal stand-in for a Headers object. */
const hdrs = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });

/* ------------------------------------------------------------- client IP */

check("SPOOFING: the client's own X-Forwarded-For is not believed", () => {
  // The attack. A client sends its own header; Caddy appends the address it
  // actually saw. Taking the first entry authorises whatever they typed.
  const headers = hdrs({ "x-forwarded-for": "203.0.113.9, 198.51.100.7" });
  assert.equal(getClientIp(headers), "198.51.100.7");
  assert.notEqual(
    getClientIp(headers),
    "203.0.113.9",
    "read the caller's claim instead of the observed hop",
  );
});

check("a single hop is the observed one", () => {
  assert.equal(getClientIp(hdrs({ "x-forwarded-for": "198.51.100.7" })), "198.51.100.7");
});

check("several forged hops still resolve to the real one", () => {
  const headers = hdrs({
    "x-forwarded-for": "10.0.0.1, 10.0.0.2, 10.0.0.3, 198.51.100.7",
  });
  assert.equal(getClientIp(headers), "198.51.100.7");
});

check("x-real-ip is the fallback", () => {
  assert.equal(getClientIp(hdrs({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
});

check("no headers at all gives null, not a crash", () => {
  assert.equal(getClientIp(hdrs({})), null);
  assert.equal(getClientIp(null), null);
});

check("an IPv4-mapped IPv6 address is unwrapped", () => {
  // ::ffff:203.0.113.9 and 203.0.113.9 are the same machine. A CIDR check
  // against the wrapped spelling would not match.
  assert.equal(
    getClientIp(hdrs({ "x-forwarded-for": "::ffff:203.0.113.9" })),
    "203.0.113.9",
  );
});

check("a port is not part of the address", () => {
  assert.equal(
    getClientIp(hdrs({ "x-forwarded-for": "203.0.113.9:51234" })),
    "203.0.113.9",
  );
  assert.equal(
    getClientIp(hdrs({ "x-forwarded-for": "[2001:db8::1]:443" })),
    "2001:db8::1",
  );
});

/* ----------------------------------------------------------------- CIDR */

check("IPv4 ranges match", () => {
  assert.equal(ipInCidr("203.0.113.9", "203.0.113.0/24"), true);
  assert.equal(ipInCidr("203.0.114.9", "203.0.113.0/24"), false);
  assert.equal(ipInCidr("203.0.113.9", "203.0.113.9/32"), true);
  assert.equal(ipInCidr("10.1.2.3", "10.0.0.0/8"), true);
});

check("a non-byte-aligned prefix is handled", () => {
  // /20 splits mid-byte; getting this wrong admits sixteen times the range.
  assert.equal(ipInCidr("10.0.15.255", "10.0.0.0/20"), true);
  assert.equal(ipInCidr("10.0.16.0", "10.0.0.0/20"), false);
});

check("IPv6 ranges match", () => {
  assert.equal(ipInCidr("2001:db8::1", "2001:db8::/32"), true);
  assert.equal(ipInCidr("2001:db9::1", "2001:db8::/32"), false);
});

check("nonsense is null, not true", () => {
  for (const [ip, cidr] of [
    [null, "10.0.0.0/8"],
    ["10.0.0.1", null],
    ["not-an-ip", "10.0.0.0/8"],
    ["10.0.0.1", "10.0.0.0/nonsense"],
    ["10.0.0.1", "10.0.0.0/99"],
  ]) {
    assert.notEqual(ipInCidr(ip, cidr), true, `${ip} vs ${cidr} must not pass`);
  }
});

/* ------------------------------------------------------------- distance */

check("distance is roughly right", () => {
  // Two points about 111m apart (0.001 degrees of latitude).
  const d = distanceMetres({ lat: 51.5, lng: -0.1 }, { lat: 51.501, lng: -0.1 });
  assert.ok(d > 105 && d < 118, `expected ~111m, got ${d}`);
});

check("distance is null when a coordinate is missing", () => {
  assert.equal(distanceMetres({ lat: 51.5 }, { lat: 51.5, lng: -0.1 }), null);
  assert.equal(distanceMetres(null, null), null);
});

/* ------------------------------------------------------------ geofence */

const site = (over = {}) => ({
  geofence: { lat: 51.5, lng: -0.1, radiusMetres: 100 },
  methods: [{ type: "geofence", mode: "shadow" }],
  ...over,
});

check("a scan at the gate passes", () => {
  const r = evaluateLocation(site(), {
    coords: { lat: 51.5, lng: -0.1, accuracyMetres: 10 },
  });
  assert.equal(r.checks[0].verdict, CHECK.PASS);
  assert.equal(r.wouldAllow, true);
});

check("a scan from far away fails", () => {
  const r = evaluateLocation(site(), {
    coords: { lat: 51.52, lng: -0.1, accuracyMetres: 10 },
  });
  assert.equal(r.checks[0].verdict, CHECK.FAIL);
  assert.equal(r.wouldAllow, false);
});

check("a poor fix widens the allowance rather than failing", () => {
  // 111m out with a 100m radius would fail on distance alone. But a fix
  // accurate to ±80m does not say the person was 111m away — in a steel-framed
  // building that is the normal reading at the door.
  const r = evaluateLocation(site(), {
    coords: { lat: 51.501, lng: -0.1, accuracyMetres: 80 },
  });
  assert.equal(r.checks[0].verdict, CHECK.PASS, r.checks[0].detail);
});

check("no position is 'cannot tell', not 'was not there'", () => {
  const r = evaluateLocation(site(), {});
  assert.equal(r.checks[0].verdict, CHECK.UNKNOWN);
  assert.equal(r.wouldAllow, true, "a missing fix must not refuse anybody");
});

check("a location with no geofence set cannot judge one", () => {
  const r = evaluateLocation(site({ geofence: undefined }), {
    coords: { lat: 51.5, lng: -0.1, accuracyMetres: 5 },
  });
  assert.equal(r.checks[0].verdict, CHECK.UNKNOWN);
});

/* -------------------------------------------------------------- network */

const office = (over = {}) => ({
  networks: ["203.0.113.0/24"],
  methods: [{ type: "network", mode: "shadow" }],
  ...over,
});

check("an address on the office network passes", () => {
  const r = evaluateLocation(office(), { ip: "203.0.113.42" });
  assert.equal(r.checks[0].verdict, CHECK.PASS);
});

check("an address elsewhere fails", () => {
  const r = evaluateLocation(office(), { ip: "198.51.100.7" });
  assert.equal(r.checks[0].verdict, CHECK.FAIL);
  assert.equal(r.wouldAllow, false);
});

check("no address is 'cannot tell'", () => {
  assert.equal(evaluateLocation(office(), {}).checks[0].verdict, CHECK.UNKNOWN);
});

/* ------------------------------------------------- combining methods */

const both = (over = {}) => ({
  geofence: { lat: 51.5, lng: -0.1, radiusMetres: 100 },
  networks: ["203.0.113.0/24"],
  methods: [
    { type: "network", mode: "shadow" },
    { type: "geofence", mode: "shadow" },
  ],
  ...over,
});

check("by default, any one method is enough", () => {
  // On mobile data at the gate: the network check fails, the geofence passes.
  const r = evaluateLocation(both(), {
    ip: "198.51.100.7",
    coords: { lat: 51.5, lng: -0.1, accuracyMetres: 10 },
  });
  assert.equal(r.wouldAllow, true);
});

check("requireAll means every judgeable method must pass", () => {
  const r = evaluateLocation(both({ requireAll: true }), {
    ip: "198.51.100.7",
    coords: { lat: 51.5, lng: -0.1, accuracyMetres: 10 },
  });
  assert.equal(r.wouldAllow, false);
});

check("an enforcing method outranks a shadowing one", () => {
  // Only the enforcing check should decide; the shadow one is being measured.
  const location = both({
    methods: [
      { type: "network", mode: "enforce" },
      { type: "geofence", mode: "shadow" },
    ],
  });
  const r = evaluateLocation(location, {
    ip: "198.51.100.7", // fails the enforced one
    coords: { lat: 51.5, lng: -0.1, accuracyMetres: 10 }, // passes the shadow one
  });
  assert.equal(r.wouldAllow, false);
  assert.equal(r.enforcing, true);
});

check("a location with nothing configured allows everything", () => {
  // Today's behaviour, and what every location has until someone changes it.
  const r = evaluateLocation({ methods: [] }, {});
  assert.equal(r.wouldAllow, true);
  assert.equal(r.enforcing, false);
  assert.deepEqual(r.checks, []);
});

check("methods switched off are not evaluated", () => {
  const r = evaluateLocation(site({ methods: [{ type: "geofence", mode: "off" }] }), {
    coords: { lat: 51.9, lng: -0.9, accuracyMetres: 5 },
  });
  assert.deepEqual(r.checks, []);
  assert.equal(r.wouldAllow, true);
});

check("REGRESSION: no judgeable evidence never refuses", () => {
  // Every method configured, nothing to judge any of them on. A control that
  // cannot tell must not be the reason somebody cannot start work.
  const r = evaluateLocation(both({ requireAll: true }), {});
  assert.equal(r.wouldAllow, true);
  assert.ok(r.checks.every((c) => c.verdict === CHECK.UNKNOWN));
});

/* ------------------------------------------- Phase D: what enforcing means */

// `evaluateLocation` decides; performClockAction acts on `enforcing &&
// !wouldAllow`. These pin the decision, which is the part with the judgement
// in it.

check("ENFORCE: a scan from the wrong place would be refused", () => {
  const location = site({ methods: [{ type: "geofence", mode: "enforce" }] });
  const r = evaluateLocation(location, {
    coords: { lat: 51.52, lng: -0.1, accuracyMetres: 10 },
  });
  assert.equal(r.enforcing, true);
  assert.equal(r.wouldAllow, false);
});

check("ENFORCE: a scan at the gate is allowed", () => {
  const location = site({ methods: [{ type: "geofence", mode: "enforce" }] });
  const r = evaluateLocation(location, {
    coords: { lat: 51.5, lng: -0.1, accuracyMetres: 10 },
  });
  assert.equal(r.wouldAllow, true);
});

check("ENFORCE: a declined permission is NOT a refusal", () => {
  // The rule that stops an enforced geofence punishing a flat battery. If this
  // ever flips, anyone whose phone cannot get a fix is locked out of work.
  const location = site({ methods: [{ type: "geofence", mode: "enforce" }] });
  const r = evaluateLocation(location, {});
  assert.equal(r.enforcing, true);
  assert.equal(
    r.wouldAllow,
    true,
    "an enforced rule refused somebody it could not judge",
  );
});

check("ENFORCE: no IP available is NOT a refusal", () => {
  const location = office({ methods: [{ type: "network", mode: "enforce" }] });
  assert.equal(evaluateLocation(location, {}).wouldAllow, true);
});

check("ENFORCE: measuring alongside enforcing does not refuse", () => {
  // network enforces and passes; geofence only measures and fails. The
  // measured one must not turn anybody away.
  const location = both({
    methods: [
      { type: "network", mode: "enforce" },
      { type: "geofence", mode: "shadow" },
    ],
  });
  const r = evaluateLocation(location, {
    ip: "203.0.113.42",
    coords: { lat: 51.9, lng: -0.9, accuracyMetres: 10 },
  });
  assert.equal(r.wouldAllow, true);
  assert.equal(
    r.checks.find((c) => c.method === "geofence").verdict,
    CHECK.FAIL,
    "the shadow check should still have been measured",
  );
});

check("ENFORCE: a location still only measuring refuses nobody", () => {
  const location = site({ methods: [{ type: "geofence", mode: "shadow" }] });
  const r = evaluateLocation(location, {
    coords: { lat: 51.9, lng: -0.9, accuracyMetres: 10 },
  });
  assert.equal(r.enforcing, false, "shadow must never read as enforcing");
  assert.equal(r.wouldAllow, false, "but it should still record the verdict");
});

/* ---------------------------------------------------------------- report */

const failed = results.filter(([s]) => s !== "pass");
for (const [status, name] of results) {
  if (status !== "pass") console.log(`  ${status}  ${name}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — ${failed.length} FAILED` : ""),
);
process.exitCode = failed.length ? 1 : 0;
