import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
export function encryptId(id) {
  const key =
    "52bdc56fb0440989d14fad277de68f2221727ae3501ffe3d37607e5684d4be88"; // Use a securely generated key
  const iv = randomBytes(12); // 12-byte IV for AES-GCM

  const cipherKey = Buffer.from(key, "hex");
  const cipher = createCipheriv("aes-256-gcm", cipherKey, iv);
  let encrypted = cipher.update(JSON.stringify({ id }), "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag(); // Get the authentication tag
  const encrypt = `${encrypted}/${iv.toString("hex")}/${authTag.toString(
    "hex"
  )}`;
  return encrypt;
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16; // fixed size for GCM auth tag

const KEY =
  process.env.EMAIL_ENCRYPTION_KEY ||
  "52bdc56fb0440989d14fad277de68f2221727ae3501ffe3d37607e5684d4be88";

if (!KEY || KEY.length !== 64) {
  throw new Error(
    "EMAIL_ENCRYPTION_KEY must be set in env as 32-byte hex string (64 hex chars)"
  );
}
const keyBuffer = Buffer.from(KEY, "hex");

// Base64url encode/decode utils for URL safe strings
function base64urlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
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
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

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

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
