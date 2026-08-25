/**
 * Hostname helpers for tenant resolution.
 *
 * Deliberately dependency-free and side-effect-free: `proxy.js` runs on the
 * Edge runtime and cannot import Mongoose, so anything it needs to reason about
 * hosts lives here. The database-backed lookup lives in
 * `server/tenantServer/tenantServer.js`.
 */

// Subdomains of the platform root that can never belong to a tenant.
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "platform",
  "mail",
  "smtp",
  "static",
  "assets",
  "cdn",
  "status",
  "docs",
  "support",
  "help",
  "billing",
  "auth",
  "login",
]);

// Headers a client must never be able to set. The proxy strips these from every
// inbound request before it adds its own copies, so a crafted
// `x-tenant-id: <someone else's tenant>` header cannot reach application code.
export const TENANT_HEADERS = [
  "x-tenant-id",
  "x-tenant-slug",
  "x-tenant-host",
  "x-tenant-status",
];

/**
 * Normalize a raw `Host` header into a comparable hostname: lowercase, no
 * port, no trailing dot, no surrounding whitespace. IPv6 literals keep their
 * brackets so `[::1]:3000` does not lose its address.
 *
 * @param {string | null | undefined} host
 * @returns {string} normalized host, or "" when nothing usable was supplied
 */
export function normalizeHost(host) {
  if (!host || typeof host !== "string") return "";
  let value = host.trim().toLowerCase();
  if (!value) return "";

  if (value.startsWith("[")) {
    // IPv6: "[::1]:3000" -> "[::1]"
    const close = value.indexOf("]");
    if (close !== -1) return value.slice(0, close + 1);
    return value;
  }

  const colon = value.indexOf(":");
  if (colon !== -1) value = value.slice(0, colon);
  if (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

/** Drop a leading "www." so apex and www resolve to the same tenant. */
export function stripWww(host) {
  return host?.startsWith("www.") ? host.slice(4) : host;
}

/**
 * The candidate hosts to try, in priority order, for a given request host.
 * Trying the www-stripped form as a fallback means a tenant that registered
 * `acme.com` also works on `www.acme.com` without registering both.
 */
export function hostCandidates(host) {
  const normalized = normalizeHost(host);
  if (!normalized) return [];
  const bare = stripWww(normalized);
  return bare === normalized ? [normalized] : [normalized, bare];
}

/** The host the platform dashboard is served on, or "" when not configured. */
export function platformApexHost() {
  return normalizeHost(process.env.PLATFORM_APEX_HOST);
}

/** The shared root domain that gives every tenant a `<slug>.<root>` address. */
export function platformRootDomain() {
  return normalizeHost(process.env.PLATFORM_ROOT_DOMAIN);
}

/**
 * True when this request is for the platform's own dashboard host.
 *
 * When PLATFORM_APEX_HOST is not configured this returns false, and the
 * `/platform` routes fall back to role-only protection (see proxy.js). That
 * keeps existing single-domain deployments working untouched.
 */
export function isPlatformHost(host) {
  const apex = platformApexHost();
  if (!apex) return false;
  const normalized = normalizeHost(host);
  return normalized === apex || stripWww(normalized) === stripWww(apex);
}

/**
 * Extract a tenant slug from a `<slug>.<PLATFORM_ROOT_DOMAIN>` hostname.
 * Returns "" for the root itself, reserved names, deeper nesting, or when no
 * root domain is configured.
 *
 * @param {string} host
 * @returns {string} the slug, or "" when the host is not a tenant subdomain
 */
export function tenantSlugFromHost(host) {
  const root = platformRootDomain();
  if (!root) return "";

  const normalized = normalizeHost(host);
  if (!normalized || normalized === root) return "";
  if (!normalized.endsWith(`.${root}`)) return "";

  const label = normalized.slice(0, -(root.length + 1));
  // Only a single label is a tenant: "acme" yes, "staging.acme" no.
  if (!label || label.includes(".")) return "";
  if (RESERVED_SUBDOMAINS.has(label)) return "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return "";

  return label;
}

/** Build the absolute origin for a host, https everywhere except localhost. */
export function originForHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized) return "";
  const isLocal =
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost");
  return `${isLocal ? "http" : "https"}://${host}`;
}
