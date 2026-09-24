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

export const LABEL_PROVIDERS = [manual, royalMail];

export function findProvider(key) {
  return LABEL_PROVIDERS.find((p) => p.key === key) || null;
}

/** Providers that can actually call out, for a screen offering the choice. */
export const API_PROVIDERS = LABEL_PROVIDERS.filter((p) => p.mode === "api");
