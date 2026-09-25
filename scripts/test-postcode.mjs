/**
 * Postcodes: the shape rules, and what the lookup is allowed to conclude.
 *
 * The shape rules are pure and are the only thing anywhere that BLOCKS on a
 * postcode, so they are worth being sure about — a pattern that rejects a real
 * address is a customer who cannot order.
 *
 * The lookup is driven against a stubbed fetch. The cases that matter are the
 * ones where it must NOT be confident: a service outage has to read as
 * "unknown", never as "that postcode does not exist".
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-postcode.mjs
 */
import assert from "node:assert";

import {
  isValidUkPostcode,
  normalisePostcode,
  outwardCode,
  townsAgree,
} from "@/lib/postcode";
import { lookupPostcode } from "@/server/addressServer/postcode";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

/* ------------------------------------------------------------- the shape */

await check("real postcodes are accepted", () => {
  // Spread across every structural form the pattern has to admit. Each of
  // these is a real place; a "tidier" regex rejects at least one of them.
  for (const pc of [
    "SW1A 1AA", // AA9A 9AA — the awkward one
    "M1 1AE", // A9 9AA
    "B33 8TH", // A99 9AA
    "CR2 6XH", // AA9 9AA
    "DN55 1PT", // AA99 9AA
    "EC1A 1BB", // AA9A 9AA
    "W1A 0AX", // A9A 9AA
    "GIR 0AA", // Girobank, the one-off
  ]) {
    assert.ok(isValidUkPostcode(pc), `${pc} was rejected`);
  }
});

await check("case and spacing do not matter", () => {
  for (const pc of ["sw1a1aa", "SW1A1AA", "sw1a 1aa", "  SW1A   1AA  ", "sw1a-1aa"]) {
    assert.ok(isValidUkPostcode(pc), `${pc} was rejected`);
    assert.equal(normalisePostcode(pc), "SW1A 1AA");
  }
});

await check("rubbish is rejected", () => {
  for (const pc of [
    "",
    "NOTAPOSTCODE",
    "12345",
    "SW1A 1A",
    "SW1A 1AAA",
    "QW1A 1AA", // Q is not a valid first letter
    "SW1A 1CA", // C is not valid in the final pair
    "SW1A 1IA", // nor I
    null,
    undefined,
  ]) {
    assert.ok(!isValidUkPostcode(pc), `${pc} was accepted`);
  }
});

await check("VALID SHAPE IS NOT THE SAME AS REAL", () => {
  // Checked against the live service while writing this: each of these passes
  // the format check and 404s at postcodes.io. They are the examples the
  // government's own validation documentation uses, and they are not real
  // postcodes — which is the clearest argument there is for keeping "is it
  // shaped right" and "does it exist" as separate questions with different
  // consequences.
  for (const pc of ["DN55 1PT", "W1A 0AX", "PL1 1AA"]) {
    assert.ok(isValidUkPostcode(pc), `${pc} should pass the shape check`);
  }
});

await check("the outward code is the delivery office", () => {
  assert.equal(outwardCode("SW1A 1AA"), "SW1A");
  assert.equal(outwardCode("m11ae"), "M1");
  assert.equal(outwardCode(""), "");
});

/* --------------------------------------------------------- town matching */

await check("a town and its local authority usually agree", () => {
  assert.equal(townsAgree("Manchester", "Manchester"), true);
  assert.equal(townsAgree("manchester", "  Manchester  "), true);
  assert.equal(townsAgree("Leeds", "City of Leeds"), true);
});

await check("LONDON vs WESTMINSTER IS NOT A DISAGREEMENT", () => {
  // Verified against the live service: SW1A 1AA reports admin_district
  // "Westminster". Anybody sensible types "London". Both are correct, and
  // flagging it would train people to ignore the warning.
  assert.equal(townsAgree("London", "Westminster"), true);
  assert.equal(townsAgree("London", "City of London"), true);
});

await check("nothing to compare is not a disagreement", () => {
  assert.equal(townsAgree("", "Westminster"), true);
  assert.equal(townsAgree("London", ""), true);
});

await check("a town nowhere near the real one is caught", () => {
  assert.equal(townsAgree("Glasgow", "Manchester"), false);
});

/* -------------------------------------------------------------- lookup */

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const parse = async (promise) => JSON.parse((await promise).data);

const okResponse = (result) => ({
  ok: true,
  status: 200,
  json: async () => ({ status: 200, result }),
});

await check("a known postcode reports where it is", async () => {
  const out = await withFetch(
    async () =>
      okResponse({
        postcode: "M1 1AE",
        admin_district: "Manchester",
        region: "North West",
        country: "England",
      }),
    () => parse(lookupPostcode({ postcode: "m11ae", town: "Manchester" })),
  );
  assert.equal(out.normalised, "M1 1AE");
  assert.equal(out.valid, true);
  assert.equal(out.checked, true);
  assert.equal(out.known, true);
  assert.equal(out.district, "Manchester");
  assert.equal(out.townMatches, true);
});

await check("a malformed postcode never reaches the service", async () => {
  let called = false;
  const out = await withFetch(
    async () => {
      called = true;
      return okResponse({});
    },
    () => parse(lookupPostcode({ postcode: "NOPE" })),
  );
  assert.equal(called, false, "it asked about a postcode it knew was invalid");
  assert.equal(out.valid, false);
  assert.equal(out.checked, false);
});

await check("A 404 IS 'NOT IN THE LIST', NOT 'DOES NOT EXIST'", async () => {
  // ONS data lags new building by months, so a brand-new estate has a real,
  // deliverable postcode this service has never heard of. The wording has to
  // leave room for that, because the order is not blocked either way.
  const out = await withFetch(
    async () => ({ ok: false, status: 404, json: async () => ({}) }),
    // Valid shape on purpose — "ZZ9 9ZZ" is not, because Z is not legal in
    // the second position, and it would short-circuit before the lookup.
    () => parse(lookupPostcode({ postcode: "B99 9BB" })),
  );
  assert.equal(out.valid, true, "the shape was fine");
  assert.equal(out.checked, true);
  assert.equal(out.known, false);
  assert.match(out.message, /new build|retired|wrong/i);
});

await check("AN OUTAGE IS UNKNOWN, NOT ABSENT", async () => {
  // The dangerous confusion. Reporting "that postcode does not exist" on the
  // strength of a timeout would send somebody to correct a correct address.
  for (const impl of [
    async () => {
      throw new Error("network down");
    },
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => okResponse(null),
  ]) {
    const out = await withFetch(impl, () =>
      parse(lookupPostcode({ postcode: "SW1A 1AA" })),
    );
    assert.equal(out.valid, true);
    assert.equal(out.checked, false, "it claimed to have checked");
    assert.equal(out.known, false);
    assert.match(out.message, /could not be reached/i);
  }
});

await check("a town mismatch is reported without contradicting the postcode", async () => {
  const out = await withFetch(
    async () =>
      okResponse({
        postcode: "M1 1AE",
        admin_district: "Manchester",
        region: "North West",
        country: "England",
      }),
    () => parse(lookupPostcode({ postcode: "M1 1AE", town: "Glasgow" })),
  );
  assert.equal(out.known, true, "the postcode itself is fine");
  assert.equal(out.townMatches, false);
  assert.match(out.message, /Check the town/i);
});

await check("an answer is remembered rather than asked twice", async () => {
  // The service is free and unmetered by courtesy, not by contract. The same
  // postcode gets checked repeatedly while somebody edits a form.
  let calls = 0;
  const impl = async () => {
    calls++;
    return okResponse({
      postcode: "B33 8TH",
      admin_district: "Birmingham",
      region: "West Midlands",
      country: "England",
    });
  };
  await withFetch(impl, async () => {
    await parse(lookupPostcode({ postcode: "B33 8TH" }));
    await parse(lookupPostcode({ postcode: "b338th" }));
    await parse(lookupPostcode({ postcode: "  B33  8TH " }));
  });
  assert.equal(calls, 1, `asked ${calls} times for one postcode`);
});

await check("an empty postcode is not an error", async () => {
  const out = await parse(lookupPostcode({ postcode: "" }));
  assert.equal(out.empty, true);
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
