/**
 * Buying a postage label from a carrier.
 *
 * WHAT A CARRIER LABEL IS, and why this is not the same work as the dispatch
 * label in server/tagServer/labels.js: a postage label carries a barcode the
 * *carrier* allocates against a paid account. It is the thing their scanner
 * reads and their network routes on. It cannot be generated locally — a parcel
 * carrying an invented barcode is not delivered, it is stopped — so every
 * provider here is a call out to somebody else's system.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE API ADAPTERS BELOW ARE UNVERIFIED AGAINST A LIVE ACCOUNT.
 *
 * They are written to each carrier's published specification, which is not the
 * same as having watched one succeed. Nobody here has credentials, so no call
 * has ever been made. Treat the first real use as a test: the account screen
 * has a "test connection" for exactly that, and `testOnly` on a purchase asks
 * the carrier to validate without allocating.
 *
 * If an adapter is wrong, it fails at the carrier and the shipment falls back
 * to manual — which is the whole reason `manual` is the default and stays
 * supported rather than being a stepping stone to be removed.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * THE CONTRACT
 *
 * A provider is `{ key, name, mode, needs, buy }`.
 *
 *   mode   "manual" — a person gets the label from the carrier's own website
 *                     and records the tracking number here.
 *          "api"    — `buy` calls the carrier.
 *   needs  credential field names the account screen must collect.
 *   buy    async ({ shipment, order, address, weightGrams, testOnly }, creds)
 *          resolves to { trackingNumber, labelBase64, labelFormat, reference }
 *          or throws a LabelError whose message is safe to show an operator.
 *
 * `buy` must never return partial success. A tracking number without a label,
 * or a label without a tracking number, is a parcel somebody has paid for and
 * cannot post.
 */

/** A failure that is safe to show an operator — never carries a credential. */
export class LabelError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = "LabelError";
    this.retryable = retryable;
  }
}

const TIMEOUT_MS = 20_000;

/**
 * A fetch that cannot hang the dispatch screen for ever.
 *
 * A carrier API that stops responding must not leave an operator staring at a
 * spinner, and must not leave us unsure whether a label was allocated — so a
 * timeout is reported as *unknown*, not as a failure, because a request that
 * timed out may still have bought postage at the other end.
 */
async function callCarrier(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new LabelError(
        "The carrier did not answer in time. Check their site before trying " +
          "again — a label may still have been bought.",
      );
    }
    throw new LabelError("Could not reach the carrier.", { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Royal Mail Click & Drop.
 *
 * POST {base}/orders with a Bearer token; `label.includeLabelInResponse`
 * asks for the PDF back as base64 in the same response, which is what makes
 * this a single call rather than a create-then-poll.
 *
 * Spec: https://api.parcel.royalmail.com/doc/v1/click-and-drop-api-v1.yaml
 */
const royalMail = {
  key: "royal-mail",
  name: "Royal Mail (Click & Drop)",
  mode: "api",
  needs: [
    {
      name: "apiKey",
      label: "Click & Drop API key",
      help: "Click & Drop → Settings → Integrations → Click & Drop API",
    },
  ],
  base: "https://api.parcel.royalmail.com/api/v1",

  async buy({ order, address, weightGrams, parcelCount, testOnly }, creds) {
    if (!creds?.apiKey) throw new LabelError("No API key is stored.");

    const body = {
      items: [
        {
          orderReference: order.orderNumber,
          recipient: {
            // `address` is the structured one. The free-text shippingAddress
            // is deliberately NOT parsed into these: guessing which line is
            // the city sends parcels to the wrong place, and it does it
            // silently. See server/tagServer/carrierLabels.js.
            address: {
              fullName: address.name || "",
              companyName: address.company || "",
              addressLine1: address.line1,
              addressLine2: address.line2 || "",
              city: address.city,
              postcode: address.postcode || "",
              countryCode: address.countryCode || "GB",
            },
          },
          orderDate: new Date().toISOString(),
          subtotal: 0,
          shippingCostCharged: 0,
          total: 0,
          packages: Array.from({ length: Math.max(1, parcelCount || 1) }, () => ({
            weightInGrams: weightGrams,
            packageFormatIdentifier: "parcel",
          })),
          label: { includeLabelInResponse: true },
        },
      ],
    };

    const res = await callCarrier(`${this.base}/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new LabelError("Royal Mail rejected the API key.");
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      throw new LabelError(
        `Royal Mail answered ${res.status} with something that was not JSON.`,
      );
    }

    if (!res.ok) {
      // Their message, not ours — it is more specific than anything we could
      // invent, and an operator can act on it.
      const detail =
        payload?.message ||
        payload?.errors?.[0]?.errorMessage ||
        `HTTP ${res.status}`;
      throw new LabelError(`Royal Mail refused the order: ${detail}`);
    }

    const created = payload?.createdOrders?.[0];
    const labelError = payload?.labelErrors?.[0];
    if (labelError) {
      throw new LabelError(
        `Royal Mail created the order but not the label: ${
          labelError.errorMessage || labelError.message || "no reason given"
        }`,
      );
    }
    // Both or neither. A tracking number with no label is postage nobody can
    // print; a label with no tracking number cannot be followed.
    if (!created?.trackingNumber || !created?.label) {
      throw new LabelError(
        "Royal Mail returned an incomplete label. Check Click & Drop before " +
          "retrying — the order may exist there.",
      );
    }

    return {
      trackingNumber: created.trackingNumber,
      labelBase64: created.label,
      labelFormat: "pdf",
      reference: created.orderIdentifier
        ? String(created.orderIdentifier)
        : null,
      testOnly: Boolean(testOnly),
    };
  },

  /** Cheapest call that proves the key works, without buying anything. */
  async test(creds) {
    if (!creds?.apiKey) throw new LabelError("No API key is stored.");
    const res = await callCarrier(`${this.base}/version`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        Accept: "application/json",
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new LabelError("Royal Mail rejected the API key.");
    }
    if (!res.ok) {
      throw new LabelError(`Royal Mail answered ${res.status}.`);
    }
    return true;
  },
};

/**
 * DPD UK.
 *
 * Three calls where Royal Mail takes one, which is why the contract returns a
 * finished result rather than exposing the steps:
 *
 *   1. POST /user/?action=login   — Basic auth, returns `data.geoSession`
 *   2. POST /shipping/shipment    — returns a shipment id and a consignment
 *                                   number, which is the tracking number
 *   3. GET  /shipping/shipment/{id}/label/  with Accept: application/pdf
 *
 * The session is fetched per purchase rather than cached. A cached session
 * that has expired fails the *second* call, after the shipment exists — which
 * is the worst place to fail, because it leaves a consignment at DPD with no
 * label here. One extra round trip is a cheap price for that not happening.
 *
 * `networkCode` is DPD's service code (next day, two day, and so on) and is
 * specific to the account's contract, so it is a stored setting rather than a
 * constant — a guessed one is either a refusal or the wrong service at the
 * wrong price.
 *
 * WEIGHT IS IN KILOGRAMS HERE. Royal Mail wants grams. The contract carries
 * grams and each adapter converts, so that the conversion is visible at the
 * boundary rather than assumed at the caller.
 */
const dpd = {
  key: "dpd",
  name: "DPD UK",
  mode: "api",
  needs: [
    { name: "username", label: "DPD username", help: "Your MyDPD API user" },
    { name: "password", label: "DPD password" },
    {
      name: "accountNumber",
      label: "DPD account number",
      help: "Sent as GEOClient: account/<number>",
    },
    {
      name: "networkCode",
      label: "Service (network) code",
      help: "From your DPD contract, e.g. 1^12. A wrong code is the wrong service at the wrong price.",
    },
  ],
  base: "https://api.dpd.co.uk",

  headers(creds, geoSession) {
    return {
      // Spelled GEOClient/GEOSession by DPD, not GeoClient. Header names are
      // case-insensitive over the wire, but matching their docs keeps this
      // checkable against them.
      GEOClient: `account/${creds.accountNumber}`,
      ...(geoSession ? { GEOSession: geoSession } : {}),
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  },

  async login(creds) {
    const basic = Buffer.from(
      `${creds.username}:${creds.password}`,
      "utf8",
    ).toString("base64");

    const res = await callCarrier(`${this.base}/user/?action=login`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        ...this.headers(creds),
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new LabelError("DPD rejected the username or password.");
    }
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      throw new LabelError(`DPD answered ${res.status} with something that was not JSON.`);
    }
    if (!res.ok) {
      throw new LabelError(
        `DPD refused the login: ${payload?.error?.[0]?.errorMessage || `HTTP ${res.status}`}`,
      );
    }

    const session = payload?.data?.geoSession;
    if (!session) throw new LabelError("DPD did not return a session.");
    return session;
  },

  async buy({ order, address, from, weightGrams, parcelCount }, creds) {
    for (const field of ["username", "password", "accountNumber", "networkCode"]) {
      if (!creds?.[field]) throw new LabelError(`No ${field} is stored for DPD.`);
    }

    const geoSession = await this.login(creds);
    const parcels = Math.max(1, parcelCount || 1);

    // DPD wants a collection address as well as a delivery one. Ours is free
    // text (a postal address forced into fields is one with a wrong field), so
    // the first line is the street and the last is the postcode — stated here
    // because it is a real assumption, and it is ours to get wrong rather than
    // the customer's.
    const fromLines = String(from?.address || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const body = {
      jobId: null,
      collectionOnDelivery: false,
      invoice: null,
      collectionDate: new Date().toISOString().slice(0, 19),
      consolidate: false,
      consignment: [
        {
          consignmentNumber: null,
          consignmentRef: null,
          parcel: [],
          collectionDetails: {
            contactDetails: {
              contactName: from?.name || "",
              telephone: from?.contact || "",
            },
            address: {
              organisation: from?.name || "",
              countryCode: "GB",
              postcode: fromLines[fromLines.length - 1] || "",
              street: fromLines[0] || "",
              locality: "",
              town: fromLines[fromLines.length - 2] || "",
              county: "",
            },
          },
          deliveryDetails: {
            contactDetails: {
              contactName: address.name || address.company || "",
              telephone: "",
            },
            address: {
              organisation: address.company || "",
              countryCode: address.countryCode || "GB",
              postcode: address.postcode || "",
              street: address.line1,
              locality: address.line2 || "",
              town: address.city,
              county: "",
            },
          },
          networkCode: creds.networkCode,
          numberOfParcels: parcels,
          // Kilograms, and never zero: DPD rejects a weightless consignment,
          // and rounding 240g down to 0 would be a refusal nobody could read.
          totalWeight: Math.max(0.1, Math.round((weightGrams / 1000) * 100) / 100),
          shippingRef1: order.orderNumber,
          customsValue: null,
          deliveryInstructions: "",
          parcelDescription: "NFC tags",
          liabilityValue: null,
          liability: false,
        },
      ],
    };

    const res = await callCarrier(`${this.base}/shipping/shipment`, {
      method: "POST",
      headers: this.headers(creds, geoSession),
      body: JSON.stringify(body),
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      throw new LabelError(`DPD answered ${res.status} with something that was not JSON.`);
    }

    // DPD reports business failures inside a 200 as well as by status code.
    const failure = payload?.error?.[0]?.errorMessage || payload?.error?.errorMessage;
    if (!res.ok || failure) {
      throw new LabelError(
        `DPD refused the shipment: ${failure || `HTTP ${res.status}`}`,
      );
    }

    const shipmentId = payload?.data?.shipmentId;
    const tracking =
      payload?.data?.consignmentDetail?.[0]?.consignmentNumber || null;
    if (!shipmentId || !tracking) {
      throw new LabelError(
        "DPD created something incomplete. Check MyDPD before retrying — a " +
          "consignment may exist there.",
      );
    }

    // The label is a second fetch. If it fails the consignment already exists
    // at DPD, so the message has to send somebody to look rather than imply
    // nothing happened.
    const labelRes = await callCarrier(
      `${this.base}/shipping/shipment/${shipmentId}/label/`,
      {
        method: "GET",
        headers: {
          ...this.headers(creds, geoSession),
          Accept: "application/pdf",
        },
      },
    );
    if (!labelRes.ok) {
      throw new LabelError(
        `DPD created consignment ${tracking} but would not return the label ` +
          `(HTTP ${labelRes.status}). It is in MyDPD — print it there, or ` +
          `cancel it before trying again.`,
      );
    }

    const pdf = Buffer.from(await labelRes.arrayBuffer());
    if (!pdf.length) {
      throw new LabelError(
        `DPD returned an empty label for consignment ${tracking}. It is in MyDPD.`,
      );
    }

    return {
      trackingNumber: tracking,
      labelBase64: pdf.toString("base64"),
      labelFormat: "pdf",
      reference: String(shipmentId),
    };
  },

  async test(creds) {
    // Logging in is the whole test: it proves the username, password and
    // account number together, which is everything except the network code.
    await this.login(creds);
    return true;
  },
};

/**
 * Everything else, and the default.
 *
 * The operator buys postage on the carrier's own website and types the
 * tracking number in here — which is how a small line actually runs, and needs
 * no account, no credentials and no integration. It is not a placeholder for
 * an adapter: a carrier we never integrate is still fully usable this way.
 */
const manual = {
  key: "manual",
  name: "Bought manually",
  mode: "manual",
  needs: [],
};

/**
 * UPS.
 *
 * OAuth 2.0 client credentials, then one shipment call that returns both the
 * tracking number and the label:
 *
 *   1. POST {auth}/security/v1/oauth/token  — Basic clientId:clientSecret,
 *      `grant_type=client_credentials`, form-encoded. Returns `access_token`.
 *   2. POST {base}/api/shipments/{version}/ship  — Bearer token.
 *      ShipmentResponse.ShipmentResults.ShipmentIdentificationNumber is the
 *      tracking number; PackageResults.ShippingLabel.GraphicImage is the label.
 *
 * Like DPD's session, the token is fetched per purchase rather than cached: an
 * expired token fails the ship call, and the ship call is the one that costs
 * money.
 *
 * UPS is the only carrier here with a published TEST HOST (wwwcie.ups.com), so
 * it is the only one where `environment` does anything — and given that no
 * adapter here has been run for real, it is the one worth pointing at a
 * sandbox first.
 *
 * Three UPS-specific traps, all of which would be quiet bugs:
 *
 *   - `PackageResults` is an OBJECT for one package and an ARRAY for several.
 *   - Weight is a STRING, not a number, and the unit is explicit — KGS here.
 *   - `PaymentInformation` is required. Without it UPS refuses the shipment
 *     rather than billing the shipper by default.
 *
 * Spec: https://github.com/UPS-API/api-documentation
 */
const ups = {
  key: "ups",
  name: "UPS",
  mode: "api",
  needs: [
    { name: "clientId", label: "UPS client ID" },
    { name: "clientSecret", label: "UPS client secret" },
    {
      name: "accountNumber",
      label: "UPS account (shipper) number",
      help: "The six-character number the postage is billed to",
    },
    {
      name: "serviceCode",
      label: "Service code",
      help: "From your UPS contract, e.g. 11 for Standard. A wrong code is the wrong service at the wrong price.",
    },
  ],
  // UPS versions its ship endpoint in the path; pinned so a new version
  // changing the schema cannot break a working integration silently.
  version: "v2409",

  hosts(environment) {
    return environment === "production"
      ? "https://onlinetools.ups.com"
      : "https://wwwcie.ups.com";
  },

  async token(creds) {
    const basic = Buffer.from(
      `${creds.clientId}:${creds.clientSecret}`,
      "utf8",
    ).toString("base64");

    const res = await callCarrier(
      `${this.hosts(creds.environment)}/security/v1/oauth/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          // Form-encoded, not JSON. UPS rejects a JSON body here.
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
      },
    );

    if (res.status === 401 || res.status === 403) {
      throw new LabelError("UPS rejected the client ID or secret.");
    }
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      throw new LabelError(`UPS answered ${res.status} with something that was not JSON.`);
    }
    if (!res.ok || !payload?.access_token) {
      throw new LabelError(
        `UPS would not issue a token: ${payload?.error_description || `HTTP ${res.status}`}`,
      );
    }
    return payload.access_token;
  },

  async buy({ order, address, from, weightGrams, parcelCount }, creds) {
    for (const field of ["clientId", "clientSecret", "accountNumber", "serviceCode"]) {
      if (!creds?.[field]) throw new LabelError(`No ${field} is stored for UPS.`);
    }

    const token = await this.token(creds);
    const parcels = Math.max(1, parcelCount || 1);

    // Same assumption as DPD, and the same reason it is stated rather than
    // hidden: our own address is free text, so the first line is the street
    // and the last is the postcode.
    const fromLines = String(from?.address || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const shipperAddress = {
      AddressLine: [fromLines[0] || ""],
      City: fromLines[fromLines.length - 2] || "",
      PostalCode: fromLines[fromLines.length - 1] || "",
      CountryCode: "GB",
    };

    const shipper = {
      Name: from?.name || "",
      ShipperNumber: creds.accountNumber,
      Phone: { Number: from?.contact || "" },
      Address: shipperAddress,
    };

    // Weight per parcel, as a string — UPS rejects a number here. Split
    // evenly: a per-parcel weight is not recorded anywhere, and declaring the
    // whole consignment's weight on each box would over-declare it.
    const perParcelKg = Math.max(
      0.1,
      Math.round((weightGrams / 1000 / parcels) * 100) / 100,
    );

    const body = {
      ShipmentRequest: {
        Shipment: {
          Description: "NFC tags",
          ReferenceNumber: { Value: order.orderNumber },
          Shipper: shipper,
          ShipFrom: { Name: shipper.Name, Address: shipperAddress },
          ShipTo: {
            Name: address.company || address.name || "",
            AttentionName: address.name || "",
            Address: {
              AddressLine: [address.line1, address.line2].filter(Boolean),
              City: address.city,
              PostalCode: address.postcode || "",
              CountryCode: address.countryCode || "GB",
            },
          },
          Service: { Code: creds.serviceCode },
          // Required. Without it UPS refuses rather than defaulting to
          // billing the shipper.
          PaymentInformation: {
            ShipmentCharge: {
              Type: "01",
              BillShipper: { AccountNumber: creds.accountNumber },
            },
          },
          Package: Array.from({ length: parcels }, () => ({
            // "02" — customer-supplied packaging.
            Packaging: { Code: "02" },
            PackageWeight: {
              UnitOfMeasurement: { Code: "KGS" },
              Weight: String(perParcelKg),
            },
          })),
        },
        LabelSpecification: {
          LabelImageFormat: { Code: "GIF" },
        },
      },
    };

    const res = await callCarrier(
      `${this.hosts(creds.environment)}/api/shipments/${this.version}/ship`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      throw new LabelError(`UPS answered ${res.status} with something that was not JSON.`);
    }

    if (!res.ok) {
      const detail =
        payload?.response?.errors?.[0]?.message ||
        payload?.response?.errors?.[0]?.code ||
        `HTTP ${res.status}`;
      throw new LabelError(`UPS refused the shipment: ${detail}`);
    }

    const results = payload?.ShipmentResponse?.ShipmentResults;
    const tracking = results?.ShipmentIdentificationNumber;

    // One package gives an object, several give an array. Reading [0] of an
    // object silently yields undefined, which would read as "no label" on a
    // shipment UPS has already charged for.
    const packages = Array.isArray(results?.PackageResults)
      ? results.PackageResults
      : results?.PackageResults
        ? [results.PackageResults]
        : [];
    const image = packages[0]?.ShippingLabel?.GraphicImage;

    if (!tracking || !image) {
      throw new LabelError(
        "UPS returned an incomplete shipment. Check the UPS dashboard before " +
          "retrying — it may already exist there.",
      );
    }

    return {
      trackingNumber: tracking,
      labelBase64: image,
      labelFormat: "gif",
      reference: tracking,
    };
  },

  async test(creds) {
    // A token proves the client ID and secret. It proves nothing about the
    // account or service code, which only a real shipment exercises — which
    // is what the test host is for.
    await this.token(creds);
    return true;
  },
};

/**
 * Yodel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PROVISIONAL. Half of this is verified and half is inferred, and the split
 * is exactly this:
 *
 *   VERIFIED from Yodel's public portal —
 *     · sandbox base `https://api-sb.yodel.co.uk`
 *     · path `/shipping/v1.0/orders`
 *     · `Accept: application/json`
 *     · the operations: create, confirm and delete orders; add and remove
 *       parcels; download labels as JSON or PDF
 *
 *   NOT VERIFIED, because the endpoint reference sits behind portal
 *   registration and the product list renders empty to anonymous visitors —
 *     · the authentication scheme
 *     · the HTTP method for each operation
 *     · every request and response field name
 *     · the production base URL
 *
 * So the unknowns are CONFIGURABLE rather than invented. The auth header name
 * and the production base are fields on the account; the request body below is
 * a starting point, not a specification.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE EVRI CASE, where writing an adapter was
 * refused: Yodel publishes a sandbox, and this adapter passes Yodel's own
 * error text through verbatim. A first call against the sandbox therefore
 * tells you which field is wrong, by name, and the fix is this file. Evri has
 * no sandbox that resolves and no public surface at all, so there is nothing
 * to correct against.
 *
 * `provisional: true` puts that warning on the account screen rather than
 * leaving it in a comment nobody reads.
 * ─────────────────────────────────────────────────────────────────────────
 */
const yodel = {
  key: "yodel",
  name: "Yodel",
  mode: "api",
  provisional: true,
  provisionalNote:
    "Base URL and paths are from Yodel's public portal; the auth header, " +
    "HTTP methods and body field names are not published and are configured " +
    "or inferred here. Run it against the sandbox first — Yodel's own error " +
    "messages name the field that is wrong.",
  needs: [
    { name: "apiKey", label: "Yodel API key", help: "From your Yodel developer portal subscription" },
    {
      name: "authHeader",
      label: "API key header name",
      help: "Apigee portals usually use X-Apikey or apikey. Check yours; this is not published.",
    },
    {
      name: "accountNumber",
      label: "Yodel account number",
    },
    {
      name: "serviceCode",
      label: "Service code",
      help: "From your Yodel contract. A wrong code is the wrong service at the wrong price.",
    },
    {
      name: "productionBase",
      label: "Production base URL (optional)",
      help: "Left blank, the sandbox is used. Yodel does not publish the live host.",
    },
  ],
  sandboxBase: "https://api-sb.yodel.co.uk",
  path: "/shipping/v1.0/orders",

  hosts(creds) {
    if (creds.environment === "production" && creds.productionBase) {
      return creds.productionBase.replace(/\/+$/, "");
    }
    // Falls back to the sandbox rather than guessing a live hostname. A
    // guessed production host either does not resolve or, worse, is somebody
    // else's.
    return this.sandboxBase;
  },

  headers(creds, accept = "application/json") {
    return {
      [creds.authHeader || "X-Apikey"]: creds.apiKey,
      Accept: accept,
      "Content-Type": "application/json",
    };
  },

  /** Yodel's message if there is one — it names the field we got wrong. */
  detail(payload, status) {
    return (
      payload?.message ||
      payload?.error?.message ||
      payload?.errors?.[0]?.message ||
      payload?.fault?.faultstring ||
      `HTTP ${status}`
    );
  },

  async buy({ order, address, from, weightGrams, parcelCount }, creds) {
    for (const field of ["apiKey", "accountNumber", "serviceCode"]) {
      if (!creds?.[field]) throw new LabelError(`No ${field} is stored for Yodel.`);
    }

    const base = this.hosts(creds);
    const parcels = Math.max(1, parcelCount || 1);

    const fromLines = String(from?.address || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // INFERRED SHAPE. Names follow Yodel's documented vocabulary (an order
    // holds parcels) and ordinary REST conventions. Expect the first sandbox
    // call to correct some of these; the error will say which.
    const body = {
      accountNumber: creds.accountNumber,
      serviceCode: creds.serviceCode,
      orderReference: order.orderNumber,
      collectionAddress: {
        name: from?.name || "",
        line1: fromLines[0] || "",
        town: fromLines[fromLines.length - 2] || "",
        postcode: fromLines[fromLines.length - 1] || "",
        countryCode: "GB",
        phone: from?.contact || "",
      },
      deliveryAddress: {
        name: address.name || address.company || "",
        company: address.company || "",
        line1: address.line1,
        line2: address.line2 || "",
        town: address.city,
        postcode: address.postcode || "",
        countryCode: address.countryCode || "GB",
      },
      parcels: Array.from({ length: parcels }, (_, i) => ({
        parcelReference: `${order.orderNumber}-${i + 1}`,
        // Grams. Yodel's unit is not published either; grams is the safer
        // guess of the two, because a value too small is a refusal and a
        // value too large is a surcharge.
        weight: Math.max(1, Math.round(weightGrams / parcels)),
        description: "NFC tags",
      })),
    };

    // 1. create
    const createRes = await callCarrier(`${base}${this.path}`, {
      method: "POST",
      headers: this.headers(creds),
      body: JSON.stringify(body),
    });

    if (createRes.status === 401 || createRes.status === 403) {
      throw new LabelError(
        "Yodel rejected the API key. Check the key and the header name — the " +
          "header Yodel expects is not published, so it is a setting here.",
      );
    }

    let created = null;
    try {
      created = await createRes.json();
    } catch {
      throw new LabelError(
        `Yodel answered ${createRes.status} with something that was not JSON.`,
      );
    }
    if (!createRes.ok) {
      throw new LabelError(
        `Yodel refused the order: ${this.detail(created, createRes.status)}`,
      );
    }

    const orderId =
      created?.orderId || created?.id || created?.orderReference || null;
    if (!orderId) {
      throw new LabelError(
        "Yodel created something without an order id this adapter recognises. " +
          "The response field name needs confirming against their portal.",
      );
    }

    // 2. confirm. Documented as a distinct step, so an unconfirmed order is
    // a draft — and a draft has no label and was never collected.
    const confirmRes = await callCarrier(
      `${base}${this.path}/${encodeURIComponent(orderId)}/confirm`,
      { method: "POST", headers: this.headers(creds) },
    );
    if (!confirmRes.ok) {
      let payload = null;
      try {
        payload = await confirmRes.json();
      } catch {
        /* the status is enough */
      }
      throw new LabelError(
        `Yodel created order ${orderId} but would not confirm it: ` +
          `${this.detail(payload, confirmRes.status)}. It exists at Yodel — ` +
          `confirm or delete it there before trying again.`,
      );
    }

    let confirmed = null;
    try {
      confirmed = await confirmRes.json();
    } catch {
      /* some APIs confirm with an empty body */
    }

    // 3. label
    const labelRes = await callCarrier(
      `${base}${this.path}/${encodeURIComponent(orderId)}/label?format=pdf`,
      { method: "GET", headers: this.headers(creds, "application/pdf") },
    );
    if (!labelRes.ok) {
      throw new LabelError(
        `Yodel confirmed order ${orderId} but would not return the label ` +
          `(HTTP ${labelRes.status}). It exists at Yodel — print it there, or ` +
          `delete it before trying again.`,
      );
    }

    const pdf = Buffer.from(await labelRes.arrayBuffer());
    if (!pdf.length) {
      throw new LabelError(
        `Yodel returned an empty label for order ${orderId}. It exists at Yodel.`,
      );
    }

    const tracking =
      confirmed?.trackingNumber ||
      confirmed?.parcels?.[0]?.trackingNumber ||
      created?.parcels?.[0]?.trackingNumber ||
      null;
    if (!tracking) {
      throw new LabelError(
        `Yodel produced a label for order ${orderId} but no tracking number ` +
          `this adapter recognises. The label is at Yodel; the response field ` +
          `name needs confirming against their portal.`,
      );
    }

    return {
      trackingNumber: tracking,
      labelBase64: pdf.toString("base64"),
      labelFormat: "pdf",
      reference: String(orderId),
    };
  },

  async test(creds) {
    if (!creds?.apiKey) throw new LabelError("No API key is stored for Yodel.");

    // There is no documented ping, so the cheapest honest check is a GET on
    // the orders collection: it exercises the host, the path and the key
    // without creating anything. A 404 still proves the key was accepted,
    // which is what is being tested.
    const res = await callCarrier(`${this.hosts(creds)}${this.path}`, {
      method: "GET",
      headers: this.headers(creds),
    });

    if (res.status === 401 || res.status === 403) {
      throw new LabelError(
        "Yodel rejected the API key, or the header name is wrong. The header " +
          "Yodel expects is not published — try X-Apikey or apikey.",
      );
    }
    if (res.status >= 500) {
      throw new LabelError(`Yodel answered ${res.status}.`);
    }
    return true;
  },
};

/**
 * DHL Express, via MyDHL API.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PROVISIONAL, for the same reason as Yodel and with a different split:
 *
 *   VERIFIED from DHL's public developer portal —
 *     · production base `https://express.api.dhl.com/mydhlapi`
 *     · sandbox base    `https://express.api.dhl.com/mydhlapi/test`
 *     · authentication: HTTP Basic, sent pre-emptively ("Please ensure that
 *       the Authorization header ... is set as pre-emptively and following
 *       the BasicAuth standards")
 *     · credentials: an API key, an API secret, and a shipper account number
 *
 *   NOT VERIFIED, because the endpoint reference is behind a DHL login —
 *     · the shipment endpoint path (`/shipments` is conventional and is the
 *       default here, but the public page does not state it)
 *     · request and response field names
 *
 * The path is therefore a setting, and the body below is a starting point.
 * DHL's own error text is passed through verbatim, so a sandbox call names
 * the field that is wrong.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Two DHL-specific things worth knowing before the first call:
 *
 *   - `plannedShippingDateAndTime` wants DHL's own format, which is not ISO
 *     8601: "2026-09-25T12:00:00 GMT+00:00". A plain toISOString() is
 *     rejected, and the message does not make the reason obvious.
 *   - DHL Express prices on dimensions as well as weight, and the API is
 *     likely to require them. Ours are uniform — tags in a box — so a box
 *     size is declared on the account rather than measured per shipment, and
 *     over-declaring slightly is safer than under-declaring.
 */
const dhl = {
  key: "dhl",
  name: "DHL Express",
  mode: "api",
  provisional: true,
  provisionalNote:
    "Both base URLs and the Basic-auth scheme are from DHL's public portal; " +
    "the endpoint path and body field names are behind their login and are " +
    "configured or inferred here. Run it against the sandbox first — DHL's " +
    "error messages name the field that is wrong.",
  needs: [
    { name: "apiKey", label: "MyDHL API key" },
    { name: "apiSecret", label: "MyDHL API secret" },
    {
      name: "accountNumber",
      label: "DHL shipper account number",
      help: "The account the postage is billed to",
    },
    {
      name: "productCode",
      label: "Product code",
      help: "DHL's service code from your contract, e.g. N for domestic. A wrong code is the wrong service at the wrong price.",
    },
    {
      name: "shipmentPath",
      label: "Shipment endpoint path (optional)",
      help: "Defaults to /shipments. DHL does not publish this outside their login.",
    },
    {
      name: "parcelSizeCm",
      label: "Standard box, L×W×H in cm (optional)",
      help: "Defaults to 20x15x10. DHL Express prices on size as well as weight.",
    },
  ],
  productionBase: "https://express.api.dhl.com/mydhlapi",
  sandboxBase: "https://express.api.dhl.com/mydhlapi/test",

  hosts(creds) {
    return creds.environment === "production"
      ? this.productionBase
      : this.sandboxBase;
  },

  headers(creds) {
    const basic = Buffer.from(
      `${creds.apiKey}:${creds.apiSecret}`,
      "utf8",
    ).toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  },

  /**
   * DHL's own wording for what went wrong.
   *
   * `additionalDetails` is where MyDHL puts the useful part — the field name
   * — while `detail` is often a generic sentence, so the specific one wins.
   */
  detail(payload, status) {
    return (
      payload?.additionalDetails?.[0] ||
      payload?.detail ||
      payload?.message ||
      payload?.title ||
      `HTTP ${status}`
    );
  },

  /** "2026-09-25T12:00:00 GMT+00:00" — DHL's format, not ISO 8601. */
  plannedShippingDateAndTime(when = new Date()) {
    return `${when.toISOString().slice(0, 19)} GMT+00:00`;
  },

  parcelSize(creds) {
    const parsed = String(creds.parcelSizeCm || "")
      .split(/[x×,\s]+/i)
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (parsed.length === 3) {
      return { length: parsed[0], width: parsed[1], height: parsed[2] };
    }
    return { length: 20, width: 15, height: 10 };
  },

  async buy({ order, address, from, weightGrams, parcelCount }, creds) {
    for (const field of ["apiKey", "apiSecret", "accountNumber", "productCode"]) {
      if (!creds?.[field]) throw new LabelError(`No ${field} is stored for DHL.`);
    }

    const base = this.hosts(creds);
    const path = creds.shipmentPath?.trim() || "/shipments";
    const parcels = Math.max(1, parcelCount || 1);
    const box = this.parcelSize(creds);

    const fromLines = String(from?.address || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // INFERRED SHAPE, following MyDHL's documented vocabulary. Expect the
    // first sandbox call to correct some of it; the error names the field.
    const body = {
      plannedShippingDateAndTime: this.plannedShippingDateAndTime(),
      pickup: { isRequested: false },
      productCode: creds.productCode,
      accounts: [{ typeCode: "shipper", number: creds.accountNumber }],
      customerDetails: {
        shipperDetails: {
          postalAddress: {
            postalCode: fromLines[fromLines.length - 1] || "",
            cityName: fromLines[fromLines.length - 2] || "",
            countryCode: "GB",
            addressLine1: fromLines[0] || "",
          },
          contactInformation: {
            phone: from?.contact || "",
            companyName: from?.name || "",
            fullName: from?.name || "",
          },
        },
        receiverDetails: {
          postalAddress: {
            postalCode: address.postcode || "",
            cityName: address.city,
            countryCode: address.countryCode || "GB",
            addressLine1: address.line1,
            ...(address.line2 ? { addressLine2: address.line2 } : {}),
          },
          contactInformation: {
            phone: "",
            companyName: address.company || address.name || "",
            fullName: address.name || address.company || "",
          },
        },
      },
      content: {
        // GB to GB. A domestic shipment declared as customs-declarable asks
        // for an invoice DHL then refuses the shipment for not having.
        isCustomsDeclarable:
          (address.countryCode || "GB").toUpperCase() !== "GB",
        description: "NFC tags",
        incoterm: "DAP",
        unitOfMeasurement: "metric",
        packages: Array.from({ length: parcels }, (_, i) => ({
          // Kilograms, because unitOfMeasurement is metric. Never zero.
          weight: Math.max(0.1, Math.round((weightGrams / 1000 / parcels) * 100) / 100),
          dimensions: box,
          customerReferences: [
            { value: `${order.orderNumber}-${i + 1}`, typeCode: "CU" },
          ],
        })),
      },
    };

    const res = await callCarrier(`${base}${path}`, {
      method: "POST",
      headers: this.headers(creds),
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new LabelError("DHL rejected the API key or secret.");
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      throw new LabelError(`DHL answered ${res.status} with something that was not JSON.`);
    }
    if (!res.ok) {
      throw new LabelError(
        `DHL refused the shipment: ${this.detail(payload, res.status)}`,
      );
    }

    const tracking = payload?.shipmentTrackingNumber;

    // `documents` carries the waybill alongside invoices and customs papers,
    // so the label is picked by type rather than by position — [0] is only
    // the label until a shipment needs an invoice too.
    const documents = Array.isArray(payload?.documents) ? payload.documents : [];
    const labelDoc =
      documents.find((d) => /label|waybill/i.test(d?.typeCode || "")) ||
      documents[0];

    if (!tracking || !labelDoc?.content) {
      throw new LabelError(
        "DHL returned an incomplete shipment. Check MyDHL before retrying — " +
          "it may already exist there.",
      );
    }

    const format = String(labelDoc.imageFormat || "pdf").toLowerCase();
    return {
      trackingNumber: tracking,
      labelBase64: labelDoc.content,
      labelFormat: ["pdf", "png", "zpl", "gif"].includes(format) ? format : "pdf",
      reference: tracking,
    };
  },

  async test(creds) {
    if (!creds?.apiKey || !creds?.apiSecret) {
      throw new LabelError("No API key and secret are stored for DHL.");
    }
    // No documented ping outside their login, so the cheapest honest check is
    // a GET against the base: it exercises the host and the credentials
    // without creating a shipment. A 404 still proves Basic auth was accepted.
    const res = await callCarrier(`${this.hosts(creds)}/`, {
      method: "GET",
      headers: this.headers(creds),
    });
    if (res.status === 401 || res.status === 403) {
      throw new LabelError("DHL rejected the API key or secret.");
    }
    if (res.status >= 500) throw new LabelError(`DHL answered ${res.status}.`);
    return true;
  },
};

/**
 * EVRI IS DELIBERATELY ABSENT.
 *
 * Not an oversight and not a to-do. Evri publishes no developer portal, no API
 * reference and no machine-readable specification; access is arranged through
 * an account manager, and the credential and endpoint shapes are not public.
 * The sandbox host that older integrations used no longer resolves.
 *
 * An adapter written from guesswork would be worse than none: it would appear
 * in this list looking like a working option, and its failures would read as
 * bugs in this code rather than as "we never had the specification". Evri is
 * therefore `manual` — which is fully functional, as it is for every carrier
 * we have not integrated.
 *
 * To add it: get API credentials and the sandbox pack from an Evri account
 * manager, build against their OAuth flow, and put test labels through their
 * approval before go-live. The contract above is ready for it; the
 * information is what is missing.
 */
export const LABEL_PROVIDERS = [manual, royalMail, dpd, ups, yodel, dhl];

export function findProvider(key) {
  return LABEL_PROVIDERS.find((p) => p.key === key) || null;
}

/** Providers that can actually call out, for a screen offering the choice. */
export const API_PROVIDERS = LABEL_PROVIDERS.filter((p) => p.mode === "api");
