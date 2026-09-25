/**
 * UK postcodes: shape, and tidying.
 *
 * Pure and offline. Everything here can be decided without asking anybody,
 * which is what makes it safe to *block* on — see server/addressServer for the
 * part that needs a lookup, and which deliberately only warns.
 *
 * A wrong postcode is the classic silent failure in shipping: the carrier
 * either refuses the shipment, which is annoying, or delivers it somewhere
 * else, which is worse because nothing looks broken until somebody rings up.
 */

/**
 * The pattern the UK government publishes for postcode validation.
 *
 * Kept verbatim rather than simplified. It looks over-complicated because it
 * is encoding real rules — which letters may appear in which position, and the
 * one-off GIR 0AA (Girobank) — and every "tidier" version of this that gets
 * written by hand rejects somebody's real address.
 */
const UK_POSTCODE =
  /^(GIR ?0AA|(?:[A-PR-UWYZ](?:[0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPSTUW]|[A-HK-Y][0-9][ABEHMNPRV-Y])) ?[0-9][ABD-HJLNP-UW-Z]{2})$/i;

/**
 * Canonical form: upper case, exactly one space before the last three.
 *
 * Worth doing on the way in rather than on the way out. Carriers vary in how
 * forgiving they are about "sw1a1aa", and a postcode stored three different
 * ways is a postcode that cannot be grouped or compared.
 */
export function normalisePostcode(value) {
  const bare = String(value || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  if (bare.length < 5) return bare;
  return `${bare.slice(0, -3)} ${bare.slice(-3)}`;
}

/** Does this look like a UK postcode at all? */
export function isValidUkPostcode(value) {
  return UK_POSTCODE.test(normalisePostcode(value));
}

/**
 * The outward code — "SW1A" of "SW1A 1AA".
 *
 * The part that identifies the delivery office, and the part a human can sanity
 * check against a town.
 */
export function outwardCode(value) {
  const normalised = normalisePostcode(value);
  return normalised.includes(" ") ? normalised.split(" ")[0] : normalised;
}

/**
 * Do these two names plausibly describe the same place?
 *
 * Deliberately generous, because the honest answer is usually "cannot tell".
 * A postcode lookup returns the local authority, so SW1A 1AA comes back as
 * *Westminster* while anybody sensible types *London*; M1 1AE comes back as
 * *Manchester*, which matches. Both are correct addresses.
 *
 * So this exists to catch a typed town that is nowhere near the real one — not
 * to enforce agreement — and a false "no" only ever produces a warning.
 */
export function townsAgree(typed, actual) {
  const clean = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .replace(/\b(greater|city|of|upon|the|borough|london)\b/g, "")
      .trim();

  const a = clean(typed);
  const b = clean(actual);
  if (!a || !b) return true; // nothing to disagree about
  return a.includes(b) || b.includes(a);
}
