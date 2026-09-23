import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";

/**
 * A place people clock in at.
 *
 * There is no separate concept of "the office". An office and a site are the
 * same kind of thing — somewhere work happens — and `kind` below is a label for
 * grouping and reporting, not a structural difference. Nothing branches on it.
 *
 * That distinction is what this model exists to remove. A clock record used to
 * say `locationType: "office"` with `siteId: null`, so *every* office in a
 * company collapsed into one null: two offices were the same place, with no way
 * to report them separately, filter between them, or tell an employee at one
 * that they had clocked in at the other. Giving offices real identity is the
 * prerequisite for everything else — a per-location clock-in rule cannot be
 * attached to a location that does not exist.
 *
 * See CLOCK_LOCATION_PLAN.md §3.
 */
const clockLocationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Label only. Do not branch on this.
    kind: {
      type: String,
      enum: ["office", "site"],
      default: "office",
    },
    // Set when this location *is* an existing ProjectSite, so the roster and
    // the clock-in point stay one thing rather than two that drift.
    projectSiteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectSite",
      default: null,
    },

    // Where historical office records land, and the fallback when a scan
    // arrives with no site. Exactly one per company — enforced by the partial
    // unique index below.
    isDefault: {
      type: Boolean,
      default: false,
    },

    // --- how this place proves someone is at it (phases B onwards) ---
    //
    // Unset for now. Phase A creates the locations; it changes no policy, and
    // an empty `methods` means "whatever the app did before".
    geofence: {
      lat: Number,
      lng: Number,
      radiusMetres: { type: Number, default: 150 },
    },
    // CIDR ranges, e.g. "203.0.113.0/24". Not yet consulted.
    networks: [String],
    methods: [
      {
        type: {
          type: String,
          enum: ["deviceQr", "network", "geofence", "nfc", "rollCall"],
        },
        mode: {
          type: String,
          enum: ["off", "shadow", "enforce"],
          default: "off",
        },
        _id: false,
      },
    ],
    // false = any satisfied method admits them.
    requireAll: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Two OFFICES in one company may not share a name — an office name is typed by
// a person, and two identically-named ones are indistinguishable in a picker.
//
// Sites are deliberately excluded. A site location's name is owned by the site
// and follows it, and real site lists do contain repeats: a company with two
// jobs both called "Park Road New" is not a data error, and a constraint that
// rejects it stops their attendance being migrated at all. The ambiguity is
// the site list's, and this is not the place to fix it.
clockLocationSchema.index(
  { tenantId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true, projectSiteId: null },
  },
);

// One default per company. A second would make "which office do untagged
// records belong to" ambiguous again, which is the bug this model removes.
clockLocationSchema.index(
  { tenantId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

clockLocationSchema.index({ tenantId: 1, projectSiteId: 1 });

// Tenant scoping (lib/tenantPlugin.js). Must run before the model is
// compiled, or the hooks and tenantId field are not attached.
applyTenantScope(clockLocationSchema, "ClockLocation");

const ClockLocationModel =
  mongoose.models.ClockLocation ||
  mongoose.model("ClockLocation", clockLocationSchema);

export default ClockLocationModel;
