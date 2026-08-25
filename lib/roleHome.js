/**
 * Where a role lands after signing in or clearing a 2FA gate.
 *
 * Kept in one place so the post-2FA redirects agree with the route-prefix guard
 * in proxy.js — sending a role somewhere it is not allowed only costs an extra
 * redirect, but it shows the user a flash of the wrong page first.
 */
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
