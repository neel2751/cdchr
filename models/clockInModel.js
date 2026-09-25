import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";
import { CLOCK_STATUSES } from "@/lib/clockStatus";
const Schema = mongoose.Schema;

const clockInSchema = new Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "employeeType",
    },
    employeeType: {
      type: String,
      required: true,
      enum: ["Employee", "OfficeEmployee"],
    },
    locationType: {
      type: String,
      enum: ["site", "office"],
      default: "site",
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectSite",
    },
    // Which physical place this happened at. Replaces the old convention where
    // `siteId: null` meant "the office" — singular, for a company that might
    // have several. See models/clockLocationModel.js.
    //
    // Nullable only until scripts/backfill-clock-locations.mjs has run; it is
    // written on every new record.
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClockLocation",
      default: null,
    },
    clockIn: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/, // optional: validate "HH:mm" format
    },
    clockOut: {
      type: String,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
    breaks: [
      {
        breakIn: {
          type: String,
          match: /^([01]\d|2[0-3]):([0-5]\d)$/,
        },
        breakOut: {
          type: String,
          match: /^([01]\d|2[0-3]):([0-5]\d)$/,
        },
        _id: false,
      },
    ],
    overtime: {
      type: Number,
      default: 0,
    },
    clockInLocation: String,
    clockBy: String,

    // How we know this person was where they say they were.
    //
    // Recorded on every clock-in, judged on none of them yet — Phase B of
    // CLOCK_LOCATION_PLAN.md. `checks` holds what each of the location's
    // configured methods *would* have decided, so a radius can be chosen from
    // what actually happens rather than guessed and then discovered to be
    // wrong by someone locked out of their own job at 7am.
    clockInEvidence: {
      method: String,
      coords: {
        lat: Number,
        lng: Number,
        accuracyMetres: Number,
      },
      ip: String,
      deviceId: String,
      tagId: String,
      tagCounter: Number,
      tokenJti: String,
      checks: [
        {
          method: String,
          mode: String,
          verdict: String, // pass | fail | unknown
          detail: String,
          distanceMetres: Number,
          accuracyMetres: Number,
          _id: false,
        },
      ],
      // What an enforcing location would have decided. A measurement while
      // every method is in shadow.
      wouldAllow: Boolean,
      recordedAt: Date,
    },
    // Derived, never supplied: lib/clockStatus.js recomputes it from
    // clockIn/clockOut/breaks on every write. The enum is here so a stray
    // writer fails loudly rather than adding a sixth vocabulary.
    status: {
      type: String,
      enum: [...CLOCK_STATUSES, null],
      default: null,
    },
    date: {
      type: Date,
      required: true,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    // Set by the nightly job when a shift was never clocked out of. The
    // clockOut is deliberately left empty rather than guessed — a made-up
    // finish time goes straight into someone's pay and nobody checks it — so
    // this is what turns the gap into something a human is asked to fix.
    // Where the shift ENDED, when that is not where it started.
    //
    // An office worker clocks in on the reception QR code, drives to a site
    // and taps its tag on the way home. The hours belong to the record the
    // shift began on; this says where it finished, so a report showing an
    // office shift closed from Elm Street reads as a fact rather than a bug.
    // Null for the ordinary case of arriving and leaving from one place.
    clockOutLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClockLocation",
      default: null,
    },
    // The evidence for that closing tap, kept separately from
    // clockInEvidence so neither overwrites the other.
    clockOutEvidence: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    needsReview: {
      type: Boolean,
      default: false,
    },
    reviewReason: String,
    autoClosedAt: Date,

    // Recorded on a phone with no signal and replayed when it came back.
    //
    // `offlineCapturedAt` is the phone's own clock, and a phone's clock is
    // whatever its owner sets it to. That is the whole problem with offline
    // capture: every other time in this system is derived on the server
    // precisely so it cannot be chosen, and a queued entry inverts that.
    //
    // So the drift between the claimed time and the moment it actually
    // reached us is stored rather than discarded, every such record is flagged
    // for review, and the flag says what was claimed and when it arrived.
    // Nobody is accused of anything; a human just confirms it.
    offlineCapturedAt: Date,
    offlineSyncedAt: Date,
    offlineDriftMinutes: Number,
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

clockInSchema.index({ employeeId: 1, date: -1, siteId: 1, isDeleted: 1 });
clockInSchema.index({ date: -1, siteId: 1, isDeleted: 1 });

// One live record per employee, per day, per site.
//
// Nothing enforced this, and every write path was a read followed by a
// separate write: two QR scans a second apart both saw "no record yet" and
// both created one. The duplicate was invisible in the admin table — the live
// view takes the most recent match and stops — so it showed up only as hours
// that did not add up.
//
// Partial on isDeleted so a soft-deleted record does not block a fresh one for
// the same day. An office record has no siteId; a missing field indexes as
// null, which is what makes "one office record per day" fall out of the same
// index.
//
// RUN scripts/dedupe-clock-records.mjs BEFORE deploying this. Mongo refuses to
// build a unique index over existing duplicates, and the failure surfaces only
// as a line in the server log — the app keeps running with no index.
// One live record per employee, per day, per PLACE.
//
// This keys on locationId, not siteId. Keying on siteId meant every office
// shared one null, so a company with two offices could not record an employee
// at both on the same day — the second write collided with the first.
//
// EXISTING INSTALLS: scripts/backfill-clock-locations.mjs fills in locationId,
// drops the old siteId index and builds this one, in that order. Building this
// first would collide every not-yet-backfilled record (all null locationId)
// against every other for the same employee and day.
clockInSchema.index(
  { tenantId: 1, employeeId: 1, date: 1, locationId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

clockInSchema.index({ tenantId: 1, locationId: 1, date: -1 });

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(clockInSchema, "ClockRecord");

const ClockRecordModel =
  mongoose.models.ClockRecord || mongoose.model("ClockRecord", clockInSchema);
export default ClockRecordModel;
