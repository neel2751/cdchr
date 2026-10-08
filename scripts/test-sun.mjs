/**
 * NTAG 424 DNA "SUN" verification.
 *
 * Two layers, and the first one matters more than it looks.
 *
 * **RFC 4493 vectors.** Node has no CMAC, so it is implemented in lib/sun.js
 * from the spec. A CMAC tested only against its own output is a CMAC tested
 * against nothing — these are the published vectors, so a mistake in the
 * subkey derivation or the padding shows up here rather than as tags that
 * mysteriously do not verify.
 *
 * **Forgery.** The whole value of a £3 chip over a printed code is that the
 * counter arrives inside something signed. Until this existed the counter was
 * read off the query string, so "replay protection" came down to asking the
 * attacker not to increment a number. Every negative case below is an attempt
 * to do exactly that.
 *
 * Pure — no database:
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-sun.mjs
 */
import assert from "node:assert";
import crypto from "node:crypto";

import { aesCmac, buildSunMessageForTest, verifySunMessage } from "@/lib/sun";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

/* ----------------------------------------------- RFC 4493, the published vectors */

const RFC_KEY = Buffer.from("2b7e151628aed2a6abf7158809cf4f3c", "hex");
const RFC_VECTORS = [
  ["", "bb1d6929e95937287fa37d129b756746"],
  ["6bc1bee22e409f96e93d7e117393172a", "070a16b46b4d4144f79bdd9dd04a287c"],
  [
    "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411",
    "dfa66747de9ae63030ca32611497c827",
  ],
  [
    "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710",
    "51f0bebf7e3b9d92fc49741779363cfe",
  ],
];

for (const [message, expected] of RFC_VECTORS) {
  check(`RFC 4493 vector, ${message.length / 2} byte message`, () => {
    const got = aesCmac(RFC_KEY, Buffer.from(message, "hex")).toString("hex");
    assert.equal(got, expected);
  });
}

check("AES-CMAC refuses a key that is not 16 bytes", () => {
  assert.throws(() => aesCmac(Buffer.alloc(8)));
});

/* ------------------------------------------------------------- a genuine tap */

const KEY = crypto.randomBytes(16);
const UID = "04AABBCCDDEE80";
const tap = (counter, over = {}) =>
  buildSunMessageForTest({ key: KEY, uid: UID, counter, ...over });

check("a genuine tap verifies, and yields its UID and counter", () => {
  const { picc, cmac } = tap(7);
  const r = verifySunMessage({ piccHex: picc, cmacHex: cmac, key: KEY });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.uid, UID);
  assert.equal(r.counter, 7);
});

check("the counter comes out of the signature, not the caller", () => {
  // The point of the whole file. Three different taps, three counters, and
  // nothing the caller passed had any say in them.
  for (const n of [1, 255, 256, 65535, 65536, 16777215]) {
    const { picc, cmac } = tap(n);
    const r = verifySunMessage({ piccHex: picc, cmacHex: cmac, key: KEY });
    assert.equal(r.ok, true, `counter ${n}: ${r.reason}`);
    assert.equal(r.counter, n, `counter ${n} round-trip`);
  }
});

check("hex is accepted however it is spelled", () => {
  const { picc, cmac } = tap(3);
  const r = verifySunMessage({
    piccHex: picc.toLowerCase(),
    cmacHex: cmac.toLowerCase(),
    key: KEY,
  });
  assert.equal(r.ok, true, r.reason);
});

/* ----------------------------------------------------------------- forgery */

check("FORGERY: a bumped counter fails", () => {
  // The attack the counter alone cannot stop: capture a URL, increment the
  // number, replay it. The CMAC covers the counter, so it no longer matches.
  const { picc, cmac } = tap(7);
  const bumped = Buffer.from(picc, "hex");
  bumped[0] ^= 0x01; // any change to the ciphertext changes the plaintext
  const r = verifySunMessage({
    piccHex: bumped.toString("hex"),
    cmacHex: cmac,
    key: KEY,
  });
  assert.equal(r.ok, false);
});

check("FORGERY: another tag's key does not verify", () => {
  const { picc, cmac } = tap(7);
  const r = verifySunMessage({
    piccHex: picc,
    cmacHex: cmac,
    key: crypto.randomBytes(16),
  });
  assert.equal(r.ok, false);
});

check("FORGERY: a tampered CMAC fails", () => {
  const { picc, cmac } = tap(7);
  const broken = Buffer.from(cmac, "hex");
  broken[0] ^= 0xff;
  const r = verifySunMessage({
    piccHex: picc,
    cmacHex: broken.toString("hex"),
    key: KEY,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /signature/i);
});

check("FORGERY: one tap's CMAC on another tap's picc fails", () => {
  // Mixing and matching captured parameters.
  const a = tap(7);
  const b = tap(8);
  const r = verifySunMessage({ piccHex: b.picc, cmacHex: a.cmac, key: KEY });
  assert.equal(r.ok, false);
});

check("FORGERY: an all-zero picc does not verify", () => {
  const r = verifySunMessage({
    piccHex: "00".repeat(16),
    cmacHex: "00".repeat(8),
    key: KEY,
  });
  assert.equal(r.ok, false);
});

check("a chip laid out differently is refused, not misread", () => {
  // Byte 0 says which fields follow. A chip configured another way would
  // otherwise be parsed as if it were ours, yielding a plausible wrong UID.
  const plain = Buffer.alloc(16);
  plain[0] = 0x99;
  const cipher = crypto.createCipheriv("aes-128-cbc", KEY, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  const picc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const r = verifySunMessage({
    piccHex: picc.toString("hex"),
    cmacHex: "00".repeat(8),
    key: KEY,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /layout/i);
});

/* --------------------------------------------------------------- malformed */

check("malformed input is refused rather than thrown", () => {
  const { picc, cmac } = tap(1);
  const bad = [
    { piccHex: null, cmacHex: cmac },
    { piccHex: picc, cmacHex: null },
    { piccHex: "zz", cmacHex: cmac },
    { piccHex: "aabb", cmacHex: cmac }, // too short
    { piccHex: picc, cmacHex: "aabb" },
    { piccHex: picc + "aa", cmacHex: cmac }, // too long
  ];
  for (const args of bad) {
    const r = verifySunMessage({ ...args, key: KEY });
    assert.equal(r.ok, false, `accepted ${JSON.stringify(args).slice(0, 60)}`);
    assert.ok(r.reason, "a refusal should say why");
  }
});

check("a key of the wrong size is refused", () => {
  const { picc, cmac } = tap(1);
  const r = verifySunMessage({
    piccHex: picc,
    cmacHex: cmac,
    key: Buffer.alloc(8),
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /key/i);
});

/* ----------------------------------------------------------------- report */

const failed = results.filter(([s]) => s !== "pass");
for (const [status, name] of results) {
  if (status !== "pass") console.log(`  ${status}  ${name}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — ${failed.length} FAILED` : ""),
);
process.exitCode = failed.length ? 1 : 0;
