import mongoose from "mongoose";
import { FEATURE_KEYS } from "@/data/features";
import {
  DEFAULT_INDUSTRY,
  INDUSTRY_TEMPLATES,
  MANAGER_RULE_KEYS,
  TERM_KEYS,
} from "@/data/terminology";
import { FIELD_BLOCK_KEYS } from "@/data/fieldBlocks";

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
    // Office staff. Current people only — leavers do not count.
    maxEmployees: { type: Number, default: null },
    // Students / site employees — the people at a company's sites or
    // classes. A separate cap because they are priced separately.
    maxWorkers: { type: Number, default: null },
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

// What the company calls sites, site employees and the rest — see
// data/terminology.js. Only the words it has changed from its industry's are
// stored; an absent key means "the template's word". Built from TERM_KEYS so a
// word added there is storable without a second edit, as featuresSchema is.
const termsSchema = new mongoose.Schema(
  Object.fromEntries(TERM_KEYS.map((key) => [key, { type: String, trim: true }])),
  { _id: false }
);

// Which parts of the site employee form the company uses — see
// data/fieldBlocks.js. An absent key means "as the industry template says",
// like `terms`.
const fieldBlocksSchema = new mongoose.Schema(
  Object.fromEntries(FIELD_BLOCK_KEYS.map((key) => [key, { type: Boolean }])),
  { _id: false }
);

// What a place manager may do — see resolveManagerRules in
// data/terminology.js. Absent means "as the industry template says".
const managerRulesSchema = new mongoose.Schema(
  Object.fromEntries(MANAGER_RULE_KEYS.map((key) => [key, { type: Boolean }])),
  { _id: false }
);

// The setup checklist (server/tenantServer/setupProgressServer.js). Most steps
// are worked out from the company's data — a step is done when there are
// sites, staff, an email account. `marks` records what only a person can say:
// "done" for a step that is a review rather than a record, "skipped" for an
// optional one they do not need. `hidden` is the owner putting it away.
const setupProgressSchema = new mongoose.Schema(
  {
    marks: { type: Map, of: { type: String, enum: ["done", "skipped"] } },
    hidden: { type: Boolean, default: false },
  },
  { _id: false }
);

// A lock the platform admin put on by hand — for an unpaid bill, say. Wins
// over the trial dates. See lib/tenantAccess.js.
const accessLockSchema = new mongoose.Schema(
  {
    level: { type: String, enum: ["readOnly", "locked"] },
    // Shown to the company, so it knows what to do.
    message: { type: String, trim: true, maxlength: 500 },
    at: { type: Date },
    by: { type: String },
    // Put on by the billing run for an overdue bill, not by a person — and
    // so lifted by it too, once the bill is paid. A lock without this is a
    // person's decision and the run never touches it.
    auto: { type: Boolean },
  },
  { _id: false }
);

const billingSchema = new mongoose.Schema(
  {
    plan: { type: String, default: "standard" },
    seats: { type: Number, default: null },
    renewsAt: { type: Date },
    // When a self-serve trial stops being free. Only read while status is
    // "trial"; see lib/tenantAccess.js for what follows it.
    trialEndsAt: { type: Date },
    lock: { type: accessLockSchema, default: undefined },
    // Trial reminder emails already sent, one per stage, so a daily job never
    // sends the same one twice. See server/tenantServer/trialReminderJob.js.
    trialReminders: { type: [String], default: undefined },
    // The offer code the trial came from (models/trialOfferModel.js), if any.
    trialOffer: { type: String },

    // The agreed price — set when the platform admin applies a package
    // (server/billingServer/pricingServer.js). `plan` above holds the
    // package key. Arithmetic: lib/pricing.js.
    cycle: { type: String, enum: ["monthly", "yearly"] },
    // A deal discount agreed with this customer, off the monthly total.
    discountPercent: { type: Number, min: 0, max: 100 },
    // Modules bought on top of the package.
    addOns: { type: [String], default: undefined },
    // A customer's second or later company: its package fee is discounted.
    // Until billing accounts (Step 4) group companies, the console says so.
    extraCompany: { type: Boolean },
    // The quote when the plan was applied, for the record and for the
    // console to show. The invoice (Step 5) works from live usage.
    quotedMonthlyPence: { type: Number },
    quotedPeriodPence: { type: Number },
    planAppliedAt: { type: Date },
    planAppliedBy: { type: String },
    // Over the package's allowance: "charge" for extras (the default, also
    // when absent) or "block" — stop there. Chosen by the company's super
    // admin on Plan & billing. See OVERAGE_MODES in lib/pricing.js.
    overageMode: { type: String, enum: ["charge", "block"] },
    // The customer this company is billed under (models/billingAccountModel.js).
    // Absent: billed on its own.
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "BillingAccount" },
    // Billed up to here (subscriptionBilling.js). A paying company is billed
    // in advance: the next bill is made on this date, for the next month —
    // or year, on yearly billing.
    paidThrough: { type: Date },
  },
  { _id: false }
);

// How a self-serve company signed up, kept to spot the same business taking a
// second free trial (server/billingServer/trialAbuse.js). `flags` are reasons
// to look, not verdicts: the platform admin decides.
const signupFlagSchema = new mongoose.Schema(
  {
    code: { type: String },
    detail: { type: String },
    companyId: { type: mongoose.Schema.Types.ObjectId },
    companyName: { type: String },
  },
  { _id: false }
);

const signupSchema = new mongoose.Schema(
  {
    email: { type: String, lowercase: true, trim: true },
    emailDomain: { type: String, lowercase: true, trim: true },
    // The last ten digits, so 07700 900123 and +44 7700 900123 match.
    phoneKey: { type: String },
    ip: { type: String },
    nameKey: { type: String },
    at: { type: Date },
    flags: { type: [signupFlagSchema], default: undefined },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
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
    // Which INDUSTRY_TEMPLATES entry supplies the words. Construction is what
    // every company was before there was a choice.
    industry: {
      type: String,
      enum: INDUSTRY_TEMPLATES.map((t) => t.key),
      default: DEFAULT_INDUSTRY,
    },
    terms: { type: termsSchema, default: () => ({}) },
    fieldBlocks: { type: fieldBlocksSchema, default: () => ({}) },
    managerRules: { type: managerRulesSchema, default: () => ({}) },
    setupProgress: { type: setupProgressSchema, default: () => ({}) },
    billing: { type: billingSchema, default: () => ({}) },
    signup: { type: signupSchema, default: undefined },

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

// Finding a customer's companies, and earlier sign-ups that look like this one.
companySchema.index({ "billing.accountId": 1 }, { sparse: true });
companySchema.index({ "signup.phoneKey": 1 }, { sparse: true });

const CompanyModel =
  mongoose.models.Companie || mongoose.model("Companie", companySchema);
export default CompanyModel;
