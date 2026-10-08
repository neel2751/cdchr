import crypto from "node:crypto";

/**
 * The AES keys that go onto NTAG 424 DNA chips.
 *
 * One rule governs this whole file: **the customer never generates, sees or
 * handles a key.** A key they generate is one that gets emailed, pasted into a
 * spreadsheet, or reused across every tag they own. A key they can read is one
 * they can leak. A key they can lose is a support call whose only remedy is
 * re-provisioning physical hardware. So keys are made here, during fulfilment,
 * and never leave the server.
 *
 * They are not stored in the clear either. Each one is sealed with a master key
 * held only in the environment, so a database dump is not a box of working
 * tags. See CLOCK_LOCATION_PLAN.md §6.1 and §6.4.
 *
 * PER TAG, NEVER SHARED. If every tag carried one key, losing a single sticker
 * off a cabin door would mean re-keying every tag the company owns. Per-tag
 * keys make a loss a one-tag problem.
 */

// AES-128 is what the chip does; the length is the chip's decision, not ours.
const TAG_KEY_BYTES = 16;

// AES-256-GCM for the sealing. GCM because it authenticates: a tampered blob
// fails to open rather than decrypting to a plausible-looking wrong key.
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The master key, from the environment.
 *
 * Read on each call rather than at import: a module-scope read would make a
 * missing variable a crash at boot for every route that transitively imports
 * this, when it should only ever stop the tag feature.
 */
function masterKey() {
  const raw = process.env.TAG_KEY_MASTER;
  if (!raw) {
    throw new Error(
      "TAG_KEY_MASTER is not set. Generate one with " +
        "`openssl rand -hex 32` and put it in the environment — without it, " +
        "tag keys cannot be sealed or read.",
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

/** Is the environment configured to do any of this? */
export function tagKeysConfigured() {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/** A fresh key for one tag. */
export function generateTagKey() {
  return crypto.randomBytes(TAG_KEY_BYTES);
}

/**
 * Seal a key for storage. Returns `iv:tag:ciphertext`, base64 each.
 *
 * What goes in the database is this, never the key.
 */
export function sealTagKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== TAG_KEY_BYTES) {
    throw new Error(`A tag key must be ${TAG_KEY_BYTES} bytes.`);
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const sealed = Buffer.concat([cipher.update(key), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, sealed].map((b) => b.toString("base64")).join(":");
}

/**
 * Open a sealed key.
 *
 * Only two callers should ever exist: the provisioning station, which writes
 * the key onto a chip, and tap verification, which checks a chip's signature.
 * Nothing else has a reason to hold plaintext key material.
 */
export function openTagKey(keyRef) {
  if (typeof keyRef !== "string" || !keyRef.includes(":")) {
    throw new Error("That key reference could not be read.");
  }
  const [iv, authTag, sealed] = keyRef
    .split(":")
    .map((part) => Buffer.from(part, "base64"));

  if (iv?.length !== IV_BYTES || authTag?.length !== TAG_BYTES || !sealed?.length) {
    throw new Error("That key reference could not be read.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(authTag);
  // Throws if the blob was tampered with or the master key has changed —
  // which is the point of GCM over a bare cipher.
  return Buffer.concat([decipher.update(sealed), decipher.final()]);
}

/**
 * A key as the programming tool wants it: uppercase hex.
 *
 * Deliberately the only place plaintext key material becomes a string. Keep it
 * out of logs, audit entries and error messages.
 */
export function tagKeyToHex(key) {
  return key.toString("hex").toUpperCase();
}
