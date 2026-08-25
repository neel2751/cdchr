/**
 * Where a role lands after signing in or clearing a 2FA gate.
 *
 * Kept in one place so the post-2FA redirects agree with the route-prefix guard
 * in proxy.js — sending a role somewhere it is not allowed only costs an extra
 * redirect, but it shows the user a flash of the wrong page first.
 */
/**
 * Reduce a callback URL to a same-origin path.
 *
 * Two reasons this exists. Open-redirect protection is the obvious one. The
 * other is multi-domain: Auth.js builds absolute URLs from the request URL, and
 * behind a proxy that is the internal address, not the tenant's domain — so a
 * login on acme.com can come back pointing at the wrong host. Navigating to a
 * relative path sidesteps the question entirely.
 *
 * @param {string} value      the untrusted callback URL
 * @param {string} origin     the current origin (window.location.origin)
 * @param {string} [fallback] used when `value` is missing or points elsewhere
 */
export function toSafeRelativePath(value, origin, fallback = "/") {
  if (!value || typeof value !== "string") return fallback;
  // "//evil.com" is protocol-relative and would leave the site.
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/")) return value;

  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : fallback;
  } catch {
    return fallback;
  }
}

export function homePathForRole(role) {
  switch (role) {
    case "platformAdmin":
      return "/platform";
    case "siteEmployee":
      return "/employee";
    case "reception":
      return "/hr";
    default:
      return "/admin/dashboard";
  }
}
