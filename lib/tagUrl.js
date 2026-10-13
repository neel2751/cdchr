/**
 * The URL that goes on a physical tag.
 *
 * This existed nowhere. The format was a sentence in a comment at the top of
 * app/clock/page.jsx, the plan document described an older design
 * (`?loc=ELM`, before a tag could be reassigned without rewriting the chip),
 * and the provisioning station — the one screen whose whole job is programming
 * chips — never showed it at all. Somebody with a tag in one hand and a writer
 * in the other had to read the source to find out what to type.
 *
 * So the format has a module. One definition, used by the station, and the
 * thing to update if the scan endpoint ever changes.
 *
 * WHAT A TAP CARRIES
 *
 *   tag   the chip's own UID. The server looks the tag up by it and takes the
 *         location from whatever that tag is currently bound to — which is why
 *         reassigning a tag does not mean rewriting it.
 *   picc  NTAG 424 DNA only: the UID and the chip's read counter, encrypted
 *         under the tag's key. Added BY THE CHIP on every tap.
 *   cmac  424 only: a signature over that, also added by the chip.
 *
 * The chip fills the last two in itself through SDM/SUN mirroring, so what is
 * written is a template with runs of zeroes for it to overwrite. Their lengths
 * are not a convention — lib/sun.js rejects anything else: picc is 16 bytes
 * (32 hex characters) and cmac is 8 bytes (16 hex).
 */

/**
 * WHICH HOST GOES ON A CHIP
 *
 * The platform's own, from PLATFORM_APEX_HOST — never the customer's
 * `<slug>.<root>` address. Three reasons, in order of how much they cost:
 *
 *  1. A chip is written once and stays on a wall for years. A host written
 *     onto it cannot be changed without rewriting every tag the customer
 *     owns, so it has to be the address we are most certain stays ours. A
 *     customer's subdomain is the least certain: they move to their own
 *     domain, they rename, they leave.
 *  2. `<slug>.<root>` needs a wildcard DNS record and a TLS certificate for a
 *     wildcard two labels deep (`*.staffmain.example.co.uk`). Universal
 *     certificates cover one label only, so that host does not serve HTTPS
 *     until somebody buys a certificate for it — and a tag pointing at a host
 *     with no certificate is a sticker that does nothing.
 *  3. One URL for every tag we write means no per-order host to get wrong.
 *
 * It costs nothing in separation. The UID on the chip is looked up inside the
 * signed-in employee's own company, because ClockTag is tenant-scoped and the
 * scope comes from their session rather than from the hostname — so a tap can
 * only ever match a tag their own company owns, whatever host the URL used to
 * get there. A tag from another company reads as "not set up yet", which is
 * exactly what it is from where they are standing.
 *
 * /clock is outside the matcher in proxy.js, so nothing redirects a tap off
 * this host; the page authenticates on its own and sends a signed-out employee
 * to /auth and straight back.
 *
 * The origin itself comes from platformOrigin() in lib/tenantHost.js, with the
 * rest of the link-building. A tag is just the one case where the customer's
 * own verified domain is NOT preferred — that domain is a fine place to send
 * an email, and a bad thing to etch into hardware.
 */
/** Hex placeholders the chip's mirror overwrites. Sizes per lib/sun.js. */
const UID_PLACEHOLDER = "0".repeat(14); // a 7-byte UID
const PICC_PLACEHOLDER = "0".repeat(32); // 16 bytes
const CMAC_PLACEHOLDER = "0".repeat(16); // 8 bytes

/** Trim a trailing slash so the join below cannot produce a double one. */
function origin(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

/**
 * What to programme onto the chip.
 *
 * The same string for every tag of a given chip type, because both chips can
 * mirror their own UID into the URL — so there is no per-tag hand-editing, and
 * no opportunity to put tag 14's UID on tag 15.
 *
 * @param {{baseUrl: string, chipType?: string}} args the customer's own origin
 */
export function clockUrlTemplate({ baseUrl, chipType = "ntag213" }) {
  const base = `${origin(baseUrl)}/clock?tag=${UID_PLACEHOLDER}`;
  return chipType === "ntag424"
    ? `${base}&picc=${PICC_PLACEHOLDER}&cmac=${CMAC_PLACEHOLDER}`
    : base;
}

/**
 * The concrete URL for one chip, once its UID is known.
 *
 * For checking a tag by hand — paste it into a browser and the scan should
 * behave exactly as a tap would, minus the signature. Not what gets written:
 * a 424 needs its placeholders to mirror into, and writing a bare URL would
 * leave the chip unable to sign anything.
 */
export function clockUrlFor({ baseUrl, uid }) {
  if (!uid) return "";
  return `${origin(baseUrl)}/clock?tag=${encodeURIComponent(uid)}`;
}

export const TAG_URL_FIELD_SIZES = {
  piccHexChars: PICC_PLACEHOLDER.length,
  cmacHexChars: CMAC_PLACEHOLDER.length,
  uidHexChars: UID_PLACEHOLDER.length,
};

/**
 * Placeholder spellings different writers expect.
 *
 * A tool that computes the offsets itself has to FIND the fields in the URL,
 * and they do not agree on how you mark them. Handed a URL with no marker it
 * recognises, a lookup returns -1 and the tool then tries to pack -1 into a
 * byte — which is where "bytes must be in range (0, 256)" comes from. The
 * zero-run form below is for the other kind of tool, where you type the
 * offsets yourself.
 *
 * Curly braces are the most common spelling; the others are offered because
 * guessing wrong costs a tag.
 */
export const TOKEN_STYLES = [
  { label: "Curly braces", uid: "{UID}", picc: "{PICC}", cmac: "{CMAC}" },
  { label: "Percent", uid: "%UID%", picc: "%PICC%", cmac: "%CMAC%" },
  { label: "Lowercase", uid: "{uid}", picc: "{picc_data}", cmac: "{mac}" },
];

/**
 * The URL with named placeholders instead of zero-runs.
 *
 * For a writer that works out the offsets from the URL, which is most of the
 * ones that only ask for a URL and a key.
 */
export function clockUrlTokens({ baseUrl, chipType = "ntag213", style = TOKEN_STYLES[0] }) {
  const base = `${origin(baseUrl)}/clock?tag=${style.uid}`;
  return chipType === "ntag424"
    ? `${base}&picc=${style.picc}&cmac=${style.cmac}`
    : base;
}

/**
 * Just the endpoint, for a writer that appends its own parameters.
 *
 * IF IT APPENDS ITS OWN NAMES, THEY HAVE TO BE OURS. app/clock/page.jsx reads
 * `tag`, `picc` and `cmac` and nothing else, so a tool that emits
 * `?picc_data=…&cmac=…` produces a tap this app does not understand. The way
 * to find out is to write one tag, tap it, and read the URL that opens.
 */
export function clockEndpoint({ baseUrl }) {
  return `${origin(baseUrl)}/clock`;
}

/**
 * Byte offsets of each mirrored field, for a writer that asks for them.
 *
 * Computed from the URL rather than written down, because the host length
 * changes them and a stale number in a document is a tag that cannot sign.
 *
 * Two framings, because tools disagree about where zero is: `fromFileStart`
 * counts the NDEF file's own header — 2 bytes of NLEN, then the record header
 * `D1 01 <len> 55` and the `0x04` "https://" prefix byte — while
 * `fromUrlText` counts from the first character of the URL text itself.
 */
export function clockUrlOffsets({ baseUrl, chipType = "ntag424" }) {
  const url = clockUrlTemplate({ baseUrl, chipType });
  const stored = url.slice("https://".length);
  const NDEF_HEADER_BYTES = 7; // 2 NLEN + D1 01 <len> 55 + 04

  const at = (marker) => {
    const i = stored.indexOf(marker);
    return i < 0 ? null : i + marker.length;
  };

  const uid = at("tag=");
  const picc = chipType === "ntag424" ? at("picc=") : null;
  const cmac = chipType === "ntag424" ? at("cmac=") : null;

  const shift = (n) => (n === null ? null : n + NDEF_HEADER_BYTES);

  return {
    fromUrlText: { uid, picc, cmac },
    fromFileStart: { uid: shift(uid), picc: shift(picc), cmac: shift(cmac) },
    urlLength: url.length,
  };
}
