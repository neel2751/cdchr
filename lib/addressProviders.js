/**
 * Looking a postcode up to the actual addresses on it.
 *
 * This is PAF — Royal Mail's Postcode Address File, the list of every
 * deliverable address in the country. It is licensed, and that single fact
 * shapes everything here:
 *
 *   - There is no free source. postcodes.io, which
 *     server/addressServer/postcode.js already uses, is ONS geography: it
 *     knows a postcode exists and which council it is in, and has never heard
 *     of a house. PAF is a different dataset with a different licence.
 *   - So every provider below is a licensed reseller, and every one needs a
 *     paid key.
 *   - EVERY LOOKUP COSTS MONEY. Not a rate limit to respect — an invoice.
 *     That is why the server side rate-limits per tenant and why nothing here
 *     is called on a keystroke.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS VERIFIED, AND WHAT IS NOT.
 *
 * Ideal Postcodes: the base URL, the `api_key` query parameter, the
 * `{code, message, result}` wrapper and `4010` for a bad key were all checked
 * against the live service. The shape of a SUCCESSFUL result was not — that
 * needs a paid key — and comes from their documentation.
 *
 * getAddress.io: entirely from documentation. Their endpoint refuses an
 * unkeyed request, so nothing could be observed.
 *
 * Both parse defensively as a result, and both surface the service's own
 * message rather than flattening it.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * THE CONTRACT
 *
 *   needs    credential fields the account screen collects.
 *   lookup   async (postcode, creds) -> [{ line1, line2, city, county,
 *            postcode, label }], newest-style objects regardless of which
 *            service produced them. An empty array means "no addresses
 *            there", which is a real answer.
 *            Throws AddressLookupError for anything else.
 */

/** A failure safe to show a customer — never carries a key. */
export class AddressLookupError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = "AddressLookupError";
    this.retryable = retryable;
  }
}

const TIMEOUT_MS = 8000;

async function call(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AddressLookupError(
        "The address service did not answer in time.",
        { retryable: true },
      );
    }
    throw new AddressLookupError("Could not reach the address service.", {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** One line per address, for a picker. Blank parts dropped, not rendered. */
function label(parts) {
  return parts.filter((p) => p && String(p).trim()).join(", ");
}

/**
 * Ideal Postcodes.
 *
 * GET /v1/postcodes/{postcode}?api_key=… — the key is a query parameter, not
 * a header. Failures come back as HTTP 200 with a `code` in the body, so the
 * status alone proves nothing: 4010 is a bad key, 4040 is a postcode with no
 * addresses.
 */
const idealPostcodes = {
  key: "ideal-postcodes",
  name: "Ideal Postcodes",
  needs: [
    {
      name: "apiKey",
      label: "Ideal Postcodes API key",
      help: "From your Ideal Postcodes dashboard. Every lookup is billable.",
    },
  ],
  base: "https://api.ideal-postcodes.co.uk/v1",

  async lookup(postcode, creds) {
    if (!creds?.apiKey) throw new AddressLookupError("No API key is stored.");

    const res = await call(
      `${this.base}/postcodes/${encodeURIComponent(postcode)}` +
        `?api_key=${encodeURIComponent(creds.apiKey)}`,
    );

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      throw new AddressLookupError(
        `Ideal Postcodes answered ${res.status} with something that was not JSON.`,
      );
    }

    // Their code, not the HTTP status — a bad key is a 200 with code 4010.
    const code = Number(payload?.code);
    if (code === 4040) return [];
    if (code === 4010 || code === 4011) {
      throw new AddressLookupError("Ideal Postcodes rejected the API key.");
    }
    if (code && code !== 2000) {
      throw new AddressLookupError(
        payload?.message || `Ideal Postcodes returned code ${code}.`,
      );
    }
    if (!res.ok) {
      throw new AddressLookupError(`Ideal Postcodes answered ${res.status}.`);
    }

    const rows = Array.isArray(payload?.result) ? payload.result : [];
    return rows.map((r) => {
      const line1 = label([r.organisation_name, r.line_1]);
      return {
        line1,
        // line_3 is rare and usually a locality. Folded into line 2 rather
        // than dropped, because dropping part of an address is how a parcel
        // goes to the wrong flat.
        line2: label([r.line_2, r.line_3]),
        city: r.post_town || "",
        county: r.county || "",
        postcode: r.postcode || postcode,
        label: label([line1, r.line_2, r.line_3, r.post_town, r.postcode]),
      };
    });
  },
};

/**
 * getAddress.io.
 *
 * GET /find/{postcode}?api-key=…&expand=true — note the hyphen in the
 * parameter name, which differs from Ideal Postcodes' underscore. Without
 * `expand` the addresses come back as comma-joined strings that have to be
 * split by position, which is exactly the guessing this whole feature exists
 * to stop.
 */
const getAddressIo = {
  key: "getaddress-io",
  name: "getAddress.io",
  needs: [
    {
      name: "apiKey",
      label: "getAddress.io API key",
      help: "From your getAddress.io dashboard. Every lookup is billable.",
    },
  ],
  base: "https://api.getAddress.io",

  async lookup(postcode, creds) {
    if (!creds?.apiKey) throw new AddressLookupError("No API key is stored.");

    const res = await call(
      `${this.base}/find/${encodeURIComponent(postcode)}` +
        `?api-key=${encodeURIComponent(creds.apiKey)}&expand=true`,
    );

    if (res.status === 401 || res.status === 403) {
      throw new AddressLookupError("getAddress.io rejected the API key.");
    }
    // Their "no addresses here" is a 404, which is a real answer rather than
    // an error — an empty list says so without alarming anybody.
    if (res.status === 404) return [];
    if (res.status === 429) {
      throw new AddressLookupError(
        "getAddress.io is rate limiting us. Try again shortly.",
        { retryable: true },
      );
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      throw new AddressLookupError(
        `getAddress.io answered ${res.status} with something that was not JSON.`,
      );
    }
    if (!res.ok) {
      throw new AddressLookupError(
        payload?.Message || `getAddress.io answered ${res.status}.`,
      );
    }

    const rows = Array.isArray(payload?.addresses) ? payload.addresses : [];
    return rows.map((r) => {
      // With expand=true these are objects. Without it they are strings, and
      // rather than split one by position — which mis-files a parcel silently
      // — an unexpanded row is passed through whole as line 1 for a human to
      // correct.
      if (typeof r === "string") {
        return {
          line1: r,
          line2: "",
          city: payload?.town_or_city || "",
          county: payload?.county || "",
          postcode: payload?.postcode || postcode,
          label: r,
        };
      }
      return {
        line1: r.line_1 || "",
        line2: label([r.line_2, r.line_3, r.line_4]),
        city: r.town_or_city || r.locality || "",
        county: r.county || "",
        postcode: payload?.postcode || postcode,
        label: label([
          r.line_1,
          r.line_2,
          r.line_3,
          r.line_4,
          r.town_or_city,
          payload?.postcode,
        ]),
      };
    });
  },
};

export const ADDRESS_PROVIDERS = [idealPostcodes, getAddressIo];

export function findAddressProvider(key) {
  return ADDRESS_PROVIDERS.find((p) => p.key === key) || null;
}
