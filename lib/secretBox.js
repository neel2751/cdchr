import crypto from "node:crypto";

/**
 * Sealing arbitrary platform secrets — carrier API tokens, and anything else
 * we hold on a customer's behalf that is not a tag key.
 *
 * Same construction as lib/tagKeys.js (AES-256-GCM, `iv:tag:ciphertext` in
 * base64) and the same master key, deliberately: these sit inside one trust
 * boundary — secrets the platform holds, readable only by platform code — and
 * a second master key would be a second thing to set, a second thing to back
 * up, and a second thing to get wrong.
 *
 * THE TRADE-OFF, stated plainly: rotating TAG_KEY_MASTER invalidates carrier
 * credentials as well as tag keys. A rotation therefore means re-entering
 * every carrier token, not only re-provisioning hardware. That is a real cost
 * and it is the price of one key instead of two.
 *
 * tagKeys.js is left alone rather than refactored onto this. It is the most
 * security-sensitive path in the product and it is covered by its own tests;
 * rewriting working crypto to remove a dozen duplicated lines is not a trade
 * worth making.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

function masterKey() {
  const raw = process.env.TAG_KEY_MASTER;
  if (!raw) {
    throw new Error(
      "TAG_KEY_MASTER is not set. Generate one with `openssl rand -hex 32` " +
        "and put it in the environment — without it, carrier credentials " +
        "cannot be sealed or read.",
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(
      `TAG_KEY_MASTER must be 32 bytes of hex (64 characters); got ${key.length}.`,
    );
  }
  return key;
}

/** Can anything be sealed at all? */
export function secretsConfigured() {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/** Seal a string for storage. Returns `iv:tag:ciphertext`, base64 each. */
export function sealSecret(plaintext) {
  if (typeof plaintext !== "string" || !plaintext) {
    throw new Error("Nothing to seal.");
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const sealed = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), sealed]
    .map((b) => b.toString("base64"))
    .join(":");
}

/**
 * Open a sealed string.
 *
 * Throws if the blob was tampered with or the master key has changed, which is
 * the point of GCM over a bare cipher: a credential that silently decrypts to
 * rubbish becomes an authentication failure nobody can explain.
 */
export function openSecret(ref) {
  if (typeof ref !== "string" || !ref.includes(":")) {
    throw new Error("That secret could not be read.");
  }
  const [iv, authTag, sealed] = ref
    .split(":")
    .map((part) => Buffer.from(part, "base64"));

  if (iv?.length !== IV_BYTES || authTag?.length !== TAG_BYTES || !sealed?.length) {
    throw new Error("That secret could not be read.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(sealed), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * The last few characters, for a screen that has to show *which* token is
 * stored without showing the token.
 *
 * Four characters: enough to tell two apart, not enough to be worth stealing.
 */
export function secretHint(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length < 8) return "····";
  return `····${plaintext.slice(-4)}`;
}
