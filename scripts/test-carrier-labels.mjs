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
  canCancel,
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

/* ------------------------------------------------------ the UPS adapter */

const ups = findProvider("ups");

const upsCreds = {
  clientId: "cid",
  clientSecret: "csecret",
  accountNumber: "A1B2C3",
  serviceCode: "11",
  environment: "test",
};

const upsCtx = { ...dpdCtx };

/** A fetch answering UPS's token call then its ship call. */
function upsFetch({ token, ship } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/security/v1/oauth/token")) {
      return token || jsonResponse(200, { access_token: "TOK-1" });
    }
    return (
      ship ||
      jsonResponse(200, {
        ShipmentResponse: {
          ShipmentResults: {
            ShipmentIdentificationNumber: "1Z999AA10123456784",
            PackageResults: {
              ShippingLabel: { GraphicImage: "R0lGODlhAQAB" },
            },
          },
        },
      })
    );
  };
  impl.calls = calls;
  return impl;
}

await check("UPS gets a token, then ships", async () => {
  const impl = upsFetch();
  const res = await withFetch(impl, () => ups.buy(upsCtx, upsCreds));

  assert.equal(res.trackingNumber, "1Z999AA10123456784");
  assert.equal(res.labelBase64, "R0lGODlhAQAB");
  assert.equal(res.labelFormat, "gif");
  assert.equal(impl.calls.length, 2);

  // Token: Basic auth and a form body. UPS rejects JSON on this call.
  const expected = Buffer.from("cid:csecret").toString("base64");
  assert.equal(impl.calls[0].options.headers.Authorization, `Basic ${expected}`);
  assert.equal(
    impl.calls[0].options.headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  assert.equal(impl.calls[0].options.body, "grant_type=client_credentials");

  assert.equal(impl.calls[1].options.headers.Authorization, "Bearer TOK-1");
});

await check("THE TEST HOST IS THE DEFAULT", async () => {
  // No adapter here has been run for real, so the first call any of them
  // makes should be somewhere that cannot charge anybody.
  const impl = upsFetch();
  await withFetch(impl, () => ups.buy(upsCtx, upsCreds));
  assert.ok(
    impl.calls.every((c) => c.url.startsWith("https://wwwcie.ups.com")),
    `a test purchase hit ${impl.calls[0].url}`,
  );

  const live = upsFetch();
  await withFetch(live, () =>
    ups.buy(upsCtx, { ...upsCreds, environment: "production" }),
  );
  assert.ok(
    live.calls.every((c) => c.url.startsWith("https://onlinetools.ups.com")),
    "production did not use the live host",
  );
});

await check("ONE PACKAGE IS AN OBJECT, SEVERAL ARE AN ARRAY", async () => {
  // The UPS trap. Reading [0] of an object yields undefined, which would read
  // as "no label" on a shipment UPS has already charged for.
  const single = upsFetch();
  const one = await withFetch(single, () => ups.buy(upsCtx, upsCreds));
  assert.equal(one.labelBase64, "R0lGODlhAQAB", "the object form was missed");

  const many = upsFetch({
    ship: jsonResponse(200, {
      ShipmentResponse: {
        ShipmentResults: {
          ShipmentIdentificationNumber: "1Z999AA10123456784",
          PackageResults: [
            { ShippingLabel: { GraphicImage: "FIRST" } },
            { ShippingLabel: { GraphicImage: "SECOND" } },
          ],
        },
      },
    }),
  });
  const two = await withFetch(many, () =>
    ups.buy({ ...upsCtx, parcelCount: 2 }, upsCreds),
  );
  assert.equal(two.labelBase64, "FIRST", "the array form was missed");
});

await check("weight is a string, in kilos, per parcel", async () => {
  // UPS rejects a number here, and declaring the whole consignment on each
  // box would over-declare it.
  const impl = upsFetch();
  await withFetch(impl, () =>
    ups.buy({ ...upsCtx, weightGrams: 1000, parcelCount: 2 }, upsCreds),
  );
  const pkgs = JSON.parse(impl.calls[1].options.body).ShipmentRequest.Shipment
    .Package;
  assert.equal(pkgs.length, 2);
  assert.equal(typeof pkgs[0].PackageWeight.Weight, "string");
  assert.equal(pkgs[0].PackageWeight.Weight, "0.5");
  assert.equal(pkgs[0].PackageWeight.UnitOfMeasurement.Code, "KGS");
});

await check("payment information is always sent", async () => {
  // Without it UPS refuses rather than defaulting to billing the shipper.
  const impl = upsFetch();
  await withFetch(impl, () => ups.buy(upsCtx, upsCreds));
  const shipment = JSON.parse(impl.calls[1].options.body).ShipmentRequest
    .Shipment;
  assert.equal(
    shipment.PaymentInformation.ShipmentCharge.BillShipper.AccountNumber,
    "A1B2C3",
  );
  assert.equal(shipment.Service.Code, "11");
});

await check("the delivery address goes in UPS's fields", async () => {
  const impl = upsFetch();
  await withFetch(impl, () => ups.buy(upsCtx, upsCreds));
  const to = JSON.parse(impl.calls[1].options.body).ShipmentRequest.Shipment
    .ShipTo.Address;
  assert.deepEqual(to.AddressLine, ["1 Elm Street"]);
  assert.equal(to.City, "London");
  assert.equal(to.PostalCode, "SW1A 1AA");
  assert.equal(to.CountryCode, "GB");
});

await check("a bad UPS token never reaches the ship call", async () => {
  const impl = upsFetch({ token: jsonResponse(401, {}) });
  await assert.rejects(
    () => withFetch(impl, () => ups.buy(upsCtx, upsCreds)),
    /rejected the client ID or secret/,
  );
  assert.equal(impl.calls.length, 1, "it shipped after a failed token");
});

await check("a missing UPS credential makes no call at all", async () => {
  for (const field of ["clientId", "clientSecret", "accountNumber", "serviceCode"]) {
    const creds = { ...upsCreds };
    delete creds[field];
    const impl = upsFetch();
    await assert.rejects(
      () => withFetch(impl, () => ups.buy(upsCtx, creds)),
      new RegExp(`No ${field} is stored`),
    );
    assert.equal(impl.calls.length, 0, `it called UPS without ${field}`);
  }
});

await check("UPS's own error reaches the operator", async () => {
  const impl = upsFetch({
    ship: jsonResponse(400, {
      response: { errors: [{ code: "120100", message: "Missing PostalCode" }] },
    }),
  });
  await assert.rejects(
    () => withFetch(impl, () => ups.buy(upsCtx, upsCreds)),
    /Missing PostalCode/,
  );
});

await check("an incomplete UPS shipment is refused", async () => {
  const noLabel = upsFetch({
    ship: jsonResponse(200, {
      ShipmentResponse: {
        ShipmentResults: { ShipmentIdentificationNumber: "1Z9" },
      },
    }),
  });
  await assert.rejects(
    () => withFetch(noLabel, () => ups.buy(upsCtx, upsCreds)),
    /incomplete/i,
  );
});

await check("testing UPS only fetches a token", async () => {
  const impl = upsFetch();
  await withFetch(impl, () => ups.test(upsCreds));
  assert.equal(impl.calls.length, 1, "the test shipped something");
});

/* ---------------------------------------------------- the Yodel adapter */

const yodel = findProvider("yodel");

const yodelCreds = {
  apiKey: "ykey",
  authHeader: "X-Apikey",
  accountNumber: "Y1234",
  serviceCode: "STD",
  environment: "test",
};

function yodelFetch({ create, confirm, label } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/confirm")) {
      return confirm || jsonResponse(200, { trackingNumber: "JD0002222333" });
    }
    if (url.includes("/label")) return label || pdfBytes();
    return create || jsonResponse(200, { orderId: "ORD-77" });
  };
  impl.calls = calls;
  return impl;
}

await check("Yodel creates, confirms, then fetches the label", async () => {
  const impl = yodelFetch();
  const res = await withFetch(impl, () => yodel.buy(dpdCtx, yodelCreds));

  assert.equal(res.trackingNumber, "JD0002222333");
  assert.equal(res.labelFormat, "pdf");
  assert.equal(res.reference, "ORD-77");
  assert.equal(impl.calls.length, 3, "expected create, confirm, label");

  assert.match(impl.calls[0].url, /\/shipping\/v1\.0\/orders$/);
  assert.match(impl.calls[1].url, /\/orders\/ORD-77\/confirm$/);
  assert.match(impl.calls[2].url, /\/orders\/ORD-77\/label\?format=pdf$/);
});

await check("the sandbox is used unless a production base is stored", async () => {
  // Yodel does not publish a live host, so there is nothing to guess at. A
  // guessed production hostname either does not resolve or is somebody else's.
  const sandbox = yodelFetch();
  await withFetch(sandbox, () =>
    yodel.buy(dpdCtx, { ...yodelCreds, environment: "production" }),
  );
  assert.ok(
    sandbox.calls.every((c) => c.url.startsWith("https://api-sb.yodel.co.uk")),
    "it invented a production host",
  );

  const live = yodelFetch();
  await withFetch(live, () =>
    yodel.buy(dpdCtx, {
      ...yodelCreds,
      environment: "production",
      productionBase: "https://api.yodel.example/",
    }),
  );
  assert.ok(
    live.calls.every((c) => c.url.startsWith("https://api.yodel.example/shipping")),
    "a stored production base was ignored, or the trailing slash doubled",
  );
});

await check("the API key header name is configurable", async () => {
  // Which header Yodel wants is not published. Hard-coding a guess would make
  // a wrong one unfixable without a deploy.
  const impl = yodelFetch();
  await withFetch(impl, () =>
    yodel.buy(dpdCtx, { ...yodelCreds, authHeader: "apikey" }),
  );
  assert.equal(impl.calls[0].options.headers.apikey, "ykey");
  assert.equal(impl.calls[0].options.headers["X-Apikey"], undefined);

  const dflt = yodelFetch();
  await withFetch(dflt, () =>
    yodel.buy(dpdCtx, { ...yodelCreds, authHeader: "" }),
  );
  assert.equal(dflt.calls[0].options.headers["X-Apikey"], "ykey");
});

await check("YODEL'S OWN ERROR IS PASSED THROUGH VERBATIM", async () => {
  // The whole reason this adapter is worth shipping provisional: the body
  // shape is inferred, and Yodel's message names the field that is wrong.
  for (const payload of [
    { message: "deliveryAddress.town is required" },
    { errors: [{ message: "deliveryAddress.town is required" }] },
    { fault: { faultstring: "deliveryAddress.town is required" } },
  ]) {
    await assert.rejects(
      () =>
        withFetch(yodelFetch({ create: jsonResponse(400, payload) }), () =>
          yodel.buy(dpdCtx, yodelCreds),
        ),
      /deliveryAddress\.town is required/,
      `the message was lost from ${JSON.stringify(payload)}`,
    );
  }
});

await check("a rejected key names the header as a suspect", async () => {
  // A 401 here is as likely to be the wrong header name as the wrong key,
  // because the header is not published. Saying so saves an hour.
  await assert.rejects(
    () =>
      withFetch(yodelFetch({ create: jsonResponse(401, {}) }), () =>
        yodel.buy(dpdCtx, yodelCreds),
      ),
    /header name/,
  );
});

await check("an unconfirmed order is not treated as shipped", async () => {
  // A draft has no label and was never collected. It exists at Yodel, so the
  // message sends somebody there rather than implying nothing happened.
  await assert.rejects(
    () =>
      withFetch(
        yodelFetch({ confirm: jsonResponse(500, {}) }),
        () => yodel.buy(dpdCtx, yodelCreds),
      ),
    /ORD-77.*Yodel/s,
  );
});

await check("an unrecognised order id fails loudly", async () => {
  // Rather than carrying `undefined` into the next URL and 404ing somewhere
  // confusing.
  await assert.rejects(
    () =>
      withFetch(yodelFetch({ create: jsonResponse(200, { weird: 1 }) }), () =>
        yodel.buy(dpdCtx, yodelCreds),
      ),
    /order id this adapter recognises/,
  );
});

await check("a label with no tracking number is refused", async () => {
  await assert.rejects(
    () =>
      withFetch(
        yodelFetch({ confirm: jsonResponse(200, {}), create: jsonResponse(200, { orderId: "ORD-77" }) }),
        () => yodel.buy(dpdCtx, yodelCreds),
      ),
    /no tracking number/,
  );
});

await check("testing Yodel creates nothing", async () => {
  const impl = yodelFetch();
  await withFetch(impl, () => yodel.test(yodelCreds));
  assert.equal(impl.calls.length, 1);
  assert.equal(impl.calls[0].options.method, "GET", "the test created an order");
});

await check("Yodel is flagged provisional", async () => {
  // Half verified, half inferred. That belongs on the screen, not only here.
  assert.equal(yodel.provisional, true);
  assert.ok(yodel.provisionalNote?.length > 40, "no note to show an operator");
  assert.ok(
    LABEL_PROVIDERS.filter((p) => p.mode === "api" && !p.provisional).length >= 3,
    "the verified adapters should not be flagged provisional",
  );
});

/* ------------------------------------------------------ the DHL adapter */

const dhl = findProvider("dhl");

const dhlCreds = {
  apiKey: "dkey",
  apiSecret: "dsecret",
  accountNumber: "D9999",
  productCode: "N",
  environment: "test",
};

function dhlFetch({ ship } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return (
      ship ||
      jsonResponse(200, {
        shipmentTrackingNumber: "1234567890",
        documents: [
          { typeCode: "label", imageFormat: "PDF", content: "JVBERi0=" },
        ],
      })
    );
  };
  impl.calls = calls;
  return impl;
}

await check("DHL ships in one call, with pre-emptive Basic auth", async () => {
  const impl = dhlFetch();
  const res = await withFetch(impl, () => dhl.buy(dpdCtx, dhlCreds));

  assert.equal(res.trackingNumber, "1234567890");
  assert.equal(res.labelBase64, "JVBERi0=");
  assert.equal(res.labelFormat, "pdf");
  assert.equal(impl.calls.length, 1);

  const expected = Buffer.from("dkey:dsecret").toString("base64");
  assert.equal(impl.calls[0].options.headers.Authorization, `Basic ${expected}`);
  assert.match(impl.calls[0].url, /\/mydhlapi\/test\/shipments$/);
});

await check("DHL's sandbox is the default host", async () => {
  const test = dhlFetch();
  await withFetch(test, () => dhl.buy(dpdCtx, dhlCreds));
  assert.ok(impliesTest(test.calls[0].url), test.calls[0].url);

  const live = dhlFetch();
  await withFetch(live, () =>
    dhl.buy(dpdCtx, { ...dhlCreds, environment: "production" }),
  );
  assert.equal(
    live.calls[0].url,
    "https://express.api.dhl.com/mydhlapi/shipments",
  );
});

function impliesTest(url) {
  return url.startsWith("https://express.api.dhl.com/mydhlapi/test");
}

await check("the shipment path is configurable", async () => {
  // DHL does not publish it outside their login, so a wrong default must be
  // fixable without a deploy.
  const impl = dhlFetch();
  await withFetch(impl, () =>
    dhl.buy(dpdCtx, { ...dhlCreds, shipmentPath: "/shipment" }),
  );
  assert.match(impl.calls[0].url, /\/mydhlapi\/test\/shipment$/);
});

await check("THE SHIPPING DATE IS DHL'S FORMAT, NOT ISO 8601", async () => {
  // A plain toISOString() is rejected, and the message does not make the
  // reason obvious — which is a long afternoon.
  const impl = dhlFetch();
  await withFetch(impl, () => dhl.buy(dpdCtx, dhlCreds));
  const when = JSON.parse(impl.calls[0].options.body).plannedShippingDateAndTime;
  assert.match(when, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} GMT\+00:00$/, when);
  assert.ok(!when.endsWith("Z"), "it sent an ISO timestamp");
});

await check("weight is per parcel, in kilos, and never zero", async () => {
  const impl = dhlFetch();
  await withFetch(impl, () =>
    dhl.buy({ ...dpdCtx, weightGrams: 1000, parcelCount: 2 }, dhlCreds),
  );
  const packages = JSON.parse(impl.calls[0].options.body).content.packages;
  assert.equal(packages.length, 2);
  assert.equal(packages[0].weight, 0.5);

  const light = dhlFetch();
  await withFetch(light, () => dhl.buy({ ...dpdCtx, weightGrams: 1 }, dhlCreds));
  assert.ok(
    JSON.parse(light.calls[0].options.body).content.packages[0].weight > 0,
    "a weightless package",
  );
});

await check("a box size is declared, and is configurable", async () => {
  // DHL Express prices on size as well as weight. Ours are uniform, so the
  // box is declared on the account rather than measured per shipment.
  const dflt = dhlFetch();
  await withFetch(dflt, () => dhl.buy(dpdCtx, dhlCreds));
  assert.deepEqual(
    JSON.parse(dflt.calls[0].options.body).content.packages[0].dimensions,
    { length: 20, width: 15, height: 10 },
  );

  const custom = dhlFetch();
  await withFetch(custom, () =>
    dhl.buy(dpdCtx, { ...dhlCreds, parcelSizeCm: "30 x 20 x 5" }),
  );
  assert.deepEqual(
    JSON.parse(custom.calls[0].options.body).content.packages[0].dimensions,
    { length: 30, width: 20, height: 5 },
  );

  // Rubbish falls back rather than sending NaN, which DHL would reject with
  // a message about a field nobody typed.
  const bad = dhlFetch();
  await withFetch(bad, () =>
    dhl.buy(dpdCtx, { ...dhlCreds, parcelSizeCm: "big" }),
  );
  assert.deepEqual(
    JSON.parse(bad.calls[0].options.body).content.packages[0].dimensions,
    { length: 20, width: 15, height: 10 },
  );
});

await check("a domestic shipment is not customs-declarable", async () => {
  // Declaring a GB-to-GB parcel customs-declarable asks for an invoice DHL
  // then refuses the shipment for not having.
  const home = dhlFetch();
  await withFetch(home, () => dhl.buy(dpdCtx, dhlCreds));
  assert.equal(
    JSON.parse(home.calls[0].options.body).content.isCustomsDeclarable,
    false,
  );

  const abroad = dhlFetch();
  await withFetch(abroad, () =>
    dhl.buy(
      { ...dpdCtx, address: { ...dpdCtx.address, countryCode: "IE" } },
      dhlCreds,
    ),
  );
  assert.equal(
    JSON.parse(abroad.calls[0].options.body).content.isCustomsDeclarable,
    true,
  );
});

await check("THE LABEL IS PICKED BY TYPE, NOT BY POSITION", async () => {
  // `documents` carries invoices and customs papers too. [0] is only the
  // label until a shipment needs an invoice as well.
  const impl = dhlFetch({
    ship: jsonResponse(200, {
      shipmentTrackingNumber: "1234567890",
      documents: [
        { typeCode: "invoice", imageFormat: "PDF", content: "INVOICE" },
        { typeCode: "label", imageFormat: "PDF", content: "THELABEL" },
      ],
    }),
  });
  const res = await withFetch(impl, () => dhl.buy(dpdCtx, dhlCreds));
  assert.equal(res.labelBase64, "THELABEL", "it grabbed the invoice");
});

await check("an unknown image format falls back to pdf", async () => {
  const impl = dhlFetch({
    ship: jsonResponse(200, {
      shipmentTrackingNumber: "1",
      documents: [{ typeCode: "label", imageFormat: "EPL2", content: "X" }],
    }),
  });
  const res = await withFetch(impl, () => dhl.buy(dpdCtx, dhlCreds));
  assert.equal(res.labelFormat, "pdf");
});

await check("DHL's own error reaches the operator", async () => {
  // additionalDetails is where MyDHL puts the field name; detail is generic.
  const impl = dhlFetch({
    ship: jsonResponse(400, {
      detail: "Validation error",
      additionalDetails: ["receiverDetails.postalAddress.postalCode is required"],
    }),
  });
  await assert.rejects(
    () => withFetch(impl, () => dhl.buy(dpdCtx, dhlCreds)),
    /postalCode is required/,
  );
});

await check("a missing DHL credential makes no call at all", async () => {
  for (const field of ["apiKey", "apiSecret", "accountNumber", "productCode"]) {
    const creds = { ...dhlCreds };
    delete creds[field];
    const impl = dhlFetch();
    await assert.rejects(
      () => withFetch(impl, () => dhl.buy(dpdCtx, creds)),
      new RegExp(`No ${field} is stored`),
    );
    assert.equal(impl.calls.length, 0, `it called DHL without ${field}`);
  }
});

await check("an incomplete DHL shipment is refused", async () => {
  await assert.rejects(
    () =>
      withFetch(
        dhlFetch({
          ship: jsonResponse(200, { shipmentTrackingNumber: "1", documents: [] }),
        }),
        () => dhl.buy(dpdCtx, dhlCreds),
      ),
    /incomplete/i,
  );
});

await check("testing DHL creates nothing", async () => {
  const impl = dhlFetch();
  await withFetch(impl, () => dhl.test(dhlCreds));
  assert.equal(impl.calls.length, 1);
  assert.equal(impl.calls[0].options.method, "GET");
});

await check("DHL is flagged provisional", async () => {
  assert.equal(dhl.provisional, true);
  assert.ok(dhl.provisionalNote?.length > 40);
});

/* ------------------------------------------------------- cancelling ---- */

await check("every API provider can cancel", () => {
  // A carrier that can sell postage and not void it leaves money on the
  // table every time a shipment changes.
  for (const p of API_PROVIDERS) {
    assert.equal(canCancel(p.key), true, `${p.key} cannot cancel`);
  }
  assert.equal(canCancel("manual"), false, "manual has nothing to cancel");
  assert.equal(canCancel("nope"), false);
});

await check("Royal Mail deletes by order identifier", async () => {
  let seen = null;
  const res = await withFetch(
    async (url, options) => {
      seen = { url, method: options.method };
      return jsonResponse(200, {
        deletedOrders: [{ orderIdentifier: 99 }],
        errors: [],
      });
    },
    () => rm.cancel({ reference: "99", trackingNumber: "AB1" }, { apiKey: "k" }),
  );
  assert.equal(seen.method, "DELETE");
  assert.match(seen.url, /\/orders\/99$/);
  assert.equal(res.destroyLabel, true);
  assert.match(res.note, /Revenue Protection/);
});

await check("ROYAL MAIL'S 200 CAN STILL MEAN NOT DELETED", async () => {
  // deletedOrders and errors sit side by side. Treating the status alone as
  // success would clear our copy of a label that is still live.
  await assert.rejects(
    () =>
      withFetch(
        async () =>
          jsonResponse(200, {
            deletedOrders: [],
            errors: [{ code: "E1", message: "Order already despatched" }],
          }),
        () => rm.cancel({ reference: "99" }, { apiKey: "k" }),
      ),
    /already despatched/,
  );

  await assert.rejects(
    () =>
      withFetch(
        async () => jsonResponse(200, { deletedOrders: [], errors: [] }),
        () => rm.cancel({ reference: "99" }, { apiKey: "k" }),
      ),
    /nothing deleted/i,
  );
});

await check("a Royal Mail DELETE with no body is still a success", async () => {
  const res = await withFetch(
    async () => ({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error("no body");
      },
    }),
    () => rm.cancel({ reference: "99" }, { apiKey: "k" }),
  );
  assert.equal(res.destroyLabel, true);
});

await check("DPD logs in before deleting the shipment", async () => {
  const impl = dpdFetch();
  impl.calls.length = 0;
  const res = await withFetch(
    async (url, options) => {
      impl.calls.push({ url, options });
      if (url.includes("action=login")) {
        return jsonResponse(200, { data: { geoSession: "S" } });
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    () => dpd.cancel({ reference: "4242" }, dpdCreds),
  );
  assert.equal(res.destroyLabel, true);
  assert.equal(impl.calls.length, 2);
  assert.equal(impl.calls[1].options.method, "DELETE");
  assert.match(impl.calls[1].url, /\/shipping\/shipment\/4242$/);
  assert.equal(impl.calls[1].options.headers.GEOSession, "S");
});

await check("UPS voids by tracking number, and reads the status", async () => {
  let seen = null;
  const res = await withFetch(
    async (url, options) => {
      if (url.includes("/oauth/token")) {
        return jsonResponse(200, { access_token: "T" });
      }
      seen = { url, method: options.method };
      return jsonResponse(200, {
        VoidShipmentResponse: {
          SummaryResult: { Status: { Code: "1", Description: "Voided" } },
        },
      });
    },
    () => ups.cancel({ trackingNumber: "1Z999" }, upsCreds),
  );
  assert.equal(seen.method, "DELETE");
  assert.match(seen.url, /\/void\/cancel\/1Z999$/);
  assert.equal(res.destroyLabel, true);
});

await check("A UPS 200 THAT DID NOT VOID IS A FAILURE", async () => {
  // The outcome is in SummaryResult.Status, not in the status code.
  await assert.rejects(
    () =>
      withFetch(
        async (url) =>
          url.includes("/oauth/token")
            ? jsonResponse(200, { access_token: "T" })
            : jsonResponse(200, {
                VoidShipmentResponse: {
                  SummaryResult: {
                    Status: { Code: "0", Description: "Not Voided" },
                  },
                },
              }),
        () => ups.cancel({ trackingNumber: "1Z999" }, upsCreds),
      ),
    /Not Voided/,
  );
});

await check("Yodel and DHL delete by their own identifier", async () => {
  let yodelSeen = null;
  await withFetch(
    async (url, options) => {
      yodelSeen = { url, method: options.method };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    () => yodel.cancel({ reference: "ORD-77" }, yodelCreds),
  );
  assert.equal(yodelSeen.method, "DELETE");
  assert.match(yodelSeen.url, /\/orders\/ORD-77$/);

  let dhlSeen = null;
  await withFetch(
    async (url, options) => {
      dhlSeen = { url, method: options.method };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    () => dhl.cancel({ trackingNumber: "1234567890" }, dhlCreds),
  );
  assert.equal(dhlSeen.method, "DELETE");
  assert.match(dhlSeen.url, /\/shipments\/1234567890$/);
});

await check("DHL explains that collected parcels cannot be cancelled", async () => {
  await assert.rejects(
    () =>
      withFetch(
        async () => jsonResponse(409, { detail: "Shipment already collected" }),
        () => dhl.cancel({ trackingNumber: "123" }, dhlCreds),
      ),
    /not yet collected/,
  );
});

await check("cancelling with nothing to identify it is refused", async () => {
  // Rather than sending "undefined" down the URL and deleting whatever that
  // happens to match.
  let called = false;
  const watch = async () => {
    called = true;
    return jsonResponse(200, {});
  };
  await assert.rejects(() => withFetch(watch, () => rm.cancel({}, { apiKey: "k" })));
  await assert.rejects(() => withFetch(watch, () => dpd.cancel({}, dpdCreds)));
  await assert.rejects(() => withFetch(watch, () => ups.cancel({}, upsCreds)));
  await assert.rejects(() => withFetch(watch, () => yodel.cancel({}, yodelCreds)));
  await assert.rejects(() => withFetch(watch, () => dhl.cancel({}, dhlCreds)));
  assert.equal(called, false, "a cancel went out with no identifier");
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
