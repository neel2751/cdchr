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
export const LABEL_PROVIDERS = [manual, royalMail, dpd];

export function findProvider(key) {
  return LABEL_PROVIDERS.find((p) => p.key === key) || null;
}

/** Providers that can actually call out, for a screen offering the choice. */
export const API_PROVIDERS = LABEL_PROVIDERS.filter((p) => p.mode === "api");
