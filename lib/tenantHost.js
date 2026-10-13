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
 * Is `<slug>.<root>` actually being served?
 *
 * PLATFORM_ROOT_DOMAIN only says what a tenant's address WOULD be. It says
 * nothing about whether anything answers there, and until now everything
 * assumed it did: emails, password-reset links, announcement links, the
 * welcome link a new employee gets, and the redirect in proxy.js that sends a
 * tenant user off the platform host. On a deployment where those subdomains do
 * not resolve, every one of those was a link to nowhere.
 *
 * It is two separate pieces of work to make them resolve, and the second is
 * the one that bites: a wildcard DNS record is a minute, but `*.<root>` where
 * <root> is itself a subdomain needs a certificate for a wildcard two labels
 * deep, which the free universal certificates do not issue. So "the variable
 * is set" cannot mean "the host works", and this is the separate switch that
 * says it does.
 *
 * DEFAULTS TO OFF, and the asymmetry is the reason. Off when they do work
 * costs a link to the shared host, which serves the same app and signs the
 * same people in. On when they do not costs every link in every email.
 */
export function tenantSubdomainsLive() {
  return process.env.PLATFORM_TENANT_SUBDOMAINS === "live";
}

/**
 * The platform's own absolute origin — the one address that is always ours.
 *
 * Where a link goes when a tenant has no address of its own: the shared host
 * serves the same app, signs the same people in, and is where /signup and
 * /auth already live.
 */
export function platformOrigin() {
  const apex = platformApexHost();
  if (apex) return originForHost(apex);
  // A single-domain deployment, which is every deployment before the platform
  // host existed. That one domain is where everything already is.
  return String(process.env.NEXT_PUBLIC_WEB_URL || "").replace(/\/+$/, "");
}

/**
 * THE one basis for an absolute link to a tenant's workspace.
 *
 * In order: a domain the customer has verified, then their `<slug>.<root>`
 * address but only if those are actually being served, then ours. Each step
 * down is a host we are less sure the customer owns and more sure resolves.
 *
 * Everything that puts a URL in an email resolves it through here, so there is
 * one answer to "why does the link say that" rather than one per sender.
 *
 * @param {{primaryHost?: string, slug?: string}} tenant
 */
export function originForTenant({ primaryHost, slug } = {}) {
  if (primaryHost) return originForHost(primaryHost);

  if (slug && tenantSubdomainsLive()) {
    const root = platformRootDomain();
    if (root) return originForHost(`${slug}.${root}`);
  }

  return platformOrigin();
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
