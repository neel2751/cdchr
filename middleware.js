import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

async function checkRoleMiddleware(req) {
  const { pathname } = req.nextUrl;
  const token = req.nextauth?.token;

  // 1. Basic Auth Guard: If no token, withAuth usually handles this,
  // but we add a safety check.
  if (!token) {
    return NextResponse.redirect(new URL("/auth", req.url));
  }

  const userRole = token.role;
  const employeeId = token.id;
  const currentDeviceId = token.deviceId;
  const requires2FA = token.requiresTwoFactor === true;

  // 2. Public / Semi-Public Routes Bypass
  // Allow access to verify page and account setup regardless of 2FA/Role
  if (pathname === "/verify" || pathname.startsWith("/admin/account/")) {
    return NextResponse.next();
  }

  // 3. 2FA Guard
  if (requires2FA && pathname !== "/verify") {
    return NextResponse.redirect(new URL("/verify", req.url));
  }

  // 4. Role-Based Path Access (Prefix Guard)
  const rolePathMap = {
    superAdmin: ["/admin", "/employee", "/hr"],
    admin: ["/admin"],
    user: ["/admin"],
    siteEmployee: ["/employee"],
    reception: ["/hr"],
  };

  const allowedPaths = rolePathMap[userRole] || [];
  const isAuthorizedPath =
    userRole === "superAdmin" ||
    allowedPaths.some((path) => pathname.startsWith(path));

  if (!isAuthorizedPath) {
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  // 5. THE HR/RECEPTION DEVICE LOCK & ACTIVE CHECK
  // We use the internal API but add a secret header to bypass recursive middleware checks if needed,
  // though generally, we just need to ensure NEXTAUTH_URL is correct.
  if (userRole === "reception" && pathname.startsWith("/hr")) {
    try {
      // Use the internal API to check if the user is still active and device is still authorized
      const verifyRes = await fetch(
        `${process.env.NEXTAUTH_URL}/api/reception/verify-device`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, deviceId: currentDeviceId }),
        }
      );

      if (!verifyRes.ok) {
        // This handles DB connection issues or 404s
        return NextResponse.redirect(
          new URL("/unauthorized?action=logout", req.url)
        );
      }

      const { isActive, isAuthorized } = await verifyRes.json();

      if (!isActive || !isAuthorized) {
        // If Admin disabled them or revoked the device while they were logged in
        return NextResponse.redirect(
          new URL("/unauthorized?action=logout", req.url)
        );
      }
    } catch (error) {
      console.error("Middleware fetch error:", error);
      // In production, if the network fails, we usually allow 'next()' to prevent total lockout
      // or redirect to a specific error page.
      return NextResponse.next();
    }
  }

  return NextResponse.next();
}

export default withAuth(checkRoleMiddleware, {
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

export const config = {
  // Protect all main app routes, but EXCLUDE public assets, /auth, and /api
  matcher: ["/admin/:path*", "/employee/:path*", "/hr/:path*", "/verify"],
};
