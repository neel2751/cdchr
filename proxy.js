import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { MENU, COMMONMENUITEMS, DERIVED_ACCESS } from "./data/menu";
import { isPathAllowed } from "./lib/tenantPlan";
import {
  TENANT_HEADERS,
  isPlatformHost,
  normalizeHost,
  platformApexHost,
} from "./lib/tenantHost";

// Host -> resolution cache. Middleware module scope survives between requests
// within an isolate, so a hostname is resolved at most once a minute rather
// than on every request. The route handler caches the database lookup too.
const RESOLVE_TTL_MS = 60_000;
// A failed lookup is remembered briefly too, so a database outage cannot turn
// into one failing round-trip per request.
const RESOLVE_FAIL_TTL_MS = 5_000;
// Tenant resolution sits in front of every matched request, so it is never
// allowed to hold one up. If it cannot answer in this long, the request goes
// through unresolved.
// Must exceed the resolver's own ceiling, or the proxy gives up while a
// perfectly good lookup is still running.
const RESOLVE_TIMEOUT_MS = 6_000;
const resolveCache = new Map();
const UNKNOWN = { type: "unknown", tenant: null };

/**
 * Ask the app which tenant owns this hostname.
 *
 * Always fails open: if the lookup errors or times out the request proceeds
 * exactly as it did before multi-tenancy existed. Nothing in this phase reads
 * the result except the /platform gate.
 */
async function resolveTenant(req) {
  const host = normalizeHost(req.headers.get("host"));
  if (!host) return UNKNOWN;
  if (isPlatformHost(host)) return { type: "platform", tenant: null };

  const cached = resolveCache.get(host);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const remember = (value, ttl) => {
    resolveCache.set(host, { value, expiresAt: Date.now() + ttl });
    return value;
  };

  try {
    // req.nextUrl.origin, not NEXTAUTH_URL — with several tenant domains in
    // play, the request's own origin is the only correct one.
    const res = await fetch(
      `${req.nextUrl.origin}/api/tenant/resolve?host=${encodeURIComponent(host)}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      }
    );
    if (!res.ok) return remember(UNKNOWN, RESOLVE_FAIL_TTL_MS);

    return remember(await res.json(), RESOLVE_TTL_MS);
  } catch (err) {
    // Includes the abort on timeout. Fail open — an unresolved tenant leaves
    // the request behaving exactly as it did before multi-tenancy.
    console.log("Tenant resolve error:", err?.message);
    return remember(UNKNOWN, RESOLVE_FAIL_TTL_MS);
  }
}

/**
 * Rebuild the request headers with trustworthy tenant hints.
 *
 * Every `x-tenant-*` header is stripped first, so a client that sends
 * `x-tenant-id: <another tenant>` cannot have it reach application code. These
 * headers are a convenience only — server code that needs the tenant resolves
 * it from the Host header itself (see server/tenantServer/getRequestTenant).
 */
function withTenantHeaders(req, resolution) {
  const headers = new Headers(req.headers);
  for (const name of TENANT_HEADERS) headers.delete(name);

  headers.set("x-tenant-host", normalizeHost(req.headers.get("host")));
  if (resolution?.type === "tenant" && resolution.tenant) {
    headers.set("x-tenant-id", resolution.tenant.id);
    headers.set("x-tenant-status", resolution.tenant.status || "active");
    if (resolution.tenant.slug) {
      headers.set("x-tenant-slug", resolution.tenant.slug);
    }
  }
  return headers;
}

async function checkRoleMiddleware(req) {
  const requestedPath = req?.nextUrl?.pathname;
  // Auth.js v5 exposes the resolved session on the request, where v4 put the
  // raw JWT on `req.nextauth.token`. The fields below all come through the
  // session callback in auth.config.js.
  const user = req?.auth?.user;
  const employeeId = user?._id;
  const userRole = user?.role;
  const requires2FA = user?.requiresTwoFactor === true;
  const mustSetup2FA = user?.mustSetup2FA === true;

  // v4's withAuth redirected unauthenticated requests before this ran; v5 hands
  // every matched request over, so the check is explicit.
  if (!req?.auth) {
    const signInUrl = new URL("/api/auth/signin", req.url);
    signInUrl.searchParams.set(
      "callbackUrl",
      `${requestedPath}${req.nextUrl.search || ""}`
    );
    return NextResponse.redirect(signInUrl);
  }

  const hostname = req?.headers?.get("host") || "";

  // Resolve the tenant for this hostname and strip any spoofed tenant headers.
  // `pass()` replaces a bare NextResponse.next() so the cleaned headers travel
  // with every request that is allowed through.
  const resolution = await resolveTenant(req);
  const tenantHeaders = withTenantHeaders(req, resolution);
  const pass = () => NextResponse.next({ request: { headers: tenantHeaders } });

  // --- Platform (provider) dashboard ---------------------------------------
  // Served only to platformAdmin, and only on PLATFORM_APEX_HOST when one is
  // configured. With no apex configured the role check alone applies, so
  // existing single-domain deployments keep working.
  const apexHost = platformApexHost();
  const onPlatformHost = isPlatformHost(hostname);
  const isPlatformPath = requestedPath.startsWith("/platform");

  if (isPlatformPath) {
    if (userRole !== "platformAdmin") {
      return NextResponse.redirect(new URL("/unauthorized", req.url));
    }
    if (apexHost && !onPlatformHost) {
      return NextResponse.redirect(new URL("/unauthorized", req.url));
    }
    // Platform admins are privileged, so the same 2FA gates apply. Repeated
    // here because this branch returns before the shared checks below.
    if (requires2FA) {
      return NextResponse.redirect(new URL("/verify", req.url));
    }
    if (mustSetup2FA) {
      return NextResponse.redirect(new URL("/setup-2fa", req.url));
    }
    return pass();
  }

  // The platform host serves the platform dashboard and nothing else.
  if (onPlatformHost) {
    return NextResponse.redirect(new URL("/platform", req.url));
  }

  // A platform admin has no place inside a tenant's app — unless a support
  // visit is in force, which is exactly a permission to look at one. Every
  // query made during it is read-only (lib/tenantPlugin.js).
  if (userRole === "platformAdmin") {
    const visit = user?.impersonation;
    const live = visit?.expiresAt && new Date(visit.expiresAt) > new Date();
    if (!live) {
      return NextResponse.redirect(new URL("/platform", req.url));
    }
    return pass();
  }

  const customBrandDomain = "form.cdcproperty.management";
  if (hostname === customBrandDomain) {
    // allow only the visitor path
    if (requestedPath.startsWith("/visitor")) {
      return pass();
    }

    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  // If no token is found, redirect to login
  if (!userRole || !employeeId) {
    return NextResponse.redirect(new URL("/api/auth/signin", req.url));
  }

  // we have to allow all route for /admin/account/*
  const isAdminAccountRoute = requestedPath.startsWith("/admin/account/");

  if (requestedPath === "/verify" || isAdminAccountRoute) {
    return pass();
  }

  // If 2FA is required, redirect to verification page
  if (requires2FA && requestedPath !== "/verify") {
    return NextResponse.redirect(new URL("/verify", req.url));
  }

  // Privileged users who have not yet enrolled in 2FA are forced to set it up
  // before they can access any protected page.
  if (mustSetup2FA && requestedPath !== "/setup-2fa") {
    return NextResponse.redirect(new URL("/setup-2fa", req.url));
  }

  // Terminate live sessions for deactivated / locked-down office accounts.
  // Runs before the super-admin bypass so even a compromised super admin can
  // be cut off. Fails open so a transient error never locks everyone out.
  if (
    userRole === "admin" ||
    userRole === "user" ||
    userRole === "superAdmin"
  ) {
    try {
      const baseUrl =
        process.env.NEXTAUTH_URL || `http://${req.headers.get("host")}`;
      const statusRes = await fetch(`${baseUrl}/api/account/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      if (statusRes.ok) {
        const { isActive } = await statusRes.json();
        if (isActive === false) {
          return NextResponse.redirect(
            new URL("/unauthorized?action=logout", req.url)
          );
        }
      }
    } catch (err) {
      console.log("Account status check error:", err);
    }
  }

  // we have to check for only hr routes here becuase account is active or not
  if (userRole === "reception" && requestedPath.startsWith("/hr")) {
    const currentDeviceId = token?.deviceId;

    try {
      // Use the absolute URL for production
      const baseUrl =
        process.env.NEXTAUTH_URL || `http://${req.headers.get("host")}`;

      const response = await fetch(`${baseUrl}/api/reception/verify-device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, deviceId: currentDeviceId }),
      });

      if (!response.ok) {
        // we have to do next
        return pass();
        // return NextResponse.redirect(
        //   new URL("/unauthorized?action=logout", req.url)
        // );
      }

      const { isActive } = await response.json();
      if (!isActive) {
        return NextResponse.redirect(
          new URL("/unauthorized?action=logout", req.url)
        );
      }
    } catch (err) {
      console.log("Middleware Fetch Error:", err);
      // If the fetch itself fails (network error), don't lock them out
      // unless you want high-security mode.
      return pass();
    }
  }

  // --- Plan gating ---------------------------------------------------------
  // A module the company's plan excludes is removed from the sidebar
  // (selectServer.getEmployeeMenu), but that only hides the door. This closes
  // it for anyone who types the URL, super admins included — which is why it
  // sits above the role checks below rather than among them.
  //
  // Two conditions before it will deny, because the flags here come from the
  // *hostname*, and data decisions belong to the session (see lib/tenantContext).
  // The hostname must have resolved to a real tenant, and that tenant must be
  // the one the session belongs to. Anything else — an unresolved host, a
  // single-domain deployment, a mismatch — falls through untouched, exactly as
  // the rest of this file fails open.
  //
  // Not a substitute for the checks inside the actions themselves: this guards
  // navigation only. See requireExpenseAccess in server/expenseServer.
  if (
    resolution?.type === "tenant" &&
    resolution.tenant?.id &&
    user?.tenantId &&
    String(resolution.tenant.id) === String(user.tenantId) &&
    !isPathAllowed(resolution.tenant.features, requestedPath)
  ) {
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  const rolePathMap = {
    admin: "/admin",
    user: "/admin",
    siteEmployee: "/employee",
    reception: "/hr",
    superAdmin: "*",
    platformAdmin: "/platform",
  };

  // Restrict path access by role (route prefix guard)
  if (userRole !== "superAdmin") {
    const allowedPrefix = rolePathMap[userRole];
    if (!requestedPath.startsWith(allowedPrefix)) {
      return NextResponse.redirect(new URL("/unauthorized", req.url));
    }
  }

  // Allow unrestricted access to common menu items
  const isCommonMenuItem = COMMONMENUITEMS.some(
    (item) =>
      requestedPath === item?.path || requestedPath.startsWith(`${item?.path}/`)
  );
  if (isCommonMenuItem) return pass();

  // ✅ Bypass permission checks for `siteEmployee`
  if (
    userRole === "siteEmployee" ||
    userRole === "superAdmin" ||
    userRole === "reception"
  ) {
    return pass();
  }

  // Combine menu items
  const allMenuItems = [...MENU, ...COMMONMENUITEMS];
  const menuItem = allMenuItems.find(
    (item) =>
      requestedPath === item?.path || requestedPath.startsWith(`${item?.path}/`)
  );

  // Fetch permissions for admin/superadmin users. Uses the request's own origin
  // rather than NEXTAUTH_URL, which holds a single hostname and would point at
  // the wrong domain once tenants are served on their own.
  const res = await fetch(`${req.nextUrl.origin}/api/role`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ employeeId }),
  });

  if (!res.ok) {
    if (res.status === 404) {
      return NextResponse.redirect(new URL("/unauthorized", req.url));
    }
    throw new Error("Failed to fetch role data");
  }

  const roleData = await res.json();

  const dashboardPath =
    MENU.find((item) => item.isDashboard)?.path || "/admin/dashboard";

  if (!menuItem) {
    return NextResponse.redirect(new URL(dashboardPath, req.url));
  }

  if (!roleData?.permissions || roleData?.permissions.length === 0) {
    return NextResponse.redirect(new URL(dashboardPath, req.url));
  }

  // Derived pages (e.g. "previous employees") inherit the permission of their
  // parent page, so an admin who can access the active list can also access the
  // matching "previous" list without a separate permission grant.
  const requiredPath = DERIVED_ACCESS[menuItem?.path] || menuItem?.path;

  if (!roleData?.permissions?.includes(requiredPath)) {
    return NextResponse.redirect(new URL(dashboardPath, req.url));
  }

  return pass();
}

// Built from the Edge-safe half of the config only — the Credentials provider
// and the signIn callback both need Mongoose, which cannot run here.
const { auth } = NextAuth(authConfig);

export default auth(checkRoleMiddleware);

// Exclude auth routes and public paths from the middleware
export const config = {
  matcher: [
    "/admin/:path*",
    "/employee/:path*",
    "/hr/:path*",
    "/platform/:path*",
  ],
};
