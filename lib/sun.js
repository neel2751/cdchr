import crypto from "node:crypto";

/**
 * Verifying an NTAG 424 DNA "SUN" message.
 *
 * SUN — Secure Unique NFC — is what makes a £3 sticker worth more than a
 * printed QR code. On every tap the chip increments an internal counter and
 * emits a URL carrying two extra parameters:
 *
 *   picc  encrypted UID + counter, AES-128-CBC under the tag's key
 *   cmac  a truncated AES-CMAC over that, under a session key derived from it
 *
 * Without the key you cannot produce either. So a URL captured once and
 * replayed carries a counter that has already been spent, and a URL with a
 * *bumped* counter fails its CMAC.
 *
 * THIS FILE EXISTS BECAUSE THE COUNTER ALONE IS WORTHLESS. Until now the
 * counter was read straight off the query string, which anybody can edit — so
 * "replay protection" amounted to asking the attacker not to increment a
 * number. The counter is only evidence once it arrives inside something the
 * chip signed.
 *
 * Node has no CMAC, so RFC 4493 is implemented below on top of AES-ECB.
 */

const BLOCK = 16;
const ZERO = Buffer.alloc(BLOCK);
const RB = 0x87; // the constant RFC 4493 specifies for 128-bit blocks

/** Left-shift a block by one bit, xor-ing in Rb on overflow. RFC 4493 §2.3. */
function shiftLeftXorRb(input) {
  const out = Buffer.alloc(BLOCK);
  let carry = 0;
  for (let i = BLOCK - 1; i >= 0; i--) {
    out[i] = ((input[i] << 1) & 0xff) | carry;
    carry = input[i] & 0x80 ? 1 : 0;
  }
  if (carry) out[BLOCK - 1] ^= RB;
  return out;
}

function aesEcbEncryptBlock(key, block) {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** AES-CMAC (RFC 4493). Returns the full 16-byte tag. */
export function aesCmac(key, message = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(key) || key.length !== BLOCK) {
    throw new Error("AES-CMAC needs a 16-byte key");
  }

  // Subkeys.
  const L = aesEcbEncryptBlock(key, ZERO);
  const K1 = shiftLeftXorRb(L);
  const K2 = shiftLeftXorRb(K1);

  const n = Math.ceil(message.length / BLOCK);
  const complete = n > 0 && message.length % BLOCK === 0;
  const blocks = n === 0 ? 1 : n;

  let last;
  if (complete) {
    last = xor(message.subarray((blocks - 1) * BLOCK, blocks * BLOCK), K1);
  } else {
    // Pad with 0x80 then zeros, then xor K2.
    const tail = message.subarray((blocks - 1) * BLOCK);
    const padded = Buffer.alloc(BLOCK);
    tail.copy(padded);
    padded[tail.length] = 0x80;
    last = xor(padded, K2);
  }

  let x = ZERO;
  for (let i = 0; i < blocks - 1; i++) {
    x = aesEcbEncryptBlock(key, xor(x, message.subarray(i * BLOCK, (i + 1) * BLOCK)));
  }
  return aesEcbEncryptBlock(key, xor(x, last));
}

/**
 * The session key the chip MACs with.
 *
 * NXP's SDM derives it per tap from the UID and counter, so the MAC key itself
 * never travels and two taps never share a session key.
 */
function sessionMacKey(macKey, uid, counterLe) {
  const sv2 = Buffer.concat([
    Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]),
    uid,
    counterLe,
  ]);
  return aesCmac(macKey, sv2);
}

/** The chip sends every other byte of the CMAC, starting at index 1. */
function truncateCmac(full) {
  const out = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) out[i] = full[i * 2 + 1];
  return out;
}

/** Decrypt the PICC blob: AES-128-CBC, zero IV, no padding. */
function decryptPicc(metaKey, picc) {
  const decipher = crypto.createDecipheriv("aes-128-cbc", metaKey, ZERO);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(picc), decipher.final()]);
}

const hex = (value) => {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/[^0-9a-fA-F]/g, "");
  if (!clean.length || clean.length % 2) return null;
  return Buffer.from(clean, "hex");
};

/**
 * Check a tap.
 *
 * @param piccHex  the `picc` parameter from the URL
 * @param cmacHex  the `cmac` parameter
 * @param key      the tag's AES key
 * @param macKey   optional separate MAC key; defaults to `key`
 *
 * @returns `{ ok, uid, counter, reason }` — `uid` and `counter` come out of the
 *          *decrypted* blob, never off the query string.
 */
export function verifySunMessage({ piccHex, cmacHex, key, macKey }) {
  const picc = hex(piccHex);
  const cmac = hex(cmacHex);

  if (!picc || picc.length !== 16) {
    return { ok: false, reason: "picc is not 16 bytes" };
  }
  if (!cmac || cmac.length !== 8) {
    return { ok: false, reason: "cmac is not 8 bytes" };
  }
  if (!Buffer.isBuffer(key) || key.length !== BLOCK) {
    return { ok: false, reason: "no usable key for this tag" };
  }

  const plain = decryptPicc(key, picc);

  // Byte 0 is a tag byte describing which fields follow. 0xC7 is
  // "UID present, read counter present", which is the configuration we
  // programme. Anything else is a chip set up differently from ours.
  if (plain[0] !== 0xc7) {
    return { ok: false, reason: "unexpected PICC layout" };
  }

  const uid = plain.subarray(1, 8); // 7 bytes
  const counterLe = plain.subarray(8, 11); // 3 bytes, little-endian
  const counter = counterLe[0] | (counterLe[1] << 8) | (counterLe[2] << 16);

  const sessionKey = sessionMacKey(macKey || key, uid, counterLe);
  const expected = truncateCmac(aesCmac(sessionKey, Buffer.alloc(0)));

  // Constant-time: a length-safe compare that does not leak how much of the
  // MAC was right.
  if (
    expected.length !== cmac.length ||
    !crypto.timingSafeEqual(expected, cmac)
  ) {
    return { ok: false, reason: "signature does not match" };
  }

  return {
    ok: true,
    uid: uid.toString("hex").toUpperCase(),
    counter,
    reason: null,
  };
}

/**
 * Build a tap the way a chip would. Test-only, and the only honest way to
 * check the verifier: a verifier tested against its own output is a verifier
 * tested against nothing.
 */
export function buildSunMessageForTest({ key, uid, counter, macKey }) {
  const uidBuf = Buffer.isBuffer(uid) ? uid : Buffer.from(uid, "hex");
  if (uidBuf.length !== 7) throw new Error("a SUN UID is 7 bytes");

  const counterLe = Buffer.from([
    counter & 0xff,
    (counter >> 8) & 0xff,
    (counter >> 16) & 0xff,
  ]);

  const plain = Buffer.alloc(16);
  plain[0] = 0xc7;
  uidBuf.copy(plain, 1);
  counterLe.copy(plain, 8);
  // 11..15 is padding the chip fills; its value does not enter the MAC.
  plain.fill(0x80, 11, 12);

  const cipher = crypto.createCipheriv("aes-128-cbc", key, ZERO);
  cipher.setAutoPadding(false);
  const picc = Buffer.concat([cipher.update(plain), cipher.final()]);

  const sessionKey = sessionMacKey(macKey || key, uidBuf, counterLe);
  const cmac = truncateCmac(aesCmac(sessionKey, Buffer.alloc(0)));

  return {
    picc: picc.toString("hex").toUpperCase(),
    cmac: cmac.toString("hex").toUpperCase(),
  };
}
