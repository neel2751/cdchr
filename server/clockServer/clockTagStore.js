/**
 * Reading and recognising NFC tags.
 *
 * NOT a "use server" module — `recordSighting` writes, and none of this should
 * be callable from a browser by name.
 */
import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import ClockTagModel from "@/models/clockTagModel";
import { openTagKey } from "@/lib/tagKeys";
import { verifySunMessage } from "@/lib/sun";

/** A chip UID as we store it: hex, uppercase, no separators. */
export function normaliseUid(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
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
 *   "replay"     — the counter did not advance. A cloned chip.
 */
export async function resolveTag(rawUid, { picc, cmac } = {}) {
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

    return { ok: true, status: "active", tag, counter: verified.counter, signed: true };
  }

  // Nothing to verify: a plain NTAG213, or a 424 that could not be told to
  // mirror. Which is exactly why an unsigned tag needs a geofence beside it —
  // it proves the UID was known, and a UID can be read off the tag by any
  // phone. `signed: false` travels with the tap so the record says so.
  return { ok: true, status: "active", tag, counter: null, signed: false };
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
  { counter, employeeId, seenAtLocationId } = {},
) {
  try {
    if (!tagId) return;
    await connect();

    const changes = {
      lastSeenAt: new Date(),
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
