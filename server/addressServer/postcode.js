"use server";

import {
  isValidUkPostcode,
  normalisePostcode,
  outwardCode,
  townsAgree,
} from "@/lib/postcode";

/**
 * Checking a postcode against the real list.
 *
 * A worked example of why the two questions are separate, found by running
 * this against the live service: DN55 1PT, W1A 0AX and PL1 1AA all pass the
 * format check and all 404 here. They are the postcodes the government's own
 * validation documentation uses as examples, and they are not real. A checker
 * that blocked on "not found" would reject them; one that only checked format
 * would wave through three addresses nothing can be delivered to.
 *
 * Uses postcodes.io — ONS open data, no key, no account, no licence. That
 * matters for what this can and cannot tell you: it knows whether a postcode
 * EXISTS and which local authority it is in. It does not know which addresses
 * are at it, because that is Royal Mail's PAF and PAF is licensed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT BLOCKS AND WHAT ONLY WARNS, and why the line is where it is:
 *
 *   BLOCK on a malformed postcode. That is decided offline by lib/postcode.js
 *   against the government's own pattern, needs nobody's permission, and a
 *   carrier will refuse it anyway.
 *
 *   WARN ONLY on "this postcode is not in the list". ONS data lags new
 *   building by months, so a brand-new estate has a real, deliverable
 *   postcode that this service has never heard of. Blocking would stop a
 *   legitimate order to make a point.
 *
 *   WARN ONLY on a town that does not match. The lookup returns the local
 *   authority: SW1A 1AA comes back as *Westminster* while any sensible person
 *   types *London*. Both are right.
 *
 *   NEVER FAIL because this service is unavailable. A free third party being
 *   down must not stop somebody ordering tags.
 * ─────────────────────────────────────────────────────────────────────────
 */

const ENDPOINT = "https://api.postcodes.io/postcodes";
const TIMEOUT_MS = 5000;

/**
 * Answers, remembered.
 *
 * Postcodes effectively do not change, the service is free, and the same few
 * get checked repeatedly while somebody edits a form. In memory rather than a
 * collection: losing it on a restart costs one HTTP call.
 */
const cache = new Map();
const CACHE_MAX = 500;

function remember(key, value) {
  // Oldest out first. A Map iterates in insertion order, so this is enough of
  // an eviction policy for something this small.
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
  return value;
}

/**
 * Look one up.
 *
 * Always resolves. `known` is false both when the postcode is genuinely absent
 * and when we could not ask — `checked` separates those, so a caller never
 * reports "that postcode does not exist" on the strength of a timeout.
 */
export async function lookupPostcode({ postcode, town } = {}) {
  const normalised = normalisePostcode(postcode);

  if (!normalised) {
    return { success: true, data: JSON.stringify({ empty: true }) };
  }
  if (!isValidUkPostcode(normalised)) {
    return {
      success: true,
      data: JSON.stringify({
        normalised,
        valid: false,
        checked: false,
        known: false,
        message: `"${normalised}" is not a valid UK postcode.`,
      }),
    };
  }

  const cached = cache.get(normalised);
  const found =
    cached !== undefined ? cached : await fetchPostcode(normalised);
  if (cached === undefined) remember(normalised, found);

  // Could not ask. Valid shape is all we know, and that is said plainly
  // rather than dressed up as approval.
  if (found === null) {
    return {
      success: true,
      data: JSON.stringify({
        normalised,
        valid: true,
        checked: false,
        known: false,
        message: "The postcode checker could not be reached, so only the format was checked.",
      }),
    };
  }

  if (found === false) {
    return {
      success: true,
      data: JSON.stringify({
        normalised,
        valid: true,
        checked: true,
        known: false,
        message:
          `${normalised} is a valid format but is not in the national list — ` +
          "it may be a new build, a retired postcode, or simply wrong. " +
          "Worth checking before anything is sent.",
      }),
    };
  }

  const agrees = townsAgree(town, found.district);
  return {
    success: true,
    data: JSON.stringify({
      normalised,
      valid: true,
      checked: true,
      known: true,
      district: found.district,
      region: found.region,
      country: found.country,
      outward: outwardCode(normalised),
      townMatches: agrees,
      message: agrees
        ? `${normalised} — ${found.district}, ${found.region}`
        : `${normalised} is in ${found.district}, ${found.region}. Check the town.`,
    }),
  };
}

/**
 * @returns the record, `false` for a postcode that is genuinely not there, or
 * `null` when the question could not be asked at all.
 */
async function fetchPostcode(normalised) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${ENDPOINT}/${encodeURIComponent(normalised)}`,
      { signal: controller.signal, headers: { Accept: "application/json" } },
    );

    if (res.status === 404) return false;
    if (!res.ok) return null;

    const payload = await res.json();
    const result = payload?.result;
    if (!result?.postcode) return null;

    return {
      // Their spelling wins — it is the canonical one, and it confirms our
      // own normalisation rather than trusting it.
      postcode: result.postcode,
      district: result.admin_district || result.region || "",
      region: result.region || result.country || "",
      country: result.country || "",
    };
  } catch {
    // A timeout, a DNS failure, an outage. Unknown, not absent.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
