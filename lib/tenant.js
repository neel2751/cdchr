/**
 * Tenant document helpers.
 *
 * Pure functions over a tenant (company) document — no database access, so this
 * is safe to import from anywhere. The lookups live in
 * `server/tenantServer/tenantServer.js`; hostname parsing lives in
 * `lib/tenantHost.js`.
 */

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
  return (
    verified.find((d) => d.isPrimary)?.host || verified[0]?.host || ""
  );
}

/**
 * Branding with platform defaults filled in, so callers never have to write
 * `tenant?.branding?.appName || "HR Management"` at every use site.
 */
export function resolveBranding(tenant) {
  const b = tenant?.branding || {};
  return {
    appName: b.appName || "HR Management",
    logoUrl: b.logoUrl || "/images/Interiorlogo.svg",
    logoDarkUrl: b.logoDarkUrl || b.logoUrl || "/images/Interiorlogo.svg",
    faviconUrl: b.faviconUrl || "/favicon.ico",
    loginBackgroundUrl: b.loginBackgroundUrl || "",
    primaryColor: b.primaryColor || "",
    accentColor: b.accentColor || "",
    radius: b.radius || "",
    supportEmail: b.supportEmail || "",
    emailFromName: b.emailFromName || b.appName || "HR Management",
    emailFooterHtml: b.emailFooterHtml || "",
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
