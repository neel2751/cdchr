/**
 * Reading and recognising NFC tags.
 *
 * NOT a "use server" module — `recordSighting` writes, and none of this should
 * be callable from a browser by name.
 */
import { createHash } from "crypto";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import ClockTagModel from "@/models/clockTagModel";
import { openTagKey } from "@/lib/tagKeys";
import { verifySunMessage } from "@/lib/sun";

/**
 * A chip UID as we store it: hex, uppercase, no separators.
 *
 * READS THE LEADING RUN, rather than stripping every non-hex character out of
 * the whole string. The difference is not cosmetic, and it is the reason a
 * correctly written tag was refused for days.
 *
 * Trial-version tag writers append a watermark to the URL they write, and they
 * append it immediately after the value:
 *
 *   /clock?tag=048A35BA1E1E90?_____TRIAL_VERSION______NOT_FOR_PRODUCTION_____&picc_data=…
 *
 * Only the FIRST "?" in a URL delimits the query, so that whole watermark is
 * part of the `tag` value. Stripping non-hex globally then salvaged a letter
 * here and there out of the English — A from "tri[A]l", E from "v[E]rsion", F
 * from "[F]or", D and C from "pro[D]u[C]tion" — and welded them onto the end of
 * a perfectly good UID:
 *
 *   048A35BA1E1E90  ->  048A35BA1E1E90AEFDC
 *
 * Nineteen characters, well-formed hex, the right sort of length: it sailed
 * through every check here and matched no tag, so the tap came back "this tag
 * has not been set up yet" — which points at the registry, the one thing that
 * was correct. The UID was intact the whole time, with five letters of a legal
 * notice stuck to it.
 *
 * So: separators are tolerated (04:A3:5B:… is the same chip, and readers do
 * format it that way), and the UID ends at the first character that is neither
 * hex nor a separator. Truncating is also the safer failure: a mangled value
 * can now only ever resolve to a shorter string, where gluing fragments
 * together could invent one that collides with a real chip.
 */
const UID_SEPARATORS = /[\s:\-.]/g;

export function normaliseUid(raw) {
  if (!raw || typeof raw !== "string") return null;
  const leading = raw.trim().match(/^[0-9a-fA-F\s:\-.]+/);
  if (!leading) return null;
  const cleaned = leading[0].replace(UID_SEPARATORS, "").toUpperCase();
  // 4-byte and 7-byte UIDs are the common ones; allow a little either side
  // rather than rejecting a chip nobody anticipated.
  if (cleaned.length < 8 || cleaned.length > 32) return null;
  // All zeros is the URL TEMPLATE, not a chip. The zero-run in the programmed
  // URL is what the chip's UID mirror overwrites, so zeros arriving here mean
  // the mirror was never switched on and the chip is sending the placeholder
  // back verbatim.
  //
  // It had to be rejected rather than merely reported: it is a well-formed
  // hex string of the right length, so it used to go straight to the lookup
  // and come back "unknown" — and a super admin tapping it would ENROL it,
  // creating a tag whose UID is zeros. Every badly written chip in the
  // company would then match that one tag and clock people in at its
  // location. No real UID is zeros; NXP chips begin with 0x04.
  if (/^0+$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * The chip's read counter, as it arrives mirrored in the URL.
 *
 * Hex, because that is what both chips mirror — NXP's ASCII mirror writes the
 * counter as hex digits, so "00001A" is 26 and not one thousand and a bit.
 * Reading it as decimal would still go up, which is the trap: it would appear
 * to work and then refuse a real tap every time a digit rolled past 9.
 *
 * Returns null for anything unusable, which the caller must treat as "this tap
 * carried no counter" rather than as zero — zero is a legitimate counter value
 * on a chip that has never been read, and conflating them would let a crafted
 * `ctr=000000` pass as the lowest possible rather than as nothing at all.
 */
export function parseTapCounter(raw) {
  if (raw === 0) return 0;
  if (!raw) return null;
  const cleaned = String(raw).trim();
  // Only a plain hex run. A counter arriving with anything else in it is a
  // mangled URL, and guessing at it would be inventing evidence.
  if (!/^[0-9a-fA-F]{1,8}$/.test(cleaned)) return null;
  const value = parseInt(cleaned, 16);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * A short, stable id for one physical tap — used to spend it.
 *
 * THE CASE THIS EXISTS FOR, because it is not hypothetical. A 424 whose key we
 * do not hold still mirrors `picc` and `cmac`, and those change on every single
 * tap: the encrypted blob covers the chip's read counter, so each read produces
 * a different ciphertext. We cannot decrypt it and therefore cannot prove the
 * chip produced it — but we do not need to decrypt it to notice that THIS EXACT
 * BLOB has been used before.
 *
 * That is the difference between a tap and a refresh. A reload re-sends the
 * same URL byte for byte, so the same nonce; a real tap sends a new one. So
 * even a tag we cannot verify can be made single-use, which is what makes "one
 * tap, one action" true rather than merely displayed.
 *
 * WHAT IT DOES NOT DO: it is not a signature and not ordered. Somebody who
 * captured a URL from a tap that was never used could still spend it later,
 * because without the key there is nothing to compare it against — only a
 * signed counter gives ordering. It closes reload, history, bookmarks and a
 * forwarded link, which is every way a tap gets reused by accident.
 *
 * Hashed rather than stored raw, and truncated, because this is an equality
 * check against a bounded list — the ciphertext itself is not wanted on disk
 * and 64 bits of it is already far past collision for a list of fifty.
 */
export function tapNonce({ picc, cmac, counter } = {}) {
  const parts = [picc, cmac, counter]
    .map((v) => String(v ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (!parts.length) return null;
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/**
 * How long a tap stays worth something.
 *
 * SPENDING A TAP WAS NOT ENOUGH, and the gap is worth spelling out because it
 * survived three rounds of work on exactly this. `usedTapIds` records a tap
 * that was spent on an action. A tap that was never spent was never recorded,
 * so its URL kept working indefinitely — and that is not theoretical: a link
 * saved on 2026-10-14 with no action taken clocked somebody in on the 15th.
 *
 * The second tap of a shift is where it happens. The first has one possible
 * meaning and fires at once, which spends it. Once clocked in, the screen must
 * ask whether this is a break or a clock-out — and a tap left sitting on that
 * question is unspent, so under the old rules it was good for ever.
 *
 * Five minutes, because the honest flow is seconds: hold the phone to the tag,
 * read the question, press the button. Five minutes covers being interrupted
 * mid-tap and nothing else. It is deliberately not generous — the entire value
 * of the number is how small it is.
 *
 * WHAT THIS DOES AND DOES NOT CLOSE. It kills a link kept in a browser, a
 * bookmark, a screenshot, a message to a friend — everything that goes through
 * our page, because the clock starts the moment the page loads. It does NOT
 * stop somebody reading the chip with an NFC app and hoarding URLs they never
 * open: those are unseen, so nothing has started their clock. Only a signed
 * counter orders those, and that needs a key we do not have (see
 * `verifySunMessage` and the tag:check command). Hoarded URLs still have to be
 * spent from inside the geofence with a position, which is the backstop.
 */
export const TAP_TTL_MS = 5 * 60 * 1000;

/**
 * Has this tap been sitting around too long?
 *
 * Returns a refusal, or null to carry on. Separate from the replay check
 * because they are different failures with different advice: a replay means
 * "you already used this", an expiry means "this one went stale, tap again",
 * and telling somebody they have already clocked in when they have not is the
 * sort of message that gets a system distrusted.
 */
function expiredTap(tag, nonce, ignoreExpiry) {
  if (!nonce || ignoreExpiry) return null;
  const seen = (tag.seenTaps || []).find((s) => s?.nonce === nonce);
  if (!seen?.at) return null;
  if (Date.now() - new Date(seen.at).getTime() <= TAP_TTL_MS) return null;
  return {
    ok: false,
    status: "expired",
    tag,
    message: "This tap is too old to use. Hold the phone to the tag again.",
  };
}

/**
 * Why a link arrived with no readable tag id.
 *
 * Every one of these is a chip that was written wrong, not an employee who did
 * anything wrong, and each has a different fix:
 *
 *   {UID} still in the URL  — the example URL was programmed verbatim and the
 *                             placeholder was never substituted. Whoever wrote
 *                             the tag has to write it again.
 *   all zeros               — the zero-run template went on, but the chip's
 *                             UID mirror was never switched on, so the chip is
 *                             not filling it in. Also a rewrite, in the
 *                             writer's settings rather than the URL.
 *   anything else           — truncated or mangled, usually a link that was
 *                             typed or copied by hand.
 */
function unreadableUidMessage(raw) {
  const value = String(raw || "");
  if (!value) {
    return "That link did not include a tag id. Tap the tag rather than opening a saved link.";
  }
  if (/[{}%<>]/.test(value) || /^(uid|tag)$/i.test(value)) {
    return (
      "This tag was programmed with the example URL — the {UID} placeholder " +
      "is still in it. It needs writing again with a real tag id."
    );
  }
  if (/^0+$/.test(value.replace(/[^0-9a-fA-F]/g, ""))) {
    return (
      "This tag is not filling in its own id — it was written without the " +
      "UID mirror switched on. It needs writing again."
    );
  }
  // An unlicensed writer stamps its nag into the URL it writes. Where the UID
  // survives in front of it the tap now works (see normaliseUid), so reaching
  // here means the watermark landed on top of the id itself and there is
  // nothing to recover. Worth naming: the fix is a different writing tool, and
  // nobody would guess that from "could not be read".
  if (/TRIAL|NOT.?FOR.?PRODUCTION|DEMO.?VERSION/i.test(value)) {
    return (
      "This tag was written by an unlicensed app, which has stamped its own " +
      "notice over the tag id. It needs writing again with a different tool."
    );
  }
  return "That tag id could not be read. Tap the tag again, or tell your manager.";
}

/**
 * What does this tap mean?
 *
 * Returns `{ ok, tag, status, message }`. `status` distinguishes the reasons a
 * tap can fail, because they need different things done about them:
 *
 *   "unknown"    — no such tag for this company. Not an error: a brand-new tag
 *                  taps like this, and that is how it gets enrolled (§5.2).
 *   "unassigned" — registered, not yet bound to a location.
 *   "suspended" / "retired" — deliberately switched off.
 *   "replay"     — the counter did not advance. A reused tap: a reload, a
 *                  bookmark, a back button, or a cloned chip.
 */
export async function resolveTag(
  rawUid,
  { picc, cmac, counter, ignoreExpiry = false } = {},
) {
  await connect();

  const uid = normaliseUid(rawUid);
  if (!uid) {
    // Why it could not be read, because the three causes need different people
    // to do different things and "that tag could not be read" sent everybody
    // to their manager — including the operator at the bench who had just
    // written the chip wrong and was the only one who could fix it.
    return {
      ok: false,
      status: "invalid",
      message: unreadableUidMessage(rawUid),
    };
  }

  const tag = await ClockTagModel.findOne({ uid }).lean();
  if (!tag) {
    return {
      ok: false,
      status: "unknown",
      uid,
      message: "This tag has not been set up yet.",
    };
  }

  if (tag.status === "retired") {
    return { ok: false, status: "retired", tag, message: "This tag is no longer in use." };
  }
  if (tag.status === "suspended") {
    return {
      ok: false,
      status: "suspended",
      tag,
      message: "This tag has been deactivated — tell your manager.",
    };
  }
  if (tag.status === "unassigned" || !tag.locationId) {
    return {
      ok: false,
      status: "unassigned",
      tag,
      uid,
      message: "This tag is not set up to a location yet.",
    };
  }

  // NTAG 424 DNA. The chip signs the UID and its own counter, so both arrive
  // inside something only the key could have produced.
  //
  // THE COUNTER IS ONLY EVIDENCE ONCE IT IS SIGNED. Reading it off the query
  // string — which is what this did before — meant "replay protection" came
  // down to asking the attacker not to increment a number. Now a replayed URL
  // carries a spent counter, and a URL with a bumped counter fails its CMAC.
  // `tag.signature`, not `tag.keyRef`. A chip can hold a key it is unable to
  // use: the writing tool refuses a URL carrying the picc and cmac
  // placeholders, so the chip gets `?tag=<uid>` and has no way to sign
  // anything. Keyed-therefore-must-sign made such a tag permanently
  // unusable — refused on every tap as unverifiable, with the key sitting
  // right there and no way to say "this chip cannot do that".
  //
  // An unsigned tag is accepted the way a 213 is, and the tap carries that
  // fact onward (`signed`) so what was proven is never guessed at later.
  const mustSign = tag.keyRef && tag.signature !== "none";

  if (mustSign) {
    if (!picc || !cmac) {
      return {
        ok: false,
        status: "unsigned",
        tag,
        message: "This tap could not be verified. Hold the phone to the tag again.",
      };
    }

    let verified;
    try {
      verified = verifySunMessage({
        piccHex: picc,
        cmacHex: cmac,
        key: openTagKey(tag.keyRef),
      });
    } catch {
      // A key that cannot be opened is a configuration problem, not a
      // forgery — but it is still not a tap we can accept.
      return {
        ok: false,
        status: "unverifiable",
        tag,
        message: "This tag is not set up correctly. Tell your manager.",
      };
    }

    if (!verified.ok) {
      return {
        ok: false,
        status: "forged",
        tag,
        message: "This tap could not be verified. Hold the phone to the tag again.",
      };
    }

    // The signature covers a UID. If it is not this tag's, the blob came from
    // somewhere else and was pasted onto this tag's link.
    if (!uid.endsWith(verified.uid) && !verified.uid.endsWith(uid)) {
      return {
        ok: false,
        status: "forged",
        tag,
        message: "This tap could not be verified. Hold the phone to the tag again.",
      };
    }

    if (verified.counter <= (tag.lastCounter || 0)) {
      return {
        ok: false,
        status: "replay",
        tag,
        message: "This tap has already been used. Hold the phone to the tag again.",
      };
    }

    // A verified tap expires too. The counter orders taps against each other,
    // but it only moves when one is SPENT — so a signed tap nobody acted on
    // stays the highest the tag has seen, and stays usable, exactly like the
    // unsigned case below. Signing does not remove the need for a clock.
    const signedNonce = tapNonce({ picc, cmac, counter: verified.counter });
    const signedStale = expiredTap(tag, signedNonce, ignoreExpiry);
    if (signedStale) return signedStale;

    return {
      ok: true,
      status: "active",
      tag,
      counter: verified.counter,
      nonce: signedNonce,
      signed: true,
      counted: true,
    };
  }

  // ───────────────────────────────── AN UNSIGNED TAP, WITH A COUNTER ───────
  //
  // THIS IS WHAT MAKES ONE TAP ONE ACTION.
  //
  // Without a counter the URL a chip sends is a fixed string, so a tap, a page
  // reload, a bookmark and a back button are the same request and nothing here
  // can tell them apart. One tap then bought an open page that could clock in,
  // break and clock out by pressing refresh — the tag proved somebody had been
  // at it ONCE, ever, and every action after that rode on it. No server logic
  // fixes that, because there is nothing in the request to distinguish.
  //
  // A mirrored read counter does fix it, and needs no key: the chip increments
  // it on every read and has no command to wind it back, so the highest value
  // seen is a watermark. At or below it, the tap has already been used.
  //
  // Not signed, so it is a floor and not a ceiling: somebody who reads the URL
  // once can type a higher number. It defeats every ordinary reuse — reload,
  // history, a shared link — and a determined forger still needs the signature
  // path above. Both are better than a static string, which stops nothing.
  const sentCounter = parseTapCounter(counter);
  if (sentCounter !== null) {
    if (sentCounter <= (tag.lastCounter || 0)) {
      return {
        ok: false,
        status: "replay",
        tag,
        message: "This tap has already been used. Hold the phone to the tag again.",
      };
    }
    return {
      ok: true,
      status: "active",
      tag,
      counter: sentCounter,
      signed: false,
      counted: true,
    };
  }

  // ──────────────── AN UNSIGNED TAP WHOSE BLOB IS STILL UNIQUE PER TAP ─────
  //
  // A 424 whose key we do not hold. It mirrors picc and cmac and they change on
  // every tap, so we cannot verify them but we CAN spend them: this exact blob
  // either has been used before or has not. That alone separates a tap from a
  // refresh, which is the whole of what was broken — see tapNonce above.
  const nonce = tapNonce({ picc, cmac });
  if (nonce) {
    if ((tag.usedTapIds || []).includes(nonce)) {
      return {
        ok: false,
        status: "replay",
        tag,
        message: "This tap has already been used. Hold the phone to the tag again.",
      };
    }
    // Spent is not the only way a tap stops being worth something: see
    // TAP_TTL_MS. This is the check that closes a link saved from the question
    // the screen asks once somebody is already clocked in.
    const stale = expiredTap(tag, nonce, ignoreExpiry);
    if (stale) return stale;
    return {
      ok: true,
      status: "active",
      tag,
      counter: null,
      nonce,
      signed: false,
      counted: true,
    };
  }

  // ─────────────────────────── NO STRIPPING YOUR WAY OUT OF IT ─────────────
  //
  // Everything above is reached by what the URL CONTAINS, which means it can be
  // escaped by what the URL leaves out. Delete `&picc_data=…&cmac=…` from a
  // tapped link and there is no blob to spend; delete `&ctr=…` and there is no
  // counter to compare. What is left — `?tag=048A35BA1E1E90` — used to land
  // here and be accepted, reusable for ever. Single-use protection that can be
  // removed by editing the address bar is not protection.
  //
  // So a tag that has ever proved it mirrors something refuses a tap that
  // mirrors nothing. `lastTapCounted` is the record of that, set the first time
  // a counter or a blob was spent.
  //
  // It is a one-way door on purpose: the only innocent way to reach it is to
  // rewrite a chip that used to mirror with one that does not, which is a
  // downgrade somebody should have to do deliberately. If that is genuinely
  // wanted, clear lastTapCounted on the tag — and the refusal lands in
  // refusedTaps with reason "downgraded", so it is visible rather than a tag
  // that mysteriously stopped working.
  if (tag.lastTapCounted === true) {
    return {
      ok: false,
      status: "downgraded",
      tag,
      message:
        "Part of this tap is missing. Hold the phone to the tag again — and " +
        "if it keeps happening, tell your manager.",
    };
  }

  // Nothing to verify, nothing to count, nothing to spend, and nothing better
  // ever seen from this tag: a chip written with no mirror of any kind.
  // Accepted, because refusing it would strand a working tag — but
  // `counted: false` travels with the tap so nothing downstream has to guess.
  // This is the one case where a tap and a page reload really are the same
  // request, and it is why such a tag needs its geofence enforced: it proves a
  // UID was known, which any phone can read off the tag.
  return { ok: true, status: "active", tag, counter: null, signed: false, counted: false };
}

/**
 * Start this tap's clock.
 *
 * Called when a tap is merely LOOKED AT — the tap screen loading, before
 * anybody has pressed anything — which is the whole point: an expiry measured
 * from the action would never fire, because a tap that reaches an action is
 * spent anyway. What needs a clock is the tap that is opened and abandoned.
 *
 * So yes, a read path writes. That is deliberate and it is the only way to
 * timestamp something whose own timestamp we cannot read (the chip's counter is
 * inside a blob we have no key for). The write is one bounded array push.
 *
 * `$ne` in the filter is load-bearing: a nonce already here keeps its ORIGINAL
 * time. Without that, reloading the page would reset the expiry on every load
 * and somebody who left the tab open would have an immortal tap again — the
 * exact hole this exists to close, reopened by a refresh.
 *
 * Best-effort, like every other sighting: failing to start a clock must never
 * fail a clock-in. The cost of a miss is one tap that lives longer than it
 * should, which is where we already were.
 */
export async function noteTapSeen(tagId, nonce) {
  try {
    if (!tagId || !nonce) return;
    await connect();
    await ClockTagModel.updateOne(
      { _id: tagId, "seenTaps.nonce": { $ne: nonce } },
      {
        $push: {
          seenTaps: { $each: [{ nonce, at: new Date() }], $slice: -50 },
        },
      },
    );
  } catch (error) {
    console.log("Could not note tap sighting:", error?.message);
  }
}

/**
 * Note that we saw this tag, and where the tap actually came from.
 *
 * `seenAtLocationId` is where the *evidence* says the person was, which is not
 * necessarily where the tag is bound. A tag bound to Elm Street whose taps
 * arrive from twenty miles away is either cloned or was physically moved
 * without anyone reassigning it — and a tag alone cannot tell you that.
 *
 * Best-effort: a sighting that fails to record must never fail a clock-in.
 */
export async function recordSighting(
  tagId,
  { counter, nonce, employeeId, seenAtLocationId } = {},
) {
  try {
    if (!tagId) return;
    await connect();

    // SPENDING THE TAP. Written first and on its own, because it is the thing
    // that must happen even if everything below fails — an unspent tap is a
    // URL that still works, which is the hole this closes.
    //
    // `$ne` in the filter rather than $addToSet: two taps racing with the same
    // nonce must not both land, and $addToSet would silently accept the second
    // as a no-op success. Bounded to the last fifty, which is weeks of taps for
    // one tag and cannot grow a document without limit.
    if (nonce) {
      await ClockTagModel.updateOne(
        { _id: tagId, usedTapIds: { $ne: nonce } },
        { $push: { usedTapIds: { $each: [nonce], $slice: -50 } } },
      );
    }

    const changes = {
      lastSeenAt: new Date(),
      // Was the last tap usable only once? Stored rather than inferred: a
      // counter in `lastCounter` is only one of the two ways to get there, and
      // the other (spending the chip's per-tap blob, above) leaves lastCounter
      // at zero. Without this the admin screen would warn that a tag cannot
      // tell a tap from a refresh when it demonstrably can.
      lastTapCounted: Boolean(nonce) || Number.isFinite(counter),
      ...(employeeId && isValidObjectId(employeeId)
        ? { lastSeenBy: createObjectId(employeeId) }
        : {}),
      ...(seenAtLocationId ? { lastSeenLocationId: seenAtLocationId } : {}),
    };

    // Guarded: the counter only ever moves forward, so two taps racing cannot
    // wind it back and re-open the replay window.
    if (Number.isFinite(counter)) {
      await ClockTagModel.updateOne(
        { _id: tagId, lastCounter: { $lt: counter } },
        { $set: { ...changes, lastCounter: counter } },
      );
    } else {
      await ClockTagModel.updateOne({ _id: tagId }, { $set: changes });
    }
  } catch (error) {
    console.log("Could not record tag sighting:", error?.message);
  }
}

/**
 * Note that a tap was turned away, and why.
 *
 * Best-effort and never allowed to change the answer: the refusal has already
 * been decided by the time this runs, and a diagnostic that could fail a tap
 * would be worse than no diagnostic.
 *
 * Only called where a tag is known. An unreadable or unregistered UID has no
 * row to attach to — that case goes to the log, with the raw value, because
 * the raw value is the whole evidence.
 */
export async function recordRefusedTap(
  tagId,
  { reason, rawTag, hadSignature, byName } = {},
) {
  try {
    if (!tagId) return;
    await connect();
    await ClockTagModel.updateOne(
      { _id: tagId },
      {
        $push: {
          refusedTaps: {
            $each: [
              {
                at: new Date(),
                reason,
                rawTag: String(rawTag ?? "").slice(0, 200),
                hadSignature: Boolean(hadSignature),
                byName,
              },
            ],
            // Keep the newest five. $slice with a negative count keeps the
            // tail, which is where $push has just added.
            $slice: -5,
          },
        },
      },
    );
  } catch (error) {
    console.log("Could not record a refused tap:", error?.message);
  }
}

/**
 * Remember that an unrecognised tag was tapped, so it can be enrolled.
 *
 * A brand-new tag has to tap *somewhere* before anyone can bind it, and the
 * alternative is transcribing fourteen hex characters off a sticker — which is
 * how the wrong tag ends up bound to the wrong site. Creating the row here in
 * `unassigned` is what puts it in front of an admin with an Assign button.
 *
 * Only a super admin's tap enrols: otherwise any employee tapping any stray
 * tag would fill the list with noise from other companies' hardware.
 */
export async function recordUnknownTag(rawUid, { byName } = {}) {
  try {
    const uid = normaliseUid(rawUid);
    if (!uid) return null;
    await connect();

    const existing = await ClockTagModel.findOne({ uid }).lean();
    if (existing) return existing;

    const created = await ClockTagModel.create({
      uid,
      label: `Unassigned tag ${uid.slice(-6)}`,
      status: "unassigned",
      lastSeenAt: new Date(),
      history: [
        {
          toStatus: "unassigned",
          at: new Date(),
          byName,
          reason: "Seen for the first time",
        },
      ],
    });
    return created.toObject();
  } catch (error) {
    if (error?.code === 11000) return null; // raced; it exists now
    console.log("Could not record an unknown tag:", error?.message);
    return null;
  }
}
