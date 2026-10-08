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
