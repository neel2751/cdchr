import { NextResponse } from "next/server";
import { resolveTenantByHost } from "@/server/tenantServer/tenantServer";

// Mongoose cannot run on the Edge runtime, and `proxy.js` does. So the proxy
// asks this route to do the lookup, exactly as it already does for
// /api/account/status and /api/role. The result is cached on both sides, so in
// practice this runs about once per hostname per minute.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a hostname to a tenant summary.
 *
 * The response carries only what `toTenantSummary()` produces — name, slug,
 * status and branding — all of which is rendered on the tenant's own public
 * login page anyway, so no authentication is required here. Anything sensitive
 * must never be added to that shape.
 */
export async function GET(req) {
  try {
    const host =
      req.nextUrl.searchParams.get("host") || req.headers.get("host") || "";

    const resolution = await resolveTenantByHost(host);

    return NextResponse.json(resolution, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.log("tenant/resolve error:", error?.message);
    // Fail open — the caller treats "unknown" as "carry on as before".
    return NextResponse.json(
      { type: "unknown", tenant: null },
      { status: 200 }
    );
  }
}
