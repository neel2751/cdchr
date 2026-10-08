import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

/**
 * A single-use code displayed at a clock-in point.
 *
 * The QR an employee scans is the whole proof that they were standing in front
 * of a particular reception screen at a particular moment. Until now that proof
 * was never checked: the server action verified the JWT's signature and then
 * threw the payload away, taking the site and the action from whatever the
 * client sent alongside it. Any unexpired token signed with the app secret
 * worked for any site.
 *
 * Tracking codes as rows rather than as a Map in server.mjs is what lets the
 * server action redeem one at all — the socket server's memory is not reachable
 * from a server action, so "mark this code used" had nowhere to be written and
 * a code stayed replayable for its whole lifetime.
 *
 * Rows are disposable. `expiresAt` carries a TTL index, so Mongo clears them
 * without a job; redemption checks the date itself rather than trusting the
 * sweeper, which only runs about once a minute.
 */
const clockTokenSchema = new mongoose.Schema(
  {
    // The JWT's `jti`. Unique so a replay cannot create a second row, and it
    // is the only thing the signed token needs to carry besides the site.
    jti: {
      type: String,
      required: true,
      unique: true,
    },
    // Where this code was displayed.
    //
    // `locationId` is authoritative. It used to be `siteId` alone, which was
    // null for an office — and since every office shared that null, every
    // office scan resolved to the default office whichever building it
    // actually happened in. A company with two offices could add the second
    // one and never record a single clock-in at it.
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClockLocation",
      default: null,
    },
    // Kept alongside so the record can still name its ProjectSite. Derived
    // from the location, not supplied.
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectSite",
      default: null,
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
    },
    issuedByName: String,
    expiresAt: {
      type: Date,
      required: true,
    },
    // Set when redeemed. The redemption is a conditional update on this being
    // null, so it is also the lock: one code, one scan.
    usedAt: {
      type: Date,
      default: null,
    },
    usedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true },
);

// Mongo removes a row once expiresAt passes. Codes live for seconds, so
// without this the collection would grow forever for no reason.
clockTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(clockTokenSchema, "ClockToken");

const ClockTokenModel =
  mongoose.models.ClockToken || mongoose.model("ClockToken", clockTokenSchema);
export default ClockTokenModel;
