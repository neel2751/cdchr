import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { MENU, COMMONMENUITEMS, DERIVED_ACCESS } from "./data/menu";

const ROLE_HOME = {
  admin: "/admin/dashboard",
  user: "/admin/dashboard",
  superAdmin: "/admin/dashboard",
  siteEmployee: "/employee",
  reception: "/hr",
};

/** Where to send a signed-in user who has no outstanding login step. */
function homePathFor(role) {
  return ROLE_HOME[role] || "/admin/dashboard";
}

async function checkRoleMiddleware(req) {
  const requestedPath = req?.nextUrl?.pathname;
  const token = req?.nextauth?.token;
  const employeeId = token?.id;
  const userRole = token?.role;
  const requires2FA = token?.requiresTwoFactor === true;
  const mustSetup2FA = token?.mustSetup2FA === true;

  const hostname = req?.headers?.get("host") || "";

  const customBrandDomain = "form.cdcproperty.management";
  if (hostname === customBrandDomain) {
    // allow only the visitor path
    if (requestedPath.startsWith("/visitor")) {
      return NextResponse.next();
    }

    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  // If no token is found, redirect to login
  if (!userRole || !employeeId) {
    return NextResponse.redirect(new URL("/api/auth/signin", req.url));
  }

  // /verify and /setup-2fa are steps *inside* the login flow, not pages in their
  // own right. withAuth has already rejected anyone without a token by this
  // point; here we make sure a signed-in user only lands on the step that is
  // actually outstanding, so a verified user cannot sit on the code prompt and
  // an unenrolled one cannot skip past it.
  if (requestedPath === "/verify") {
    if (mustSetup2FA) {
      return NextResponse.redirect(new URL("/setup-2fa", req.url));
    }
    if (!requires2FA) {
      return NextResponse.redirect(new URL(homePathFor(userRole), req.url));
    }
    return NextResponse.next();
  }

  if (requestedPath === "/setup-2fa") {
    if (requires2FA) {
      return NextResponse.redirect(new URL("/verify", req.url));
    }
    if (!mustSetup2FA) {
      return NextResponse.redirect(new URL(homePathFor(userRole), req.url));
    }
    return NextResponse.next();
  }

  // If 2FA is required, redirect to verification page
  if (requires2FA) {
    return NextResponse.redirect(new URL("/verify", req.url));
  }

  // Privileged users who have not yet enrolled in 2FA are forced to set it up
  // before they can access any protected page.
  if (mustSetup2FA) {
    return NextResponse.redirect(new URL("/setup-2fa", req.url));
  }

  // we have to allow all route for /admin/account/*
  // Deliberately checked *after* the 2FA gate above: account pages are ordinary
  // protected pages, so an unverified session must not reach them either.
  const isAdminAccountRoute = requestedPath.startsWith("/admin/account/");
  if (isAdminAccountRoute) {
    return NextResponse.next();
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
        return NextResponse.next();
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
      return NextResponse.next();
    }
  }

  const rolePathMap = {
    admin: "/admin",
    user: "/admin",
    siteEmployee: "/employee",
    reception: "/hr",
    superAdmin: "*",
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
  if (isCommonMenuItem) return NextResponse.next();

  // ✅ Bypass permission checks for `siteEmployee`
  if (
    userRole === "siteEmployee" ||
    userRole === "superAdmin" ||
    userRole === "reception"
  ) {
    return NextResponse.next();
  }

  // Combine menu items
  const allMenuItems = [...MENU, ...COMMONMENUITEMS];
  const menuItem = allMenuItems.find(
    (item) =>
      requestedPath === item?.path || requestedPath.startsWith(`${item?.path}/`)
  );

  // Fetch permissions for admin/superadmin users
  const res = await fetch(`${process.env.NEXTAUTH_URL}/api/role`, {
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

  return NextResponse.next();
}

export default withAuth(checkRoleMiddleware, {
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

// Exclude auth routes and public paths from the middleware.
// /verify and /setup-2fa are matched so they require a session: they are login
// steps, and without this they were publicly reachable.
export const config = {
  matcher: [
    "/admin/:path*",
    "/employee/:path*",
    "/hr/:path*",
    "/verify",
    "/setup-2fa",
  ],
};
