/**
 * Stripe webhook signature verification.
 *
 * This is the only thing standing between a stranger and marking any invoice
 * paid, so it gets its own suite. Every test here is an attack that would
 * otherwise work.
 *
 * Signatures are generated rather than hard-coded: a fixed digest would pass
 * just as happily against an implementation that produced the same wrong
 * answer twice.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-stripe-webhook.mjs
 */
import assert from "node:assert";
import crypto from "node:crypto";

import {
  DEFAULT_TOLERANCE_SECONDS,
  parseStripeSignature,
  signPayloadForTest,
  verifyStripeSignature,
} from "@/lib/stripeSignature";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

const SECRET = "whsec_test_abcdefghijklmnopqrstuvwxyz";
const body = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", payment_status: "paid", amount_total: 1200 } },
});

/* ------------------------------------------------------------ the header */

check("the timestamp and v1 signatures are pulled out", () => {
  const parsed = parseStripeSignature("t=1492774577,v1=aaa,v0=bbb");
  assert.equal(parsed.timestamp, "1492774577");
  assert.deepEqual(parsed.signatures, ["aaa"]);
});

check("MULTIPLE v1 SIGNATURES ARE NORMAL, NOT SUSPICIOUS", () => {
  // While a signing secret is being rolled, Stripe signs with the old and the
  // new one for up to a day and sends a signature for each. Taking only the
  // first would reject half the traffic for a day.
  const parsed = parseStripeSignature("t=1,v1=aaa,v1=bbb");
  assert.deepEqual(parsed.signatures, ["aaa", "bbb"]);
});

check("a malformed header yields nothing rather than throwing", () => {
  for (const header of ["", null, undefined, "garbage", "t=,v1=", "novalues"]) {
    const parsed = parseStripeSignature(header);
    assert.ok(Array.isArray(parsed.signatures));
  }
});

/* ------------------------------------------------------- the happy path */

check("a genuine signature verifies", () => {
  const header = signPayloadForTest(body, SECRET);
  const out = verifyStripeSignature({ payload: body, header, secret: SECRET });
  assert.equal(out.ok, true, out.reason);
});

check("either signature matching is enough during a secret roll", () => {
  const old = signPayloadForTest(body, "whsec_old_secret");
  const fresh = signPayloadForTest(body, SECRET);
  const t = fresh.split(",")[0].slice(2);
  // Both signatures, one timestamp — the shape Stripe sends mid-roll.
  const header = `t=${t},${old.split(",")[1]},${fresh.split(",")[1]}`;

  assert.equal(
    verifyStripeSignature({ payload: body, header, secret: SECRET }).ok,
    true,
    "the new secret's signature was not accepted",
  );
  assert.equal(
    verifyStripeSignature({ payload: body, header, secret: "whsec_old_secret" })
      .ok,
    true,
    "the old secret's signature was not accepted",
  );
});

/* --------------------------------------------------------- the attacks */

check("A FORGED BODY IS REJECTED", () => {
  // The whole point. Sign a cheap invoice, send an expensive one.
  const header = signPayloadForTest(body, SECRET);
  const tampered = body.replace('"amount_total":1200', '"amount_total":1');
  const out = verifyStripeSignature({
    payload: tampered,
    header,
    secret: SECRET,
  });
  assert.equal(out.ok, false);
});

check("even whitespace changes the body", () => {
  // Which is why the route must read request.text() and never re-serialise
  // parsed JSON: the signature is over bytes, not over meaning.
  const header = signPayloadForTest(body, SECRET);
  const reserialised = JSON.stringify(JSON.parse(body), null, 2);
  assert.equal(
    verifyStripeSignature({ payload: reserialised, header, secret: SECRET }).ok,
    false,
  );
});

check("the wrong secret is rejected", () => {
  const header = signPayloadForTest(body, "whsec_somebody_elses");
  assert.equal(
    verifyStripeSignature({ payload: body, header, secret: SECRET }).ok,
    false,
  );
});

check("A v0 SIGNATURE IS NEVER ACCEPTED", () => {
  // Stripe sends a deliberately fake v0 alongside the real one. Accepting any
  // scheme that happens to verify is a downgrade attack with the door held
  // open — and here the "v0" is a perfectly valid HMAC, just under a scheme
  // that must be ignored.
  const t = Math.floor(Date.now() / 1000);
  const digest = crypto
    .createHmac("sha256", SECRET)
    .update(`${t}.${body}`, "utf8")
    .digest("hex");

  const out = verifyStripeSignature({
    payload: body,
    header: `t=${t},v0=${digest}`,
    secret: SECRET,
  });
  assert.equal(out.ok, false, "a v0 signature was accepted");
  assert.match(out.reason, /no timestamp or v1 signature/);
});

check("an unknown future scheme is ignored too", () => {
  const t = Math.floor(Date.now() / 1000);
  const digest = crypto
    .createHmac("sha256", SECRET)
    .update(`${t}.${body}`, "utf8")
    .digest("hex");
  assert.equal(
    verifyStripeSignature({
      payload: body,
      header: `t=${t},v2=${digest}`,
      secret: SECRET,
    }).ok,
    false,
  );
});

check("A REPLAYED REQUEST EXPIRES", () => {
  // Without a tolerance, a captured request stays valid for ever. The
  // signature here is perfectly genuine — it is only old.
  const old = Math.floor(Date.now() / 1000) - (DEFAULT_TOLERANCE_SECONDS + 60);
  const header = signPayloadForTest(body, SECRET, old);

  const out = verifyStripeSignature({ payload: body, header, secret: SECRET });
  assert.equal(out.ok, false, "a replayed request was accepted");
  assert.match(out.reason, /tolerance/);

  // And is accepted again if somebody widens the window, proving the
  // signature itself was fine and it really was the clock that rejected it.
  assert.equal(
    verifyStripeSignature({
      payload: body,
      header,
      secret: SECRET,
      toleranceSeconds: 86400,
    }).ok,
    true,
  );
});

check("a timestamp from the future is rejected as well", () => {
  // Signed with a clock set far ahead, which would otherwise buy an attacker
  // an arbitrarily long replay window.
  const ahead = Math.floor(Date.now() / 1000) + 3600;
  const header = signPayloadForTest(body, SECRET, ahead);
  assert.equal(
    verifyStripeSignature({ payload: body, header, secret: SECRET }).ok,
    false,
  );
});

check("the timestamp cannot be edited without breaking the signature", () => {
  // It is part of the signed payload, so moving it forward to defeat the
  // tolerance check invalidates the thing it was trying to sneak past.
  const old = Math.floor(Date.now() / 1000) - 10000;
  const header = signPayloadForTest(body, SECRET, old);
  const v1 = header.split(",")[1];
  const now = Math.floor(Date.now() / 1000);

  const out = verifyStripeSignature({
    payload: body,
    header: `t=${now},${v1}`,
    secret: SECRET,
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /no v1 signature matched/);
});

/* ------------------------------------------------------ nothing at all */

check("missing pieces are refused, not crashed on", () => {
  const header = signPayloadForTest(body, SECRET);
  for (const args of [
    { payload: body, header, secret: "" },
    { payload: "", header, secret: SECRET },
    { payload: body, header: "", secret: SECRET },
    { payload: body, header: "v1=abc", secret: SECRET },
    { payload: body, header: "t=notanumber,v1=abc", secret: SECRET },
    {},
  ]) {
    const out = verifyStripeSignature(args);
    assert.equal(out.ok, false, JSON.stringify(args).slice(0, 60));
    assert.ok(out.reason, "a refusal with no reason for the log");
  }
});

check("a signature of the wrong length does not throw", () => {
  // crypto.timingSafeEqual throws on a length mismatch, which would turn a
  // clumsy forgery into a 500 instead of a 400.
  const t = Math.floor(Date.now() / 1000);
  const out = verifyStripeSignature({
    payload: body,
    header: `t=${t},v1=short`,
    secret: SECRET,
  });
  assert.equal(out.ok, false);
});

const failed = results.filter(([s]) => s !== "pass");
for (const [status, name] of results) {
  if (status !== "pass") console.log(`  ${status}  ${name}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — ${failed.length} FAILED` : ""),
);
process.exitCode = failed.length ? 1 : 0;
