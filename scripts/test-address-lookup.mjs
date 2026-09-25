/**
 * PAF address lookup: the adapters, and the guards around a billable call.
 *
 * Driven against a stubbed fetch — these services have no free tier and no
 * usable test key, so a test that talked to one would either cost money on
 * every run or not run at all.
 *
 * The cases worth having are the ones where being wrong costs something: a
 * lookup that should never have been made, a service failure read as "no
 * addresses here", and a response shape parsed by position.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-address-lookup.mjs
 */
import assert from "node:assert";

import {
  ADDRESS_PROVIDERS,
  AddressLookupError,
  findAddressProvider,
} from "@/lib/addressProviders";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/* ------------------------------------------------------- the provider set */

await check("every provider is well formed", () => {
  const keys = new Set();
  for (const p of ADDRESS_PROVIDERS) {
    assert.ok(p.key && p.name, "provider missing key or name");
    assert.ok(!keys.has(p.key), `duplicate key ${p.key}`);
    keys.add(p.key);
    assert.equal(typeof p.lookup, "function", `${p.key} cannot look up`);
    assert.ok(p.needs?.length, `${p.key} needs nothing?`);
  }
  assert.equal(findAddressProvider("nope"), null);
});

/* ------------------------------------------------------- Ideal Postcodes */

const ideal = findAddressProvider("ideal-postcodes");

await check("Ideal Postcodes maps its fields onto ours", async () => {
  let seen = null;
  const rows = await withFetch(
    async (url) => {
      seen = url;
      return jsonResponse(200, {
        code: 2000,
        message: "Success",
        result: [
          {
            line_1: "Flat 1",
            line_2: "10 Downing Street",
            line_3: "Westminster",
            post_town: "LONDON",
            county: "Greater London",
            postcode: "SW1A 2AA",
            organisation_name: "",
          },
        ],
      });
    },
    () => ideal.lookup("SW1A 2AA", { apiKey: "k" }),
  );

  assert.match(seen, /\/v1\/postcodes\/SW1A%202AA\?api_key=k$/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line1, "Flat 1");
  // line_3 is folded in rather than dropped — losing part of an address is
  // how a parcel reaches the wrong flat.
  assert.equal(rows[0].line2, "10 Downing Street, Westminster");
  assert.equal(rows[0].city, "LONDON");
  assert.match(rows[0].label, /Flat 1.*Westminster.*SW1A 2AA/);
});

await check("an organisation name leads the first line", async () => {
  const rows = await withFetch(
    async () =>
      jsonResponse(200, {
        code: 2000,
        result: [
          {
            organisation_name: "Acme Ltd",
            line_1: "10 Downing Street",
            post_town: "LONDON",
            postcode: "SW1A 2AA",
          },
        ],
      }),
    () => ideal.lookup("SW1A 2AA", { apiKey: "k" }),
  );
  assert.equal(rows[0].line1, "Acme Ltd, 10 Downing Street");
});

await check("A BAD KEY ARRIVES AS HTTP 200", async () => {
  // Verified against the live service: Ideal Postcodes answers 200 with
  // {"code":4010}. Trusting the status alone would read a billing failure as
  // an empty postcode.
  await assert.rejects(
    () =>
      withFetch(
        async () =>
          jsonResponse(200, { code: 4010, message: "Invalid Key." }),
        () => ideal.lookup("SW1A 2AA", { apiKey: "wrong" }),
      ),
    /rejected the API key/,
  );
});

await check("4040 is an empty postcode, not a failure", async () => {
  // A postcode with nothing on it is a real answer and should not alarm
  // anybody — the customer types the address instead.
  const rows = await withFetch(
    async () => jsonResponse(200, { code: 4040, message: "Not found" }),
    () => ideal.lookup("B99 9BB", { apiKey: "k" }),
  );
  assert.deepEqual(rows, []);
});

await check("any other code carries their own message", async () => {
  await assert.rejects(
    () =>
      withFetch(
        async () =>
          jsonResponse(200, { code: 4020, message: "Daily limit reached" }),
        () => ideal.lookup("SW1A 2AA", { apiKey: "k" }),
      ),
    /Daily limit reached/,
  );
});

/* ---------------------------------------------------------- getAddress.io */

const getAddress = findAddressProvider("getaddress-io");

await check("getAddress.io expands rather than splitting strings", async () => {
  let seen = null;
  const rows = await withFetch(
    async (url) => {
      seen = url;
      return jsonResponse(200, {
        postcode: "NN1 3ER",
        addresses: [
          {
            line_1: "10 Watkin Terrace",
            line_2: "",
            line_3: "",
            line_4: "",
            town_or_city: "Northampton",
            county: "Northamptonshire",
          },
        ],
      });
    },
    () => getAddress.lookup("NN1 3ER", { apiKey: "k" }),
  );

  // The hyphenated parameter, which differs from Ideal Postcodes' underscore.
  assert.match(seen, /api-key=k/);
  assert.match(seen, /expand=true/);
  assert.equal(rows[0].line1, "10 Watkin Terrace");
  assert.equal(rows[0].city, "Northampton");
  assert.equal(rows[0].postcode, "NN1 3ER");
});

await check("AN UNEXPANDED STRING IS NOT SPLIT BY POSITION", async () => {
  // If expand is ignored the rows come back as comma-joined strings. Cutting
  // one up by position is exactly the guesswork this feature exists to stop,
  // so the whole line is handed over for a human to correct instead.
  const rows = await withFetch(
    async () =>
      jsonResponse(200, {
        postcode: "NN1 3ER",
        town_or_city: "Northampton",
        addresses: ["10 Watkin Terrace, , , Northampton, Northamptonshire"],
      }),
    () => getAddress.lookup("NN1 3ER", { apiKey: "k" }),
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].line1, /10 Watkin Terrace/);
  assert.equal(rows[0].city, "Northampton");
});

await check("getAddress.io 404 means no addresses, not an error", async () => {
  const rows = await withFetch(
    async () => ({ ok: false, status: 404, json: async () => ({}) }),
    () => getAddress.lookup("B99 9BB", { apiKey: "k" }),
  );
  assert.deepEqual(rows, []);
});

await check("a rejected key and a rate limit are told apart", async () => {
  await assert.rejects(
    () =>
      withFetch(
        async () => ({ ok: false, status: 401, json: async () => ({}) }),
        () => getAddress.lookup("NN1 3ER", { apiKey: "bad" }),
      ),
    /rejected the API key/,
  );

  await assert.rejects(
    () =>
      withFetch(
        async () => ({ ok: false, status: 429, json: async () => ({}) }),
        () => getAddress.lookup("NN1 3ER", { apiKey: "k" }),
      ),
    /rate limiting/,
  );
});

/* ----------------------------------------------------------- both of them */

await check("no key means no call at all", async () => {
  // A call without a key still counts against a quota on some plans, and
  // always wastes a round trip.
  for (const p of ADDRESS_PROVIDERS) {
    let called = false;
    await assert.rejects(
      () =>
        withFetch(
          async () => {
            called = true;
            return jsonResponse(200, {});
          },
          () => p.lookup("SW1A 2AA", {}),
        ),
      /No API key/,
      p.key,
    );
    assert.equal(called, false, `${p.key} called out with no key`);
  }
});

await check("a timeout is retryable and says nothing about the postcode", async () => {
  for (const p of ADDRESS_PROVIDERS) {
    await withFetch(
      async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
      async () => {
        try {
          await p.lookup("SW1A 2AA", { apiKey: "k" });
          assert.fail(`${p.key} should have thrown`);
        } catch (error) {
          assert.ok(error instanceof AddressLookupError, `${p.key}: wrong type`);
          assert.equal(error.retryable, true, `${p.key}: not retryable`);
          assert.match(error.message, /did not answer in time/);
        }
      },
    );
  }
});

await check("errors never carry the key", async () => {
  for (const p of ADDRESS_PROVIDERS) {
    await withFetch(
      async () => jsonResponse(500, { code: 5000, message: "boom" }),
      async () => {
        try {
          await p.lookup("SW1A 2AA", { apiKey: "super-secret-key" });
        } catch (error) {
          assert.ok(
            !error.message.includes("super-secret-key"),
            `${p.key} leaked the key`,
          );
        }
      },
    );
  }
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
