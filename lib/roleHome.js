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

/**
 * Where to land after switching company, given where you were.
 *
 * Staying put is the point — switching company while looking at Media
 * Management should show the other company's media, not throw you back to the
 * dashboard. But a detail page names one record, and that record does not exist
 * in the company you just moved to, so those trim back to their listing rather
 * than opening a dead page.
 *
 * @param {string} pathname current path
 * @param {string} role     the role held in the company being switched to
 */
export function switchDestination(pathname, role) {
  const home = homePathForRole(role);
  if (!pathname || !pathname.startsWith("/admin")) return home;

  const segments = pathname.split("/").filter(Boolean);

  // Trim trailing record identifiers. Ids reach the URL raw (24-char hex) and
  // encrypted by lib/algo (a long opaque string), so both shapes are trimmed.
  while (segments.length > 2) {
    const last = segments[segments.length - 1];
    const looksLikeId =
      /^[0-9a-f]{24}$/i.test(last) ||
      /^[A-Za-z0-9%+/=_-]{24,}$/.test(last);
    if (!looksLikeId) break;
    segments.pop();
  }

  const trimmed = `/${segments.join("/")}`;
  // A bare "/admin" is not a page.
  return trimmed === "/admin" ? home : trimmed;
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
