import { NextResponse } from "next/server";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { auth } from "@/auth";
import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import { isKeyInTenant } from "@/lib/tenantAssets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
  },
});

/**
 * Serve a tenant asset from our own origin.
 *
 * Branding images cannot be signed S3 URLs: they appear in the sidebar, in the
 * browser tab and in email, and a URL that expires in an hour is no use in any
 * of those. They also cannot be arbitrary external URLs — `next.config.mjs`
 * pins `img-src` and `images.remotePatterns`, and neither can be extended per
 * request, so a tenant's own CDN link renders in the settings preview and then
 * silently fails in production.
 *
 * Streaming through here keeps both lists fixed at `'self'`.
 *
 * Only `branding/` is public. Everything else a company stores is private and
 * still requires a session in that company.
 */
export async function GET(req, { params }) {
  try {
    const { key: segments } = await params;
    const key = (segments || []).join("/");

    if (!key.startsWith("tenants/")) {
      return new NextResponse("Not found", { status: 404 });
    }

    const [, tenantId, category] = key.split("/");

    if (category === "branding") {
      // A logo is shown on the sign-in page, before anyone has a session, so it
      // cannot require one. Nothing else under branding/ is sensitive — it is
      // the company's own public identity.
      const tenant = await withDb(() =>
        CompanyModel.findById(tenantId).select("_id").lean()
      );
      if (!tenant) return new NextResponse("Not found", { status: 404 });
    } else {
      // Everything else is private to the company that owns it.
      const session = await auth();
      const callerTenant = session?.user?.tenantId;
      if (!callerTenant || !isKeyInTenant(key, callerTenant)) {
        // 404 rather than 403: whether an object exists is itself information.
        return new NextResponse("Not found", { status: 404 });
      }
    }

    const obj = await s3.send(
      new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key })
    );

    return new NextResponse(obj.Body, {
      status: 200,
      headers: {
        "Content-Type": obj.ContentType || "application/octet-stream",
        // Branding rarely changes and is requested on every page load; private
        // assets must not be cached by shared proxies.
        "Cache-Control":
          category === "branding"
            ? "public, max-age=3600, stale-while-revalidate=86400"
            : "private, no-store",
      },
    });
  } catch (error) {
    if (error?.name === "NoSuchKey") {
      return new NextResponse("Not found", { status: 404 });
    }
    console.log("asset route error:", error?.message);
    return new NextResponse("Unavailable", { status: 502 });
  }
}

async function withDb(fn) {
  await connect();
  return fn();
}
