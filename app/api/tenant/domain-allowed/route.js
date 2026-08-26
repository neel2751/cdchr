import { NextResponse } from "next/server";
import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import { isTenantUsable } from "@/lib/tenant";
import { normalizeHost, stripWww, isPlatformHost } from "@/lib/tenantHost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Caddy's on-demand TLS gate.
 *
 * Caddy calls this before obtaining a certificate for a hostname it has never
 * seen. 200 means "go ahead", anything else means "refuse the connection".
 *
 * This endpoint is not optional. With on-demand TLS and no ask endpoint, anyone
 * who points a DNS record at this server triggers a certificate request for
 * their hostname — which burns Let's Encrypt rate limits (50 certs per
 * registered domain per week, 5 duplicates per week) and lets a stranger use
 * the deployment as a certificate mill. Answering only for hostnames a company
 * has *verified* keeps issuance tied to proven DNS control.
 *
 * Caddyfile:
 *   on_demand_tls {
 *     ask http://127.0.0.1:3000/api/tenant/domain-allowed
 *   }
 *
 * Caddy passes the hostname as ?domain=
 */
export async function GET(req) {
  const raw = req.nextUrl.searchParams.get("domain") || "";
  const host = normalizeHost(raw);

  if (!host) {
    return new NextResponse("missing domain", { status: 400 });
  }

  // The platform's own host is served from a normal certificate, but allowing
  // it here means a single Caddy block can cover everything.
  if (isPlatformHost(host)) {
    return new NextResponse("ok", { status: 200 });
  }

  try {
    await connect();

    const tenant = await CompanyModel.findOne({
      domains: {
        $elemMatch: {
          host: { $in: [host, stripWww(host)] },
          verified: true,
        },
      },
      delete: { $ne: true },
    })
      .select("name status isActive delete")
      .lean();

    // A suspended company should stop serving, so its certificate should not be
    // renewed either.
    if (!tenant || !isTenantUsable(tenant)) {
      return new NextResponse("not allowed", { status: 403 });
    }

    return new NextResponse("ok", { status: 200 });
  } catch (error) {
    // Fail CLOSED, unlike tenant resolution. A database blip briefly delaying a
    // new certificate is a far smaller problem than issuing one for a hostname
    // whose ownership could not be confirmed.
    console.log("domain-allowed error:", error?.message);
    return new NextResponse("unavailable", { status: 503 });
  }
}
