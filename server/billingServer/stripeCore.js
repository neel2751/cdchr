import { escapeTenant } from "@/lib/tenantContext";
import { openSecret } from "@/lib/secretBox";
import CarrierAccountModel from "@/models/carrierAccountModel";

/**
 * Talking to Stripe: the sealed secret key and the HTTP call. Shared by the
 * console and checkout actions (stripe.js), saving a card (cardServer.js) and
 * the monthly billing run, which has nobody signed in.
 *
 * NOT "use server": these use our secret key and must never be callable from
 * a browser. See stripe.js for why no card number ever reaches us.
 */

export const STRIPE_PROVIDER = "stripe";
const API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 15000;


export async function secretKey() {
  const account = await escapeTenant("stripe: account", () =>
    CarrierAccountModel.findOne({ provider: STRIPE_PROVIDER }).lean(),
  );
  if (!account?.isEnabled) return null;

  const raw =
    account.credentials instanceof Map
      ? Object.fromEntries(account.credentials)
      : account.credentials || {};
  return raw.secretKey ? openSecret(raw.secretKey) : null;
}

/** Stripe wants form encoding, including for nested fields. */
function formBody(params) {
  return new URLSearchParams(params).toString();
}

/**
 * @param {string} path
 * @param {object} params
 * @param {string} key
 * @param {{ idempotencyKey?: string }} [options] — the same key twice makes
 *   one charge, however many times a retry sends it
 */
export async function callStripe(path, params, key, { idempotencyKey } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: formBody(params),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      // Stripe's own message names the field that was wrong, which is more
      // use than anything we could write. The whole error rides along: a
      // declined card's `code` and `decline_code` decide what happens next.
      const error = new Error(payload?.error?.message || `Stripe answered ${res.status}`);
      error.stripe = payload?.error || null;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Stripe did not answer in time.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}


/**
 * A GET — retrieving an object, with `expand[]` and the like as the query.
 * callStripe posts, which Stripe treats as an update on most objects.
 */
export async function getStripe(path, query = {}, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const qs = new URLSearchParams(query).toString();
    const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(payload?.error?.message || `Stripe answered ${res.status}`);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Stripe did not answer in time.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
