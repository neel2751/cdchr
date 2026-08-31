"use server";

import { headers } from "next/headers";
import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { isValidObjectId } from "@/lib/mongodb";
import {
  isTenantUsable,
  resolveBranding,
  resolveLocale,
  toTenantSummary,
} from "@/lib/tenant";
import { escapeTenant } from "@/lib/tenantContext";
import { cacheGet, cacheInvalidate, cacheSet } from "@/lib/tenantCache";
import { getServerSideProps } from "../session/session";
import {
  hostCandidates,
  isPlatformHost,
  normalizeHost,
  tenantSlugFromHost,
} from "@/lib/tenantHost";

/**
 * Tenant resolution: which company does this request belong to?
 *
 * Order of precedence for a hostname:
 *   1. a verified custom domain  (hr.acme.com)
 *   2. a slug subdomain of the platform root  (acme.ourapp.com)
 *   3. nothing — the caller decides what to do
 *
 * IMPORTANT: what this returns is only ever used for *branding and routing*.
 * Which tenant's data a query may touch must come from the session, never from
 * the hostname. Host-derived and session-derived tenants are cross-checked in
 * `proxy.js` and must agree.
 */


// Mongoose buffers queries for 10s when the connection is down. Far too long to
// sit in front of a page load, so resolution gives up sooner and the caller
// carries on unresolved.
//
// Not tighter than this: the FIRST lookup after a restart also pays for the
// connection handshake (SRV lookup, TLS, auth), which against a remote cluster
// comfortably exceeds two seconds. At 2s every deploy began with a request that
// failed to resolve its tenant. server.mjs also warms the connection on boot so
// this ceiling is rarely approached at all.
const LOOKUP_TIMEOUT_MS = 5_000;

/** Drop cached host lookups. Thin wrapper so this stays a server action. */
export async function invalidateTenantCache(host) {
  cacheInvalidate(host ? normalizeHost(host) : undefined);
}

/**
 * Resolve a hostname to a tenant summary.
 *
 * @param {string} host raw Host header
 * @returns {Promise<{
 *   type: "platform" | "tenant" | "unknown",
 *   tenant: object | null,
 * }>}
 */
export async function resolveTenantByHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized) return { type: "unknown", tenant: null };

  if (isPlatformHost(normalized)) return { type: "platform", tenant: null };

  const cached = cacheGet(normalized);
  if (cached !== undefined) {
    return cached
      ? { type: "tenant", tenant: cached }
      : { type: "unknown", tenant: null };
  }

  try {
    const lookup = async () => {
      // Inside the race, not before it: connect() can itself spend seconds on
      // server selection when the database is unreachable.
      await connect();

      // 1. A verified custom domain wins. Unverified domains deliberately do
      //    not resolve — otherwise anyone could claim a hostname by typing it.
      const byDomain = await CompanyModel.findOne({
        domains: {
          $elemMatch: {
            host: { $in: hostCandidates(normalized) },
            verified: true,
          },
        },
        delete: { $ne: true },
      })
        .lean()
        .exec();
      if (byDomain) return byDomain;

      // 2. Otherwise fall back to the <slug>.<root> address, which always
      //    works and gives tenants somewhere to log in while DNS propagates.
      const slug = tenantSlugFromHost(normalized);
      if (!slug) return null;

      return CompanyModel.findOne({ slug, delete: { $ne: true } })
        .lean()
        .exec();
    };

    const tenant = await Promise.race([
      lookup(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("tenant lookup timed out")),
          LOOKUP_TIMEOUT_MS
        )
      ),
    ]);

    const summary = tenant ? toTenantSummary(tenant) : null;
    cacheSet(normalized, summary);

    return summary
      ? { type: "tenant", tenant: summary }
      : { type: "unknown", tenant: null };
  } catch (error) {
    // Fail open: a database blip must not take the whole app down. Nothing in
    // this phase depends on the result, and the session remains the authority
    // for data access.
    console.log("resolveTenantByHost error:", error?.message);
    return { type: "unknown", tenant: null };
  }
}

/**
 * Resolve the tenant for the request currently being handled. Use this from
 * server components and server actions — it reads the Host header directly
 * rather than trusting the `x-tenant-*` headers, so it cannot be spoofed even
 * if a request slips past the proxy.
 */
export async function getRequestTenant() {
  try {
    const h = await headers();
    return await resolveTenantByHost(h.get("host"));
  } catch (error) {
    return { type: "unknown", tenant: null };
  }
}

/**
 * Refuse anyone who is not provider staff.
 *
 * The route gate in proxy.js is not enough on its own: a server action can be
 * invoked from any page by id, so it never has to pass through /platform. Any
 * cross-tenant reader below therefore checks the role itself.
 */
async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  return props?.session?.user?.role === "platformAdmin";
}

/**
 * Paginated tenant list for the platform dashboard.
 *
 * Cross-tenant by design, so it is gated to platformAdmin here as well as at
 * the route. Shaped like the other list actions ({ data: JSON string,
 * totalCount }) so it works with useFetchQuery unchanged.
 */
export async function getTenants(filterData) {
  try {
    if (!(await requirePlatformAdmin())) {
      return { success: false, message: "Not authorised" };
    }
    await connect();

    const search = filterData?.query?.trim() || "";
    const page = Math.max(1, parseInt(filterData?.page || 1, 10) || 1);
    const limit = Math.max(1, parseInt(filterData?.pageSize || 10, 10) || 10);
    const skip = (page - 1) * limit;

    const query = { delete: { $ne: true } };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
        { "domains.host": { $regex: search, $options: "i" } },
      ];
    }
    if (filterData?.filter?.status && filterData.filter.status !== "all") {
      query.status = filterData.filter.status;
    }

    const totalCount = await CompanyModel.countDocuments(query);
    const tenants = await CompanyModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    // Employee counts per tenant, in one query rather than one per row.
    // Cross-tenant on purpose: this is the provider's view of every tenant, and
    // callers are gated to platformAdmin in proxy.js and again in the layout.
    const counts = await escapeTenant(
      "platform console: employee counts across tenants",
      () =>
        OfficeEmployeeModel.aggregate([
          { $match: { delete: { $ne: true }, company: { $ne: null } } },
          { $group: { _id: "$company", total: { $sum: 1 } } },
        ])
    );
    const countByTenant = new Map(
      counts.map((c) => [String(c._id), c.total])
    );

    const rows = tenants.map((tenant) => ({
      _id: String(tenant._id),
      name: tenant.name,
      description: tenant.description || "",
      slug: tenant.slug || "",
      status: tenant.status || "active",
      usable: isTenantUsable(tenant),
      isActive: tenant.isActive !== false,
      domains: (tenant.domains || []).map((d) => ({
        host: d.host,
        isPrimary: !!d.isPrimary,
        verified: !!d.verified,
        sslStatus: d.sslStatus || "pending",
      })),
      plan: tenant.billing?.plan || "standard",
      employeeCount: countByTenant.get(String(tenant._id)) || 0,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    }));

    return {
      success: true,
      data: JSON.stringify(rows),
      totalCount,
    };
  } catch (error) {
    console.log("getTenants error:", error?.message);
    return { success: false, message: "Error fetching tenants" };
  }
}

/** Full tenant record for the platform detail view. */
export async function getTenantById(id) {
  try {
    if (!(await requirePlatformAdmin())) {
      return { success: false, message: "Not authorised" };
    }
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid tenant id" };
    }
    await connect();
    const tenant = await CompanyModel.findById(id).lean().exec();
    if (!tenant) return { success: false, message: "Tenant not found" };
    return { success: true, data: JSON.stringify(tenant) };
  } catch (error) {
    console.log("getTenantById error:", error?.message);
    return { success: false, message: "Something went wrong" };
  }
}

/**
 * Branding for the signed-in user's own company, for the app shell to render.
 *
 * Open to any signed-in user — unlike the settings actions, which are super
 * admin only. It returns nothing but presentation, and every user of a company
 * sees that company's branding anyway.
 */
export async function getBrandingForCurrentUser() {
  try {
    const { props } = await getServerSideProps();
    const tenantId = props?.session?.user?.tenantId;
    if (!tenantId || !isValidObjectId(tenantId)) return null;

    await connect();
    const tenant = await CompanyModel.findById(tenantId)
      .select("name branding locale")
      .lean()
      .exec();
    if (!tenant) return null;

    // `locale` rides along with branding rather than getting its own fetch and
    // its own context: every consumer that needs a currency is already a
    // consumer of branding, and one round trip beats two for the same page.
    return {
      name: tenant.name,
      ...resolveBranding(tenant),
      locale: resolveLocale(tenant),
    };
  } catch (error) {
    // Branding is cosmetic — never let it break the page it decorates.
    console.log("getBrandingForCurrentUser error:", error?.message);
    return null;
  }
}

/** Headline counts for the platform dashboard. */
export async function getPlatformStats() {
  try {
    if (!(await requirePlatformAdmin())) {
      return { success: false, message: "Not authorised" };
    }
    await connect();
    const [total, active, suspended, withCustomDomain] = await Promise.all([
      CompanyModel.countDocuments({ delete: { $ne: true } }),
      CompanyModel.countDocuments({
        delete: { $ne: true },
        isActive: { $ne: false },
        status: { $in: ["active", "trial"] },
      }),
      CompanyModel.countDocuments({
        delete: { $ne: true },
        status: "suspended",
      }),
      CompanyModel.countDocuments({
        delete: { $ne: true },
        domains: { $elemMatch: { verified: true } },
      }),
    ]);

    return {
      success: true,
      data: JSON.stringify({ total, active, suspended, withCustomDomain }),
    };
  } catch (error) {
    console.log("getPlatformStats error:", error?.message);
    return { success: false, message: "Error fetching platform stats" };
  }
}
