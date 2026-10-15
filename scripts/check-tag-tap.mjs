/**
 * Does this tap verify against the key we hold for the tag?
 *
 * Paste in one or two tap URLs and it answers that question, and — when the
 * answer is no — which of the several possible reasons it is. That distinction
 * is the entire point of the script. "It does not verify" sends somebody back
 * to a writer app with nothing to change; "the key decrypts the UID and
 * counter correctly but the signature does not match" tells them the MAC key
 * is the problem and the UID mirror is already right.
 *
 * WHY THIS EXISTS AS A COMMAND. Turning signature verification on for a tag is
 * a one-field change (`signature: "none"` -> `"required"`) with no gradual
 * failure mode: if the chip's key is not the key we sealed, every tap from
 * then on is refused as forged and nobody can clock in at that door. There is
 * no shadow mode for a cryptographic check. So the test has to be cheap enough
 * to run before the change, and again after every attempt to reprogramme a
 * chip — which in practice means it must not involve writing a throwaway
 * script each time.
 *
 * IT CHANGES NOTHING. There is no --apply, because there is nothing to apply.
 * It reads one tag and does arithmetic.
 *
 * IT NEVER PRINTS KEY MATERIAL. A key passed with --key is shown only as a
 * length and a short fingerprint, which is enough to tell two attempts apart
 * and not enough to be worth anything if the output is pasted into a chat.
 *
 *   node --env-file=.env --import ./scripts/lib/action-loader.mjs \
 *     scripts/check-tag-tap.mjs \
 *     --url "https://host/clock?tag=…&picc_data=…&cmac=…" \
 *     [--url "<a second tap>"] [--key <32 hex>] [--db test]
 *
 * Two --url flags are better than one: a key that verifies a single tap could
 * still be a coincidence in the layout byte, and the counter only proves it is
 * doing its job if it is seen to increase.
 */
import crypto from "node:crypto";
import mongoose from "mongoose";

import { verifySunMessage } from "@/lib/sun";
import { openTagKey } from "@/lib/tagKeys";
import { normaliseUid, parseTapCounter } from "@/server/clockServer/clockTagStore";

const argv = process.argv.slice(2);

/** Every value given for a repeatable flag, in order. */
const flags = (name) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
};
const flag = (name, fallback = null) => flags(name)[0] ?? fallback;

const URLS = flags("url");
const DB_NAME = flag("db", "test");
const CANDIDATE_KEY = flag("key");

const PICC = flag("picc");
const CMAC = flag("cmac");
const UID_ARG = flag("uid");

function die(message) {
  console.error(message);
  process.exit(1);
}

const hexOnly = (value) =>
  typeof value === "string" ? value.trim().replace(/[^0-9a-fA-F]/g, "").toUpperCase() : "";

/** A key we can name in output without disclosing it. */
const fingerprint = (key) =>
  crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);

/**
 * What a tap URL actually carries.
 *
 * Deliberately tolerant of the two things that are wrong with real tap URLs in
 * the wild. A writer that stamps a trial notice into the NDEF leaves a second
 * `?` in the middle of the tag parameter, and because only the FIRST `?`
 * delimits a query string the notice ends up inside the tag's own value —
 * which is why the uid goes through normaliseUid rather than being trusted.
 * And `picc_data` is the same field as `picc` under the name NXP's own
 * templates emit (app/clock/page.jsx reads both).
 */
function parseTapUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: `not a URL: ${raw}` };
  }
  const q = parsed.searchParams;
  const first = (...names) => {
    for (const name of names) {
      const value = q.get(name);
      if (value) return value;
    }
    return "";
  };
  const rawTag = first("tag");
  return {
    rawTag,
    uid: normaliseUid(rawTag),
    picc: hexOnly(first("picc", "picc_data")),
    enc: hexOnly(first("enc")),
    cmac: hexOnly(first("cmac")),
    ctr: parseTapCounter(first("ctr", "cnt", "counter")),
    watermark: /TRIAL|NOT.?FOR.?PRODUCTION|DEMO.?VERSION/i.test(rawTag),
  };
}

/** The PICC blob as plaintext, however wrong. Mirrors lib/sun.js decryptPicc. */
function decryptBlob(key, blobHex) {
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16));
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([
    decipher.update(Buffer.from(blobHex, "hex")),
    decipher.final(),
  ]);
  return {
    byte0: plain[0],
    uid: plain.subarray(1, 8).toString("hex").toUpperCase(),
    counter: plain[8] | (plain[9] << 8) | (plain[10] << 16),
  };
}

// 0xC7 is "UID present, read counter present" — the one layout lib/sun.js
// accepts, because it is the one the provisioning station programmes.
const EXPECTED_LAYOUT = 0xc7;

function main() {
  const taps = [];

  for (const url of URLS) {
    const tap = parseTapUrl(url);
    if (tap.error) die(tap.error);
    taps.push(tap);
  }
  if (PICC && CMAC) {
    taps.push({
      rawTag: UID_ARG || "",
      uid: UID_ARG ? normaliseUid(UID_ARG) : null,
      picc: hexOnly(PICC),
      enc: hexOnly(flag("enc") || ""),
      cmac: hexOnly(CMAC),
      ctr: parseTapCounter(flag("ctr")),
      watermark: false,
    });
  }
  if (!taps.length) {
    die(
      "Pass --url \"<tap url>\" (repeatable), or --picc <hex> --cmac <hex> [--uid <uid>].",
    );
  }

  return taps;
}

const taps = main();

// ---------------------------------------------------------------------------
// What arrived
// ---------------------------------------------------------------------------
console.log(`${taps.length} tap${taps.length === 1 ? "" : "s"} to check\n`);

taps.forEach((tap, i) => {
  console.log(`tap ${i + 1}`);
  console.log(`  tag parameter  ${tap.rawTag || "(none)"}`);
  if (tap.uid !== tap.rawTag) {
    console.log(`  uid after cleanup  ${tap.uid || "(unreadable)"}`);
  }
  console.log(`  picc  ${tap.picc || "(none)"}  (${tap.picc.length / 2} bytes)`);
  console.log(`  cmac  ${tap.cmac || "(none)"}  (${tap.cmac.length / 2} bytes)`);
  if (tap.enc) console.log(`  enc   ${tap.enc}  (${tap.enc.length / 2} bytes)`);
  if (tap.ctr !== null && tap.ctr !== undefined) {
    console.log(`  ctr   ${tap.ctr} (in the clear)`);
  }
  if (tap.watermark) {
    console.log(
      "  ⚠ the tag parameter carries a writer's trial notice — the chip is fine,\n" +
        "    but the URL on it was written by an unlicensed app",
    );
  }
  console.log();
});

// Do the per-tap values actually change? A chip that mirrors nothing sends the
// same URL every time, and no key on earth will make that single-use.
if (taps.length > 1) {
  const distinct = new Set(taps.map((t) => `${t.picc}|${t.cmac}`));
  if (distinct.size === 1) {
    console.log(
      "⚠ EVERY TAP SENT IDENTICAL VALUES. The chip is not mirroring anything\n" +
        "  per tap, so this is static text in the NDEF, not a signature. No\n" +
        "  server-side change can make it verify — the chip needs SDM enabling.\n",
    );
  } else {
    console.log("✓ the per-tap values differ, so the chip is mirroring (SDM is on)\n");
  }
}

const uids = [...new Set(taps.map((t) => t.uid).filter(Boolean))];
if (uids.length > 1) {
  die(`Those taps are from different tags (${uids.join(", ")}). Check one at a time.`);
}
const uid = uids[0];
if (!uid) die("No readable tag id in any of those taps.");

// ---------------------------------------------------------------------------
// The tag, and the keys worth trying
// ---------------------------------------------------------------------------
await mongoose.connect(process.env.MONGO_DB_URL, {
  dbName: DB_NAME,
  serverSelectionTimeoutMS: 15000,
});
const db = mongoose.connection.db;

const tag = await db.collection("clocktags").findOne({ uid });
if (!tag) {
  console.log(`No tag ${uid} is enrolled in "${DB_NAME}".`);
} else {
  const location = tag.locationId
    ? await db.collection("clocklocations").findOne({ _id: tag.locationId })
    : null;
  console.log(`tag ${uid} — ${tag.label || "unlabelled"}`);
  console.log(`  chip          ${tag.chipType}`);
  console.log(`  signature     ${tag.signature}`);
  console.log(`  key stored    ${tag.keyRef ? "yes" : "NO"}`);
  console.log(`  lastCounter   ${tag.lastCounter ?? 0}`);
  console.log(`  where         ${location?.name || "unassigned"}`);
  console.log(
    `  verification  ${
      tag.keyRef && tag.signature !== "none"
        ? "ON — taps are being checked"
        : "OFF — signature is not being checked"
    }`,
  );
  console.log();
}

const candidates = [];
if (tag?.keyRef) {
  try {
    const key = openTagKey(tag.keyRef);
    candidates.push({ name: "the key this platform sealed for this tag", key });
  } catch (error) {
    console.log(`⚠ the stored keyRef could not be opened: ${error.message}`);
    console.log("  that is a configuration problem on our side, not the chip's\n");
  }
}
if (CANDIDATE_KEY) {
  const clean = hexOnly(CANDIDATE_KEY);
  if (clean.length !== 32) {
    die(`An AES-128 key is 32 hex characters; --key gave ${clean.length}.`);
  }
  candidates.push({
    name: `the key passed with --key (fingerprint ${fingerprint(Buffer.from(clean, "hex"))})`,
    key: Buffer.from(clean, "hex"),
  });
}
// The factory default, as a control. A chip still on all-zero keys is not
// secret, but knowing that is far better than guessing at it.
candidates.push({ name: "the factory all-zero key (control)", key: Buffer.alloc(16) });

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------
const results = [];

for (const candidate of candidates) {
  console.log(`=== ${candidate.name} ===`);
  const perTap = [];

  for (const [i, tap] of taps.entries()) {
    // Both blobs, because which parameter holds the PICC data is exactly the
    // sort of thing a writer's template gets to decide for us.
    for (const field of ["picc", "enc"]) {
      if (!tap[field] || tap[field].length !== 32) continue;
      let layout;
      try {
        layout = decryptBlob(candidate.key, tap[field]);
      } catch (error) {
        console.log(`  tap ${i + 1} ${field}: could not decrypt — ${error.message}`);
        continue;
      }
      const verdict = verifySunMessage({
        piccHex: tap[field],
        cmacHex: tap.cmac,
        key: candidate.key,
      });
      const layoutOk = layout.byte0 === EXPECTED_LAYOUT;
      const uidOk = layout.uid === uid || uid.endsWith(layout.uid) || layout.uid.endsWith(uid);

      console.log(
        `  tap ${i + 1} ${field}: layout 0x${layout.byte0.toString(16).padStart(2, "0")}` +
          `${layoutOk ? " ✓" : " ✗"}  uid ${layout.uid}${uidOk ? " ✓" : " ✗"}` +
          `  counter ${layout.counter}  →  ${verdict.ok ? "VERIFIED ✓" : `no (${verdict.reason})`}`,
      );
      perTap.push({ tapIndex: i, field, layoutOk, uidOk, verdict, layout });
    }
  }

  results.push({ candidate, perTap });
  console.log();
}

// ---------------------------------------------------------------------------
// What to do about it
// ---------------------------------------------------------------------------
console.log("=== verdict ===");

const passing = results.find((r) => r.perTap.some((p) => p.verdict.ok));
// A key that decrypts the real UID with the right layout byte IS the chip's
// key; a failing MAC after that is a different fault and a different fix.
const decrypting = results.find((r) =>
  r.perTap.some((p) => p.layoutOk && p.uidOk && !p.verdict.ok),
);

if (passing) {
  const good = passing.perTap.filter((p) => p.verdict.ok);
  const field = good[0].field;
  console.log(`✓ ${passing.candidate.name} verifies these taps (from "${field}").`);

  const counters = good.map((p) => p.verdict.counter);
  if (counters.length > 1) {
    const rising = counters.every((c, i) => i === 0 || c > counters[i - 1]);
    console.log(
      `  counters ${counters.join(" → ")} — ${rising ? "increasing ✓" : "NOT increasing ✗"}`,
    );
    if (!rising) {
      console.log("  pass the taps in the order they were made; if they were, the chip is odd.");
    }
  } else {
    console.log("  only one tap checked — run it again with a second --url to see the counter move.");
  }

  const stored = (tag?.lastCounter ?? 0);
  const lowest = Math.min(...counters);
  if (lowest <= stored) {
    console.log(
      `  ⚠ counter ${lowest} is at or below the stored ${stored}, so that tap would be\n` +
        "    refused as a replay. Expected if you have already used it.",
    );
  }

  if (field === "enc") {
    console.log(
      "  ⚠ the PICC data arrived in `enc`, not `picc_data`. app/clock/page.jsx reads\n" +
        "    `picc`/`picc_data` only, so this tap would reach the server unsigned.",
    );
  }

  if (tag && tag.signature === "none") {
    console.log(
      `\n  Next: this tag is ready for signature verification, which is off.\n` +
        `  Set signature to "required" for ${uid} and taps will be checked from then on.`,
    );
  }
} else if (decrypting) {
  console.log(
    `✓ ${decrypting.candidate.name} DOES decrypt the PICC data: the layout byte and the\n` +
      "  real UID both come out right, so that IS the chip's key.",
  );
  console.log("✗ but the signature does not match. Two known causes, in order:");
  console.log(
    "    1. The chip mirrors encrypted file data (an `enc` parameter). When it does,\n" +
      "       the MAC covers that data — lib/sun.js computes it over an empty message,\n" +
      "       so it will never agree. Either stop mirroring `enc` or teach the verifier.",
  );
  console.log(
    "    2. SDM uses a separate MAC key (SDMFileReadKey) from the one that encrypts\n" +
      "       the PICC data (SDMMetaReadKey). verifySunMessage takes a `macKey` for this.",
  );
} else {
  console.log("✗ none of those keys decrypts these taps.");
  console.log(
    "  The plaintext is noise — a random layout byte, a UID that is not this tag's.\n" +
      "  That is what a wrong key looks like, and it cannot be narrowed further from\n" +
      "  the ciphertext: the key has to come from the writing side.",
  );
  console.log("\n  Worth checking, in this order:");
  console.log(
    "    1. Which key NUMBER the writer pointed SDM at. A key written into slot 0\n" +
      "       while SDM reads slot 1 or 2 looks exactly like this.",
  );
  console.log("    2. Whether the writer accepted your key at all, or generated its own.");
  console.log(
    "    3. Whether an unlicensed writer substituted a fixed demo key — which would\n" +
      "       also mean every tag written with it shares one key.",
  );
  console.log(
    "\n  Do NOT turn signature verification on until this passes: with the wrong key\n" +
      "  every tap is refused as forged and nobody can clock in at that door.",
  );
}

await mongoose.disconnect();
process.exit(passing ? 0 : 1);
