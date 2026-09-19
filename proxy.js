import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { MENU, COMMONMENUITEMS, DERIVED_ACCESS } from "./data/menu";
import { isPathAllowed } from "./lib/tenantPlan";
import { homePathForRole } from "./lib/roleHome";
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

  // --- Login steps ----------------------------------------------------------
  // /verify and /setup-2fa are steps *inside* the login flow, not pages in their
  // own right. The check above has already rejected anyone without a session, so
  // all that is left is making sure a signed-in user lands on the step that is
  // actually outstanding: a verified user must not sit on a code prompt they
  // cannot satisfy, and an unenrolled one must not skip past it.
  //
  // Deliberately ahead of every host and role rule below. Both paths have to be
  // reachable by every role, on any hostname — a platform admin sent to /verify
  // by the block below, on a configured PLATFORM_APEX_HOST, would otherwise be
  // bounced back to /platform by the platform-host rule and redirect forever.
  // Both branches below test `requires2FA` FIRST, in the same order as the
  // fall-through gate near the end of this function. That ordering is what makes
  // the pair loop-free: were /verify to defer to enrolment while /setup-2fa
  // defers to verification, a session with both flags set would bounce between
  // the two forever. The signIn callback in auth.js makes the flags mutually
  // exclusive today, so that state should not arise — but a redirect loop locks
  // every user out of the product, which is too expensive to leave resting on an
  // invariant declared in another file.
  // /change-password belongs with them: it is another step inside signing in,
  // and it lives outside /admin. Left to fall through to the role-prefix guard
  // below, a `user` whose allowed prefix is /admin was redirected here by the
  // gate and then bounced straight to /unauthorized — a forced password change
  // that locked the person out instead of letting them fix it.
  if (requestedPath === "/change-password") {
    if (requires2FA) return NextResponse.redirect(new URL("/verify", req.url));
    if (mustSetup2FA) {
      return NextResponse.redirect(new URL("/setup-2fa", req.url));
    }
    // Whether a change is genuinely outstanding is decided by the page itself,
    // which reads the database — the cookie cannot be trusted in either
    // direction here (see the note further down).
    return pass();
  }

  if (requestedPath === "/verify" || requestedPath === "/setup-2fa") {
    const home = homePathForRole(userRole);

    if (requestedPath === "/verify") {
      if (requires2FA) return pass();
      // Nothing to verify, but never enrolled: send them to enrol.
      if (mustSetup2FA) {
        return NextResponse.redirect(new URL("/setup-2fa", req.url));
      }
      return NextResponse.redirect(new URL(home, req.url));
    }

    // /setup-2fa
    if (requires2FA) return NextResponse.redirect(new URL("/verify", req.url));
    if (mustSetup2FA) return pass();
    return NextResponse.redirect(new URL(home, req.url));
  }

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

  // If 2FA is required, redirect to verification page.
  // The path comparisons that used to sit here are gone: /verify and /setup-2fa
  // return from the login-step block above and never reach this far.
  if (requires2FA) {
    return NextResponse.redirect(new URL("/verify", req.url));
  }

  // Privileged users who have not yet enrolled in 2FA are forced to set it up
  // before they can access any protected page.
  if (mustSetup2FA) {
    return NextResponse.redirect(new URL("/setup-2fa", req.url));
  }

  // NOTE: the forced-password-change gate is NOT here, and not read from the
  // session either. `mustChangePassword` reaches the cookie when the token is
  // minted, so a cookie issued before the reset does not carry it — and one
  // issued before the *change* still carries it afterwards, which would trap
  // somebody on the change screen having already changed it. The gate lives
  // with the account-status check below, where the value is read live.
  // The blanket `pass()` for /admin/account/* was removed here. It sat above
  // the account-status check below, so the account area was the one place a
  // deactivated employee — or one whose sessions had been revoked by "sign out
  // of all devices" — could still reach and still change their password. The
  // self-service area that replaced it, /admin/me, is an ordinary page: it is
  // listed in COMMONMENUITEMS so every role may open it, and it goes through
  // every gate below like everything else.

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
        const { isActive, sessionsValidFrom, mustChangePassword: mustChange } =
          await statusRes.json();
        if (isActive === false) {
          return NextResponse.redirect(
            new URL("/unauthorized?action=logout", req.url)
          );
        }

        // "Sign out of all devices". Sessions are JWTs, so there is nothing to
        // delete — a session is ended by refusing any token minted before the
        // reset. This has to happen here rather than in the jwt callback:
        // during ordinary navigation the callback that runs is the edge copy in
        // auth.config.js, which cannot reach the database, so a cookie issued
        // before the reset would otherwise keep working indefinitely.
        const issuedAt = user?.issuedAt;
        if (
          sessionsValidFrom &&
          issuedAt &&
          issuedAt * 1000 < sessionsValidFrom
        ) {
          return NextResponse.redirect(
            new URL("/unauthorized?action=logout", req.url)
          );
        }

        // Read live rather than from the cookie: the token was minted before
        // the admin set this, so it is the one thing that cannot know about it.
        //
        // The exemption for /admin/account/* that used to be on this line is
        // gone with the bypass above. It existed so somebody could change a
        // forced password from the account page; /change-password is that
        // screen now, and it is deliberately not a hop into the account area —
        // see the note at the top of app/change-password/page.jsx.
        if (mustChange) {
          return NextResponse.redirect(new URL("/change-password", req.url));
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

// Exclude auth routes and public paths from the middleware.
//
// /verify and /setup-2fa are matched so that they require a session: they are
// login steps, and while they went unmatched both were reachable by anyone, with
// no session at all.
export const config = {
  matcher: [
    "/admin/:path*",
    "/employee/:path*",
    "/hr/:path*",
    "/platform/:path*",
    "/verify",
    "/setup-2fa",
    "/change-password",
  ],
};
