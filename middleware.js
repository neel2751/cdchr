import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { MENU, COMMONMENUITEMS } from "./data/menu";

async function checkRoleMiddleware(req) {
  const userRole = req?.nextauth?.token?.role;
  const requestedPath = req?.nextUrl?.pathname;
  const employeeId = req?.nextauth?.token?.id;

  // If no token is found, redirect to login
  if (!userRole || !employeeId) {
    return NextResponse.redirect(new URL("/api/auth/signin", req.url));
  }

  const rolePathMap = {
    admin: "/admin",
    user: "/admin",
    siteEmployee: "/employee",
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
  if (userRole === "siteEmployee" || userRole === "superAdmin") {
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
  matcher: ["/admin/:path*", "/employee/:path*"], // Only match admin routes
};
