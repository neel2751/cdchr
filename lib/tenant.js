/**
 * Tenant document helpers.
 *
 * Pure functions over a tenant (company) document — no database access, so this
 * is safe to import from anywhere. The lookups live in
 * `server/tenantServer/tenantServer.js`; hostname parsing lives in
 * `lib/tenantHost.js`.
 */

/**
 * What the product is called when nothing else names it.
 *
 * The fallback for every white-label value, and the platform's own name on the
 * pages that belong to no tenant — signup, sign-in, the 2FA authenticator entry
 * and any email sent before a company exists. It was written out as a literal
 * in a dozen files, so renaming the product meant finding all of them; one
 * constant means the next rename is this line.
 */
export const PLATFORM_APP_NAME = "StaffMain";

/** Lifecycle states in which a tenant may serve traffic. */
const USABLE_STATUSES = new Set(["active", "trial"]);

/**
 * Whether a tenant may serve traffic right now.
 *
 * Checks all three signals together: the two legacy admin toggles that the
 * company screen has always written (`isActive`, `delete`) and the newer
 * lifecycle `status`. A tenant created before `status` existed has none, which
 * is treated as "active" so nothing changes for existing records.
 */
export function isTenantUsable(tenant) {
  if (!tenant) return false;
  if (tenant.delete === true) return false;
  if (tenant.isActive === false) return false;
  return USABLE_STATUSES.has(tenant.status || "active");
}

/** The domain used to build absolute URLs (emails, links) for this tenant. */
export function primaryDomain(tenant) {
  const domains = tenant?.domains || [];
  const verified = domains.filter((d) => d?.verified && d?.host);
  return verified.find((d) => d.isPrimary)?.host || verified[0]?.host || "";
}

/**
 * Branding with platform defaults filled in, so callers never have to write
 * `tenant?.branding?.appName || PLATFORM_APP_NAME` at every use site.
 */
export function resolveBranding(tenant) {
  const b = tenant?.branding || {};
  return {
    appName: b.appName || PLATFORM_APP_NAME,
    logoUrl: b.logoUrl || "/images/Interiorlogo.svg",
    logoDarkUrl: b.logoDarkUrl || b.logoUrl || "/images/Interiorlogo.svg",
    faviconUrl: b.faviconUrl || "/favicon.ico",
    loginBackgroundUrl: b.loginBackgroundUrl || "",
    primaryColor: b.primaryColor || "",
    accentColor: b.accentColor || "",
    radius: b.radius || "",
    supportEmail: b.supportEmail || "",
    supportPhone: b.supportPhone || "",
    emailFromName: b.emailFromName || b.appName || PLATFORM_APP_NAME,
    emailFooterHtml: b.emailFooterHtml || "",
  };
}

/**
 * Regional settings with defaults filled in, the counterpart to
 * resolveBranding().
 *
 * Kept separate because it is not branding: a company can be white-labelled
 * without changing currency, and can change currency without rebranding. The
 * schema has stored these since the company model was expanded and nothing read
 * them — every amount in the app was formatted as GBP in en-GB regardless.
 */
export function resolveLocale(tenant) {
  const l = tenant?.locale || {};
  return {
    timezone: l.timezone || "Europe/London",
    dateFormat: l.dateFormat || "dd/MM/yyyy",
    currency: l.currency || "GBP",
    weekStartsOn: l.weekStartsOn ?? 1,
    country: l.country || "United Kingdom",
  };
}

/**
 * The minimal, serializable shape passed to middleware and client components.
 * Never includes anything that is not safe to expose to a browser.
 */
export function toTenantSummary(tenant) {
  if (!tenant) return null;
  return {
    id: String(tenant._id),
    name: tenant.name,
    slug: tenant.slug || "",
    status: tenant.status || "active",
    usable: isTenantUsable(tenant),
    primaryHost: primaryDomain(tenant),
    branding: resolveBranding(tenant),
    features: tenant.features || {},
  };
}
