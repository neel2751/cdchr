import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

/**
 * An NFC tag stuck to a wall somewhere.
 *
 * A tag is not a sticker with a URL on it — it is hardware with a lifecycle.
 * Bought, programmed, mounted, moved when a site closes, prised off, lost,
 * retired. None of that is expressible unless tags are records the app knows
 * about, and without it you cannot revoke a stolen tag, say which tag was
 * tapped, move one to a new location, or notice a clone.
 *
 * For an NTAG 424 DNA chip the registry is not even optional: the replay
 * defence *is* `lastCounter`. See CLOCK_LOCATION_PLAN.md §5.
 */
const clockTagSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },

    // The chip's own UID, read from the tap rather than transcribed off a
    // sticker — typing fourteen hex characters by hand is how the wrong tag
    // ends up bound to the wrong site.
    uid: { type: String, required: true, trim: true, uppercase: true },

    chipType: {
      type: String,
      enum: ["ntag213", "ntag424"],
      default: "ntag213",
    },

    // Where this tag currently is. Null while it is in a drawer.
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClockLocation",
      default: null,
    },

    status: {
      type: String,
      enum: ["unassigned", "active", "suspended", "retired"],
      default: "unassigned",
    },

    // --- NTAG 424 DNA only -------------------------------------------------
    //
    // A reference to the AES key, never the key. Phase C ships NTAG213, where
    // both stay unset; they exist so the 424 path is a fill-in rather than a
    // migration.
    keyRef: String,
    // Only ever increases. A tap at or below the stored value is a replay and
    // is refused. This single number is the whole security property of the
    // 424 variant.
    lastCounter: { type: Number, default: 0 },

    /**
     * Does this chip actually sign its taps?
     *
     * "required" is a 424 doing what a 424 is for: every tap arrives with the
     * encrypted counter and a CMAC over it, and one that does not is refused.
     *
     * "none" is a 424 whose SDM mirroring could not be programmed, which is a
     * real situation and not a hypothetical: the writing tool in use will not
     * accept a URL carrying the picc and cmac placeholders, so the chip can
     * only be written with `?tag=<uid>` and has nothing to sign with. Holding a
     * key it cannot use, it behaves exactly like an NTAG213.
     *
     * IT IS A SEPARATE FIELD FROM keyRef ON PURPOSE. Inferring "must sign" from
     * "has a key" is what left a tag unusable: the key was sealed during
     * provisioning, the chip could not be told to mirror, and every tap was
     * refused as unverifiable with no way to say "this chip cannot do that".
     * Deleting the key to make it work would have been the worst answer — it
     * throws away the ability to turn signing on later, and it hides the
     * downgrade from the people relying on the tag.
     *
     * WHAT "none" COSTS, stated so nobody has to work it out: a UID can be read
     * off a tag by any phone, so an unsigned tap proves the UID was known, not
     * that anybody was there. That is the same ground a QR code or a 213 stands
     * on, and it is why a location that matters should have its geofence or
     * network check set to enforce rather than shadow (lib/locationPolicy.js).
     */
    signature: {
      type: String,
      enum: ["required", "none"],
      default: "required",
    },

    // --- what we have seen -------------------------------------------------
    lastSeenAt: Date,
    // Where the tap actually came from, per the geofence — not where the tag
    // says it is. A tag bound to Elm Street whose taps arrive twenty miles
    // away is either cloned or was moved without anyone reassigning it, and
    // a tag alone cannot tell you that. A tag plus a position can.
    lastSeenLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClockLocation",
      default: null,
    },
    lastSeenBy: mongoose.Schema.Types.ObjectId,

    /**
     * Could the last tap be used only once?
     *
     * True when the chip mirrored something that changes per tap — a read
     * counter, or (on a 424 whose key we do not hold) the encrypted blob we
     * spend without being able to verify. False means the chip sends one fixed
     * URL, so a reload, a bookmark or a forwarded link is indistinguishable
     * from somebody standing at the tag.
     *
     * Stored rather than worked out from `lastCounter`, because spending a blob
     * leaves lastCounter at zero — and a screen that inferred it would warn
     * that a tag cannot tell a tap from a refresh when it demonstrably can.
     */
    lastTapCounted: Boolean,

    /**
     * The last few taps that were REFUSED, and why.
     *
     * A successful tap moves lastSeenAt; a refused one used to leave nothing at
     * all. So "this tag does not work" was unanswerable: nobody could tell a
     * tap that never arrived (wrong URL on the chip, dead host, a writer that
     * mangled the link) from one that arrived and was turned away (no
     * signature, replayed counter, tag not placed). Those have completely
     * different fixes and the same symptom, and working out which cost days.
     *
     * Bounded to the last five, because this is a diagnostic and not a log: the
     * question it answers is always "what happened the last time somebody
     * tried", and an unbounded array on a hot path is how a document grows
     * until it cannot be written.
     *
     * The raw `tag` value is kept exactly as it arrived, because the whole
     * point is to see what the chip actually sent — a placeholder written
     * verbatim, a shifted UID, a watermark injected by a trial-version writer.
     * Normalising it first would discard the evidence.
     */
    refusedTaps: [
      {
        at: { type: Date, default: Date.now },
        reason: String, // the `status` from resolveTag
        rawTag: String, // the tag parameter as sent
        hadSignature: Boolean,
        byName: String,
        _id: false,
      },
    ],

    /**
     * Taps already spent, as short hashes. The last fifty.
     *
     * WHY A TAP HAS TO BE SPENT AT ALL. Without it the URL a chip sends is a
     * fixed string, so a tap and a page reload are the same request: one touch
     * of the tag bought an open page that could clock in, take a break and
     * clock out by pressing refresh. The tag then proved somebody had been at
     * it once, ever, and every action afterwards rode on that — which is not
     * what anyone is buying a tag for.
     *
     * `lastCounter` handles it where a counter arrives, by refusing anything at
     * or below the highest seen. This list handles the case that has no usable
     * counter but still changes per tap: a 424 whose key we do not hold mirrors
     * picc and cmac, and those cover the chip's read counter, so each tap
     * produces a different blob. We cannot decrypt it to prove the chip made
     * it — but we do not have to, to see that this exact blob was used already.
     *
     * Bounded on purpose. It answers "has this tap been used", not "every tap
     * ever", and fifty is weeks of taps on one tag while keeping the document a
     * fixed size on a hot write path.
     */
    usedTapIds: { type: [String], default: undefined },

    assignedBy: mongoose.Schema.Types.ObjectId,
    assignedByName: String,
    assignedAt: Date,

    // Every move, kept. Reassignment is not retroactive — records written
    // before a move keep the location they were written with — so the history
    // is the only place the move itself is visible.
    history: [
      {
        fromLocationId: mongoose.Schema.Types.ObjectId,
        toLocationId: mongoose.Schema.Types.ObjectId,
        fromStatus: String,
        toStatus: String,
        at: { type: Date, default: Date.now },
        byName: String,
        reason: String,
        _id: false,
      },
    ],
  },
  { timestamps: true },
);

// One identity per tag, per company. Two tags claiming one UID would make
// "which tag was tapped" unanswerable, which is most of the point of having a
// registry at all.
clockTagSchema.index({ tenantId: 1, uid: 1 }, { unique: true });
clockTagSchema.index({ tenantId: 1, locationId: 1 });
clockTagSchema.index({ tenantId: 1, status: 1 });

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(clockTagSchema, "ClockTag");

const ClockTagModel =
  mongoose.models.ClockTag || mongoose.model("ClockTag", clockTagSchema);

export default ClockTagModel;
