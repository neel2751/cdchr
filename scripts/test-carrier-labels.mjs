/**
 * Postage: sealing credentials, and the adapter contract.
 *
 * No database and no network. The Royal Mail adapter is driven against a
 * stubbed `fetch`, which is the only way to test it at all — nobody here has
 * an account, and a test that needed one would never run.
 *
 * What is worth testing without a live carrier is the part that costs money
 * when it is wrong: that a credential never comes back out in plain text, that
 * a half-answer is refused rather than stored, and that a carrier's own error
 * reaches the operator instead of being flattened into "something went wrong".
 *
 *   TAG_KEY_MASTER=$(openssl rand -hex 32) \
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-carrier-labels.mjs
 */
import assert from "node:assert";

import {
  openSecret,
  sealSecret,
  secretHint,
  secretsConfigured,
} from "@/lib/secretBox";
import {
  API_PROVIDERS,
  LABEL_PROVIDERS,
  LabelError,
  findProvider,
} from "@/lib/carrierProviders";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

if (!process.env.TAG_KEY_MASTER) {
  // Set here rather than required, so the suite runs anywhere. The sealing
  // tests need *a* key, not a particular one.
  process.env.TAG_KEY_MASTER = "a".repeat(64);
}

/* ------------------------------------------------------------- sealing */

await check("a sealed secret round-trips", () => {
  const sealed = sealSecret("rm_live_abc123");
  assert.notEqual(sealed, "rm_live_abc123", "it was stored in plain text");
  assert.equal(openSecret(sealed), "rm_live_abc123");
});

await check("the same secret seals differently every time", () => {
  // A fresh IV per seal. Identical ciphertexts would tell anyone reading the
  // database which two accounts share a key.
  assert.notEqual(sealSecret("same"), sealSecret("same"));
});

await check("a tampered secret is refused, not silently wrong", () => {
  // The point of GCM over a bare cipher: a credential that decrypts to rubbish
  // becomes an authentication failure nobody can explain.
  const sealed = sealSecret("rm_live_abc123");
  const [iv, tag, data] = sealed.split(":");
  const flipped = Buffer.from(data, "base64");
  flipped[0] ^= 0xff;
  assert.throws(() =>
    openSecret([iv, tag, flipped.toString("base64")].join(":")),
  );
});

await check("rubbish in is refused rather than parsed", () => {
  assert.throws(() => openSecret("not-a-secret"));
  assert.throws(() => openSecret(""));
  assert.throws(() => openSecret(null));
  assert.throws(() => openSecret("a:b:c"));
});

await check("nothing empty can be sealed", () => {
  // Sealing "" would store a valid-looking blob for a credential nobody set.
  assert.throws(() => sealSecret(""));
  assert.throws(() => sealSecret(null));
});

await check("a hint identifies a key without revealing it", () => {
  const hint = secretHint("rm_live_abcdef1234");
  assert.equal(hint, "····1234");
  assert.ok(!hint.includes("rm_live"), "the hint leaked the key");
  // Too short to hint at safely.
  assert.equal(secretHint("abc"), "····");
});

await check("sealing reports itself unconfigured without a key", () => {
  const saved = process.env.TAG_KEY_MASTER;
  delete process.env.TAG_KEY_MASTER;
  assert.equal(secretsConfigured(), false);
  assert.throws(() => sealSecret("x"), /TAG_KEY_MASTER/);
  process.env.TAG_KEY_MASTER = saved;
});

await check("a short master key is refused", () => {
  const saved = process.env.TAG_KEY_MASTER;
  process.env.TAG_KEY_MASTER = "abcd";
  assert.throws(() => sealSecret("x"), /32 bytes/);
  process.env.TAG_KEY_MASTER = saved;
});

/* ------------------------------------------------------ the provider set */

await check("manual is present and needs nothing", () => {
  // A carrier we never integrate must stay fully usable.
  const manual = findProvider("manual");
  assert.ok(manual, "there is no manual provider");
  assert.equal(manual.mode, "manual");
  assert.deepEqual(manual.needs, []);
});

await check("every provider is well formed", () => {
  const keys = new Set();
  for (const p of LABEL_PROVIDERS) {
    assert.ok(p.key && p.name, `provider missing key or name`);
    assert.ok(!keys.has(p.key), `duplicate provider key ${p.key}`);
    keys.add(p.key);
    assert.ok(["manual", "api"].includes(p.mode), `${p.key} has no mode`);
    if (p.mode === "api") {
      assert.equal(typeof p.buy, "function", `${p.key} cannot buy`);
      assert.ok(Array.isArray(p.needs) && p.needs.length, `${p.key} needs nothing?`);
    }
  }
  assert.ok(API_PROVIDERS.length >= 1, "no API provider at all");
});

/* ------------------------------------------------ the Royal Mail adapter */

const rm = findProvider("royal-mail");

const ctx = {
  order: { orderNumber: "TAG-260924-AAAA" },
  shipment: { reference: "TAG-260924-AAAA/1" },
  address: {
    name: "Site Office",
    company: "Acme",
    line1: "1 Elm Street",
    city: "London",
    postcode: "SW1A 1AA",
    countryCode: "GB",
  },
  weightGrams: 240,
  parcelCount: 1,
};

/** Replace global fetch for one call. */
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

await check("a good answer yields a tracking number and a label", async () => {
  let sent = null;
  const res = await withFetch(
    async (url, options) => {
      sent = { url, options };
      return jsonResponse(200, {
        createdOrders: [
          {
            orderIdentifier: 99,
            trackingNumber: "AB123456789GB",
            label: "JVBERi0xLjQK",
          },
        ],
      });
    },
    () => rm.buy(ctx, { apiKey: "secret-key" }),
  );

  assert.equal(res.trackingNumber, "AB123456789GB");
  assert.equal(res.labelBase64, "JVBERi0xLjQK");
  assert.equal(res.labelFormat, "pdf");
  assert.equal(res.reference, "99");

  // The request is shaped the way the published spec asks for.
  assert.match(sent.url, /\/orders$/);
  assert.equal(sent.options.method, "POST");
  assert.equal(sent.options.headers.Authorization, "Bearer secret-key");
  const body = JSON.parse(sent.options.body);
  const item = body.items[0];
  assert.equal(item.recipient.address.addressLine1, "1 Elm Street");
  assert.equal(item.recipient.address.city, "London");
  assert.equal(item.recipient.address.countryCode, "GB");
  assert.equal(item.packages[0].weightInGrams, 240);
  assert.equal(item.label.includeLabelInResponse, true);
});

await check("one package per parcel", async () => {
  const res = await withFetch(
    async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.items[0].packages.length, 3);
      return jsonResponse(200, {
        createdOrders: [{ trackingNumber: "T", label: "L" }],
      });
    },
    () => rm.buy({ ...ctx, parcelCount: 3 }, { apiKey: "k" }),
  );
  assert.ok(res.trackingNumber);
});

await check("A HALF ANSWER IS REFUSED", async () => {
  // A tracking number with no label is postage nobody can print; a label with
  // no tracking number cannot be followed. Storing either would be worse than
  // failing, because the shipment would look finished.
  await assert.rejects(
    () =>
      withFetch(
        async () =>
          jsonResponse(200, {
            createdOrders: [{ trackingNumber: "AB123456789GB" }],
          }),
        () => rm.buy(ctx, { apiKey: "k" }),
      ),
    /incomplete/i,
  );

  await assert.rejects(
    () =>
      withFetch(
        async () => jsonResponse(200, { createdOrders: [{ label: "x" }] }),
        () => rm.buy(ctx, { apiKey: "k" }),
      ),
    /incomplete/i,
  );
});

await check("a label error is reported, not swallowed", async () => {
  // Royal Mail can create the order and fail the label. That is not success.
  await assert.rejects(
    () =>
      withFetch(
        async () =>
          jsonResponse(200, {
            createdOrders: [{ trackingNumber: "T" }],
            labelErrors: [{ errorMessage: "Invalid postcode" }],
          }),
        () => rm.buy(ctx, { apiKey: "k" }),
      ),
    /Invalid postcode/,
  );
});

await check("a rejected key says so plainly", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      () =>
        withFetch(
          async () => jsonResponse(status, {}),
          () => rm.buy(ctx, { apiKey: "wrong" }),
        ),
      /rejected the API key/,
    );
  }
});

await check("the carrier's own message reaches the operator", async () => {
  // More specific than anything we could invent, and actionable.
  await assert.rejects(
    () =>
      withFetch(
        async () => jsonResponse(400, { message: "weightInGrams is required" }),
        () => rm.buy(ctx, { apiKey: "k" }),
      ),
    /weightInGrams is required/,
  );
});

await check("a non-JSON answer does not crash the adapter", async () => {
  await assert.rejects(
    () =>
      withFetch(
        async () => ({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error("not json");
          },
        }),
        () => rm.buy(ctx, { apiKey: "k" }),
      ),
    /not JSON/,
  );
});

await check("a timeout says the label may still exist", async () => {
  // The dangerous case: a request that timed out may have bought postage at
  // the other end. Reporting it as a plain failure invites a second purchase.
  await assert.rejects(
    () =>
      withFetch(
        async () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          throw e;
        },
        () => rm.buy(ctx, { apiKey: "k" }),
      ),
    /may still have been bought/,
  );
});

await check("no key means no call at all", async () => {
  let called = false;
  await assert.rejects(
    () =>
      withFetch(
        async () => {
          called = true;
          return jsonResponse(200, {});
        },
        () => rm.buy(ctx, {}),
      ),
    /No API key/,
  );
  assert.equal(called, false, "it called the carrier without a key");
});

await check("errors are LabelErrors, so callers can show them", async () => {
  // A raw exception message could carry anything, including a credential.
  // LabelError is the promise that a message is safe to put on a screen.
  await withFetch(
    async () => jsonResponse(400, { message: "nope" }),
    async () => {
      try {
        await rm.buy(ctx, { apiKey: "super-secret-key" });
        assert.fail("it should have thrown");
      } catch (error) {
        assert.ok(error instanceof LabelError, "not a LabelError");
        assert.ok(
          !error.message.includes("super-secret-key"),
          "the error leaked the credential",
        );
      }
    },
  );
});

/* ------------------------------------------------------ the DPD adapter */

const dpd = findProvider("dpd");

const dpdCreds = {
  username: "user",
  password: "pass",
  accountNumber: "123456",
  networkCode: "1^12",
};

const dpdCtx = {
  ...ctx,
  from: {
    name: "Us Ltd",
    address: "Unit 4\nSomewhere\nManchester\nM1 1AA",
    contact: "0161 000 0000",
  },
};

const pdfBytes = () => {
  const buf = Buffer.from("%PDF-1.4 fake");
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
  };
};

/** A fetch that answers DPD's three calls in order. */
function dpdFetch({ login, shipment, label } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("action=login")) {
      return login || jsonResponse(200, { data: { geoSession: "SESSION-1" } });
    }
    if (url.endsWith("/shipping/shipment")) {
      return (
        shipment ||
        jsonResponse(200, {
          data: {
            shipmentId: 4242,
            consignmentDetail: [{ consignmentNumber: "15501234567890" }],
          },
        })
      );
    }
    return label || pdfBytes();
  };
  impl.calls = calls;
  return impl;
}

await check("DPD logs in, ships, then fetches the label", async () => {
  const impl = dpdFetch();
  const res = await withFetch(impl, () => dpd.buy(dpdCtx, dpdCreds));

  assert.equal(res.trackingNumber, "15501234567890");
  assert.equal(res.labelFormat, "pdf");
  assert.equal(res.reference, "4242");
  assert.ok(
    Buffer.from(res.labelBase64, "base64").toString().startsWith("%PDF"),
    "the label is not a PDF",
  );

  assert.equal(impl.calls.length, 3, "expected login, shipment, label");

  // Basic auth on login; the session carried on the calls after it.
  const expected = Buffer.from("user:pass").toString("base64");
  assert.equal(impl.calls[0].options.headers.Authorization, `Basic ${expected}`);
  assert.equal(impl.calls[0].options.headers.GEOClient, "account/123456");
  assert.equal(impl.calls[1].options.headers.GEOSession, "SESSION-1");
  assert.equal(impl.calls[2].options.headers.Accept, "application/pdf");
});

await check("DPD is sent kilograms, never zero", async () => {
  // Royal Mail wants grams and DPD wants kilos. Rounding 240g to 0 would be a
  // refusal nobody could read.
  const impl = dpdFetch();
  await withFetch(impl, () =>
    dpd.buy({ ...dpdCtx, weightGrams: 240 }, dpdCreds),
  );
  const body = JSON.parse(impl.calls[1].options.body);
  assert.equal(body.consignment[0].totalWeight, 0.24);

  const light = dpdFetch();
  await withFetch(light, () => dpd.buy({ ...dpdCtx, weightGrams: 5 }, dpdCreds));
  const lightBody = JSON.parse(light.calls[1].options.body);
  assert.ok(lightBody.consignment[0].totalWeight > 0, "a weightless consignment");
});

await check("the delivery address goes in DPD's fields", async () => {
  const impl = dpdFetch();
  await withFetch(impl, () => dpd.buy(dpdCtx, dpdCreds));
  const to = JSON.parse(impl.calls[1].options.body).consignment[0].deliveryDetails
    .address;
  assert.equal(to.street, "1 Elm Street");
  assert.equal(to.town, "London");
  assert.equal(to.postcode, "SW1A 1AA");
  assert.equal(to.countryCode, "GB");
});

await check("the service code is the stored one, not a guess", async () => {
  // A wrong network code is the wrong service at the wrong price.
  const impl = dpdFetch();
  await withFetch(impl, () =>
    dpd.buy(dpdCtx, { ...dpdCreds, networkCode: "2^99" }),
  );
  const body = JSON.parse(impl.calls[1].options.body);
  assert.equal(body.consignment[0].networkCode, "2^99");
});

await check("a bad DPD login never reaches the shipment call", async () => {
  const impl = dpdFetch({ login: jsonResponse(401, {}) });
  await assert.rejects(
    () => withFetch(impl, () => dpd.buy(dpdCtx, dpdCreds)),
    /rejected the username or password/,
  );
  assert.equal(impl.calls.length, 1, "it carried on after a failed login");
});

await check("a missing DPD credential makes no call at all", async () => {
  for (const field of ["username", "password", "accountNumber", "networkCode"]) {
    const creds = { ...dpdCreds };
    delete creds[field];
    const impl = dpdFetch();
    await assert.rejects(
      () => withFetch(impl, () => dpd.buy(dpdCtx, creds)),
      new RegExp(`No ${field} is stored`),
    );
    assert.equal(impl.calls.length, 0, `it called DPD without ${field}`);
  }
});

await check("DPD's error inside a 200 is still a failure", async () => {
  // DPD reports business failures in the body as well as by status code.
  // Treating a 200 as success would store a consignment that does not exist.
  const impl = dpdFetch({
    shipment: jsonResponse(200, {
      error: [{ errorMessage: "Invalid network code" }],
    }),
  });
  await assert.rejects(
    () => withFetch(impl, () => dpd.buy(dpdCtx, dpdCreds)),
    /Invalid network code/,
  );
});

await check("A FAILED LABEL FETCH SENDS SOMEBODY TO MYDPD", async () => {
  // The consignment already exists at DPD and is chargeable. A message that
  // implied nothing happened would invite a second one.
  const impl = dpdFetch({ label: { ok: false, status: 500 } });
  await assert.rejects(
    () => withFetch(impl, () => dpd.buy(dpdCtx, dpdCreds)),
    /15501234567890.*MyDPD/s,
  );
});

await check("an empty label is not treated as a label", async () => {
  const empty = Buffer.alloc(0);
  const impl = dpdFetch({
    label: {
      ok: true,
      status: 200,
      arrayBuffer: async () => empty.buffer,
    },
  });
  await assert.rejects(
    () => withFetch(impl, () => dpd.buy(dpdCtx, dpdCreds)),
    /empty label/,
  );
});

await check("an incomplete DPD shipment is refused", async () => {
  const noTracking = dpdFetch({
    shipment: jsonResponse(200, { data: { shipmentId: 1 } }),
  });
  await assert.rejects(
    () => withFetch(noTracking, () => dpd.buy(dpdCtx, dpdCreds)),
    /incomplete/i,
  );
});

await check("testing DPD only logs in", async () => {
  const impl = dpdFetch();
  await withFetch(impl, () => dpd.test(dpdCreds));
  assert.equal(impl.calls.length, 1, "the test bought something");
});

await check("EVRI IS ABSENT ON PURPOSE", async () => {
  // Evri publishes no API reference and no machine-readable specification;
  // access is arranged through an account manager and the endpoint shapes are
  // not public. An adapter written from guesswork would look like a working
  // option and fail as though this code were buggy.
  assert.equal(
    findProvider("evri"),
    null,
    "an Evri adapter appeared — it cannot have been written from a spec",
  );
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
