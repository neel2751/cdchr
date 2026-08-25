import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { MENU, COMMONMENUITEMS, DERIVED_ACCESS } from "./data/menu";
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
const RESOLVE_TIMEOUT_MS = 2_500;
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
  const token = req?.nextauth?.token;
  const employeeId = token?.id;
  const userRole = token?.role;
  const requires2FA = token?.requiresTwoFactor === true;
  const mustSetup2FA = token?.mustSetup2FA === true;

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

  // A platform admin has no place inside a tenant's app.
  if (userRole === "platformAdmin") {
    return NextResponse.redirect(new URL("/platform", req.url));
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

export default withAuth(checkRoleMiddleware, {
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

// Exclude auth routes and public paths from the middleware
export const config = {
  matcher: [
    "/admin/:path*",
    "/employee/:path*",
    "/hr/:path*",
    "/platform/:path*",
  ],
};
