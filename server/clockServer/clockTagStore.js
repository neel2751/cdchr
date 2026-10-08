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
  return cleaned;
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
    return { ok: false, status: "invalid", message: "That tag could not be read." };
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
  if (tag.keyRef) {
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

    return { ok: true, status: "active", tag, counter: verified.counter };
  }

  // A plain NTAG213 sends nothing to verify, which is exactly why a 213 needs
  // a geofence beside it — the tag proves you have been near it once, and no
  // more than that.
  return { ok: true, status: "active", tag, counter: null };
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
