"use server";

import dns from "node:dns/promises";
import crypto from "node:crypto";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { resolveBranding } from "@/lib/tenant";
import { normalizeHost, stripWww } from "@/lib/tenantHost";
import { invalidateTenantCache } from "./tenantServer";
import { getServerSideProps } from "../session/session";
import { withAudit, recordAudit } from "@/lib/audit";

/**
 * Self-service tenant settings: branding, slug and custom domains.
 *
 * IMPORTANT: `Companie` is a global model, so the tenant plugin does NOT filter
 * it. Every function here therefore resolves the caller's own tenant from the
 * session and writes only to that id — a tenant id must never be accepted as an
 * argument, or one company could edit another's branding and steal its domain.
 */

const DNS_PREFIX = "_verify";

/** The caller, if they are allowed to manage their tenant's settings. */
async function requireTenantAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user) return { error: "Not signed in" };
  // Settings change what every user of the company sees, and domains affect
  // routing, so this stays with the company's highest role.
  if (user.role !== "superAdmin") {
    return { error: "Only a super admin can change company settings" };
  }
  if (!user.tenantId || !isValidObjectId(user.tenantId)) {
    return { error: "Your account is not linked to a company yet" };
  }
  return { user, tenantId: user.tenantId };
}

/** The signed-in user's own tenant, with branding defaults filled in. */
export async function getMyTenant() {
  try {
    const auth = await requireTenantAdmin();
    if (auth.error) return { success: false, message: auth.error };

    await connect();
    const tenant = await CompanyModel.findById(auth.tenantId).lean().exec();
    if (!tenant) return { success: false, message: "Company not found" };

    return {
      success: true,
      data: JSON.stringify({
        _id: String(tenant._id),
        name: tenant.name,
        description: tenant.description || "",
        slug: tenant.slug || "",
        status: tenant.status || "active",
        branding: resolveBranding(tenant),
        // What is actually stored, so the form can tell "unset" from "default".
        storedBranding: tenant.branding || {},
        domains: (tenant.domains || []).map((d) => ({
          host: d.host,
          isPrimary: !!d.isPrimary,
          verified: !!d.verified,
          verificationToken: d.verificationToken || "",
          sslStatus: d.sslStatus || "pending",
        })),
        platformRootDomain: process.env.PLATFORM_ROOT_DOMAIN || "",
      }),
    };
  } catch (error) {
    console.log("getMyTenant error:", error?.message);
    return { success: false, message: "Could not load company settings" };
  }
}

const BRANDING_FIELDS = [
  "appName",
  "logoUrl",
  "logoDarkUrl",
  "faviconUrl",
  "loginBackgroundUrl",
  "primaryColor",
  "accentColor",
  "radius",
  "supportEmail",
  "emailFromName",
  "emailFooterHtml",
];

export const updateTenantBranding = withAudit(
  "Tenant.updateBranding",
  async (data) => {
    try {
      const auth = await requireTenantAdmin();
      if (auth.error) return { success: false, message: auth.error };

      await connect();
      const before = await CompanyModel.findById(auth.tenantId).lean().exec();
      if (!before) return { success: false, message: "Company not found" };

      // Allow-listed so a crafted payload cannot reach status, domains or
      // anything else on the tenant document.
      const branding = {};
      for (const key of BRANDING_FIELDS) {
        if (data?.[key] !== undefined) {
          branding[key] = String(data[key]).trim();
        }
      }

      await CompanyModel.updateOne(
        { _id: createObjectId(auth.tenantId) },
        { $set: { branding: { ...(before.branding || {}), ...branding } } }
      );

      recordAudit({
        module: "Tenant",
        entityId: auth.tenantId,
        before: before.branding || {},
        after: branding,
        description: "Updated company branding",
      });

      await invalidateTenantCache();
      return { success: true, message: "Branding saved" };
    } catch (error) {
      console.log("updateTenantBranding error:", error?.message);
      return { success: false, message: "Could not save branding" };
    }
  },
  { module: "Tenant" }
);

export const updateTenantSlug = withAudit(
  "Tenant.updateSlug",
  async (rawSlug) => {
    try {
      const auth = await requireTenantAdmin();
      if (auth.error) return { success: false, message: auth.error };

      const slug = String(rawSlug || "").trim().toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
        return {
          success: false,
          message:
            "Use 3-63 lowercase letters, numbers or hyphens, not starting or ending with a hyphen",
        };
      }

      await connect();
      const taken = await CompanyModel.findOne({
        slug,
        _id: { $ne: createObjectId(auth.tenantId) },
      })
        .lean()
        .exec();
      if (taken) return { success: false, message: "That address is taken" };

      const before = await CompanyModel.findById(auth.tenantId).lean().exec();
      await CompanyModel.updateOne(
        { _id: createObjectId(auth.tenantId) },
        { $set: { slug } }
      );

      recordAudit({
        module: "Tenant",
        entityId: auth.tenantId,
        before: { slug: before?.slug || "" },
        after: { slug },
        description: `Set workspace address to ${slug}`,
      });

      await invalidateTenantCache();
      return { success: true, message: "Workspace address saved" };
    } catch (error) {
      console.log("updateTenantSlug error:", error?.message);
      return { success: false, message: "Could not save the address" };
    }
  },
  { module: "Tenant" }
);

export const addTenantDomain = withAudit(
  "Tenant.addDomain",
  async (rawHost) => {
    try {
      const auth = await requireTenantAdmin();
      if (auth.error) return { success: false, message: auth.error };

      const host = normalizeHost(rawHost);
      if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
        return { success: false, message: "Enter a valid domain, e.g. hr.acme.com" };
      }

      await connect();
      // A hostname can only ever point at one tenant, so this checks across all
      // of them — the one place a cross-tenant read is required here.
      const owner = await CompanyModel.findOne({
        "domains.host": { $in: [host, stripWww(host)] },
      })
        .lean()
        .exec();
      if (owner) {
        return {
          success: false,
          message:
            String(owner._id) === String(auth.tenantId)
              ? "That domain is already added"
              : "That domain is already in use",
        };
      }

      const tenant = await CompanyModel.findById(auth.tenantId).lean().exec();
      const domain = {
        host,
        // The first domain becomes primary, so emails always have a URL to use.
        isPrimary: (tenant?.domains || []).length === 0,
        verified: false,
        verificationToken: crypto.randomBytes(16).toString("hex"),
        sslStatus: "pending",
        addedAt: new Date(),
      };

      await CompanyModel.updateOne(
        { _id: createObjectId(auth.tenantId) },
        { $push: { domains: domain } }
      );

      recordAudit({
        module: "Tenant",
        entityId: auth.tenantId,
        after: { host },
        description: `Added domain ${host}`,
      });

      await invalidateTenantCache(host);
      return {
        success: true,
        message: "Domain added — now add the DNS record to verify it",
      };
    } catch (error) {
      console.log("addTenantDomain error:", error?.message);
      return { success: false, message: "Could not add the domain" };
    }
  },
  { module: "Tenant" }
);

/**
 * Look for the TXT record that proves control of the domain.
 *
 * Verification is what makes a domain route traffic (see resolveTenantByHost),
 * so it can never be a simple "mark it done" button — without the DNS check,
 * anyone could claim any hostname.
 */
export const verifyTenantDomain = withAudit(
  "Tenant.verifyDomain",
  async (rawHost) => {
    try {
      const auth = await requireTenantAdmin();
      if (auth.error) return { success: false, message: auth.error };

      const host = normalizeHost(rawHost);
      await connect();
      const tenant = await CompanyModel.findById(auth.tenantId).lean().exec();
      const domain = (tenant?.domains || []).find((d) => d.host === host);
      if (!domain) return { success: false, message: "Domain not found" };
      if (domain.verified) return { success: true, message: "Already verified" };

      const record = `${DNS_PREFIX}.${host}`;
      let values = [];
      try {
        values = (await dns.resolveTxt(record)).flat();
      } catch (err) {
        return {
          success: false,
          message:
            err?.code === "ENOTFOUND" || err?.code === "ENODATA"
              ? `No TXT record found at ${record}. DNS changes can take a few minutes.`
              : `Could not read DNS for ${record}`,
        };
      }

      if (!values.includes(domain.verificationToken)) {
        return {
          success: false,
          message: `TXT record found but the value does not match. Expected ${domain.verificationToken}`,
        };
      }

      await CompanyModel.updateOne(
        { _id: createObjectId(auth.tenantId), "domains.host": host },
        {
          $set: {
            "domains.$.verified": true,
            "domains.$.verifiedAt": new Date(),
          },
        }
      );

      recordAudit({
        module: "Tenant",
        entityId: auth.tenantId,
        after: { host, verified: true },
        description: `Verified domain ${host}`,
      });

      await invalidateTenantCache(host);
      return { success: true, message: `${host} verified` };
    } catch (error) {
      console.log("verifyTenantDomain error:", error?.message);
      return { success: false, message: "Verification failed" };
    }
  },
  { module: "Tenant" }
);

export const setPrimaryTenantDomain = withAudit(
  "Tenant.setPrimaryDomain",
  async (rawHost) => {
    try {
      const auth = await requireTenantAdmin();
      if (auth.error) return { success: false, message: auth.error };

      const host = normalizeHost(rawHost);
      await connect();
      const tenant = await CompanyModel.findById(auth.tenantId).lean().exec();
      const domain = (tenant?.domains || []).find((d) => d.host === host);
      if (!domain) return { success: false, message: "Domain not found" };
      if (!domain.verified) {
        return {
          success: false,
          message: "Verify the domain before making it primary",
        };
      }

      const domains = (tenant.domains || []).map((d) => ({
        ...d,
        isPrimary: d.host === host,
      }));
      await CompanyModel.updateOne(
        { _id: createObjectId(auth.tenantId) },
        { $set: { domains } }
      );

      recordAudit({
        module: "Tenant",
        entityId: auth.tenantId,
        after: { primaryHost: host },
        description: `Set ${host} as the primary domain`,
      });

      await invalidateTenantCache();
      return { success: true, message: `${host} is now the primary domain` };
    } catch (error) {
      console.log("setPrimaryTenantDomain error:", error?.message);
      return { success: false, message: "Could not set the primary domain" };
    }
  },
  { module: "Tenant" }
);

export const removeTenantDomain = withAudit(
  "Tenant.removeDomain",
  async (rawHost) => {
    try {
      const auth = await requireTenantAdmin();
      if (auth.error) return { success: false, message: auth.error };

      const host = normalizeHost(rawHost);
      await connect();
      await CompanyModel.updateOne(
        { _id: createObjectId(auth.tenantId) },
        { $pull: { domains: { host } } }
      );

      recordAudit({
        module: "Tenant",
        entityId: auth.tenantId,
        before: { host },
        description: `Removed domain ${host}`,
      });

      await invalidateTenantCache(host);
      return { success: true, message: `${host} removed` };
    } catch (error) {
      console.log("removeTenantDomain error:", error?.message);
      return { success: false, message: "Could not remove the domain" };
    }
  },
  { module: "Tenant" }
);
