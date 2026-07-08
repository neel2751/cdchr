import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16; // fixed size for GCM auth tag

// The key is sourced exclusively from environment configuration (no in-code
// fallback). encrypt()/decrypt() are also used inside client components to
// obfuscate record IDs in URLs, so the key is read from a NEXT_PUBLIC_ variable
// (inlined into the browser bundle) and falls back to the server-only variable
// for purely server-side callers. It is resolved lazily — not at module load —
// so importing this module never throws in a context where the value is absent.
function getKeyBuffer() {
  const key =
    process.env.NEXT_PUBLIC_ALGO_KEY || process.env.EMAIL_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      "NEXT_PUBLIC_ALGO_KEY (or EMAIL_ENCRYPTION_KEY) must be set as a 32-byte hex string (64 hex chars)"
    );
  }
  return Buffer.from(key, "hex");
}

export function encryptId(id) {
  const iv = randomBytes(12); // 12-byte IV for AES-GCM

  const cipher = createCipheriv(ALGORITHM, getKeyBuffer(), iv);
  let encrypted = cipher.update(JSON.stringify({ id }), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag(); // Get the authentication tag
  const encrypt = `${encrypted}/${iv.toString("hex")}/${authTag.toString(
    "hex"
  )}`;
  return encrypt;
}

// Base64url encode/decode utils for URL safe strings
function base64urlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str) {
  str = str?.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) {
    str += "=";
  }
  return Buffer.from(str, "base64");
}

/**
 * Encrypt plain text into a base64url encoded string.
 * Output contains IV + AuthTag + ciphertext concatenated.
 *
 * @param {string} plainText - Text to encrypt
 * @returns {string} base64url encoded encrypted string
 */

export function encrypt(plainText) {
  if (!plainText || typeof plainText !== "string") {
    return false; // Invalid input
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKeyBuffer(), iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Combine iv + authTag + encrypted data
  const combined = Buffer.concat([iv, authTag, encrypted]);

  return base64urlEncode(combined);
}

/**
 * Decrypt a base64url encoded string previously encrypted with this module.
 *
 * @param {string} encryptedText - base64url encrypted string
 * @returns {string} decrypted plain text
 */
export function decrypt(encryptedText) {
  const combined = base64urlDecode(encryptedText);
  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    return false; // Invalid input
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getKeyBuffer(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
