import mongoose from "mongoose";
import { FEATURE_KEYS } from "@/data/features";

/**
 * A company is the tenant boundary for the platform.
 *
 * The model name ("Companie") and collection ("companies") are unchanged so the
 * existing `officeEmployeeModel.company` reference and every current query keep
 * working. Everything added for multi-tenancy is optional with a safe default,
 * so documents written before this expansion stay valid and behave exactly as
 * they did.
 *
 * Two flags describe whether a tenant is usable and they mean different things:
 *   - `isActive` / `delete` are the original admin toggles (see companyServer).
 *   - `status` is the tenant lifecycle used by the platform dashboard.
 * Read them through `isTenantUsable()` rather than checking one in isolation.
 */

// A hostname the tenant is reachable on. A tenant may hold several (apex, www,
// and an `hr.` subdomain are commonly all wanted), but only one is primary —
// that is the one used to build absolute URLs in emails.
const tenantDomainSchema = new mongoose.Schema(
  {
    // Always stored normalized: lowercase, no port, no trailing dot.
    host: { type: String, required: true },
    isPrimary: { type: Boolean, default: false },
    // A domain only routes traffic once its DNS TXT record has been seen.
    verified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verifiedAt: { type: Date },
    sslStatus: {
      type: String,
      enum: ["pending", "issued", "failed"],
      default: "pending",
    },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Everything the UI and outbound email need to look like the tenant's own
// product. Empty values fall back to the platform defaults at render time.
const brandingSchema = new mongoose.Schema(
  {
    appName: { type: String },
    logoUrl: { type: String },
    logoDarkUrl: { type: String },
    faviconUrl: { type: String },
    loginBackgroundUrl: { type: String },
    // CSS colour values written straight into the `:root` overrides, so any
    // form Tailwind understands (oklch, hex, hsl) is accepted.
    primaryColor: { type: String },
    accentColor: { type: String },
    radius: { type: String },
    supportEmail: { type: String },
    // Shown on customer-facing output — the expense invoice is the first thing
    // to use it. Free text on purpose: international formats, extensions and
    // "0800 …" spacing are all legitimate, and normalising them would be wrong
    // more often than right.
    supportPhone: { type: String },
    emailFromName: { type: String },
    emailFooterHtml: { type: String },
  },
  { _id: false }
);

// Plan gating. Every flag defaults to true so enabling multi-tenancy never
// takes a module away from the existing business.
//
// Built from data/features.js rather than listed here, so a module added to the
// registry is storable without a second edit — a key the UI could switch but the
// schema would silently drop was the failure this replaces.
const featuresSchema = new mongoose.Schema(
  Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, { type: Boolean, default: true }])
  ),
  { _id: false }
);

// null means "no limit"; the platform dashboard sets these per plan.
const limitsSchema = new mongoose.Schema(
  {
    maxEmployees: { type: Number, default: null },
    maxStorageBytes: { type: Number, default: null },
  },
  { _id: false }
);

const localeSchema = new mongoose.Schema(
  {
    timezone: { type: String, default: "Europe/London" },
    dateFormat: { type: String, default: "dd/MM/yyyy" },
    currency: { type: String, default: "GBP" },
    weekStartsOn: { type: Number, default: 1 }, // Monday
    country: { type: String, default: "United Kingdom" },
  },
  { _id: false }
);

const billingSchema = new mongoose.Schema(
  {
    plan: { type: String, default: "standard" },
    seats: { type: Number, default: null },
    renewsAt: { type: Date },
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },

    // Identifies the tenant on the shared platform domain
    // (`<slug>.<PLATFORM_ROOT_DOMAIN>`) and is the stable handle used in the
    // platform dashboard. Optional so existing documents remain valid until the
    // seed script assigns one.
    slug: {
      type: String,
      lowercase: true,
      trim: true,
      match: [
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
        "Slug may contain only lowercase letters, numbers and hyphens",
      ],
    },

    status: {
      type: String,
      enum: ["active", "trial", "suspended", "cancelled"],
      default: "active",
    },

    domains: { type: [tenantDomainSchema], default: [] },
    branding: { type: brandingSchema, default: () => ({}) },
    features: { type: featuresSchema, default: () => ({}) },
    limits: { type: limitsSchema, default: () => ({}) },
    locale: { type: localeSchema, default: () => ({}) },
    billing: { type: billingSchema, default: () => ({}) },

    // Legacy admin toggles. Still authoritative — see isTenantUsable().
    isActive: { type: Boolean, default: true },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Both indexes are deliberately partial/sparse: documents written before this
// expansion carry neither a slug nor any domains, so they produce no index
// entries and the unique constraints can be added to a live collection safely.
companySchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: "string" } } }
);

// Deliberately NOT unique. Several companies may hold the same hostname as a
// pending claim; ownership is decided by proving DNS control, not by adding it
// first. A unique index here would let a typo or a squatter lock out the company
// that actually controls the domain.
//
// The real rule — at most one *verified* claim per hostname — cannot be an index
// across array elements, because a partialFilterExpression applies to the whole
// document: a company with one verified and one pending domain would index both.
// It is enforced in tenantOps.verifyDomain() inside a transaction instead.
companySchema.index({ "domains.host": 1 });

const CompanyModel =
  mongoose.models.Companie || mongoose.model("Companie", companySchema);
export default CompanyModel;
