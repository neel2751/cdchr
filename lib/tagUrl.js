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
