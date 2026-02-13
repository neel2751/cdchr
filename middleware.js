import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { MENU, COMMONMENUITEMS } from "./data/menu";

async function checkRoleMiddleware(req) {
  const requestedPath = req?.nextUrl?.pathname;
  const token = req?.nextauth?.token;
  const employeeId = token?.id;
  const userRole = token?.role;
  const requires2FA = token?.requiresTwoFactor === true;

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

  // we have to allow all route for /admin/account/*
  const isAdminAccountRoute = requestedPath.startsWith("/admin/account/");

  if (requestedPath === "/verify" || isAdminAccountRoute) {
    return NextResponse.next();
  }

  // If 2FA is required, redirect to verification page
  if (requires2FA && requestedPath !== "/verify") {
    return NextResponse.redirect(new URL("/verify", req.url));
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

  const isAccessible = roleData?.permissions?.some((path) =>
    requestedPath.startsWith(path)
  );

  if (!isAccessible || !roleData?.permissions.includes(menuItem?.path)) {
    return NextResponse.redirect(new URL(dashboardPath, req.url));
  }

  return NextResponse.next();
}

export default withAuth(checkRoleMiddleware, {
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

// Exclude auth routes and public paths from the middleware
export const config = {
  matcher: ["/admin/:path*", "/employee/:path*", "/hr/:path*"], // Only match admin routes
};
