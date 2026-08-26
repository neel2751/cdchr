"use server";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import { isValidObjectId } from "@/lib/mongodb";
import { resolveBranding } from "@/lib/tenant";
import { withAudit, recordAudit } from "@/lib/audit";
import { getServerSideProps } from "../session/session";
import {
  addDomain,
  applyBranding,
  applySlug,
  removeDomain,
  setPrimaryDomain,
  verifyDomain,
} from "./tenantOps";

/**
 * Self-service tenant settings for a company's own super admin.
 *
 * The work is done by tenantOps.js, which trusts the tenant id it is given.
 * This file's job is to decide *which* tenant that is — always from the signed
 * session, never from an argument. A tenant id accepted from the browser would
 * let one company edit another's branding and steal its domains.
 */

/** The caller, if they may manage their own company's settings. */
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

/** Wrap a tenantOps call with the session check and an audit entry. */
async function asTenantAdmin(op, describe) {
  const auth = await requireTenantAdmin();
  if (auth.error) return { success: false, message: auth.error };

  const result = await op(auth.tenantId);
  if (result?.success) {
    recordAudit({
      module: "Tenant",
      entityId: auth.tenantId,
      before: result.before,
      after: result.after,
      description: describe,
    });
  }
  return { success: !!result?.success, message: result?.message };
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

export const updateTenantBranding = withAudit(
  "Tenant.updateBranding",
  async (data) =>
    asTenantAdmin((id) => applyBranding(id, data), "Updated company branding"),
  { module: "Tenant" }
);

export const updateTenantSlug = withAudit(
  "Tenant.updateSlug",
  async (slug) =>
    asTenantAdmin((id) => applySlug(id, slug), `Set workspace address`),
  { module: "Tenant" }
);

export const addTenantDomain = withAudit(
  "Tenant.addDomain",
  async (host) => asTenantAdmin((id) => addDomain(id, host), `Added a domain`),
  { module: "Tenant" }
);

export const verifyTenantDomain = withAudit(
  "Tenant.verifyDomain",
  async (host) =>
    asTenantAdmin((id) => verifyDomain(id, host), `Verified a domain`),
  { module: "Tenant" }
);

export const setPrimaryTenantDomain = withAudit(
  "Tenant.setPrimaryDomain",
  async (host) =>
    asTenantAdmin((id) => setPrimaryDomain(id, host), `Set the primary domain`),
  { module: "Tenant" }
);

export const removeTenantDomain = withAudit(
  "Tenant.removeDomain",
  async (host) =>
    asTenantAdmin((id) => removeDomain(id, host), `Removed a domain`),
  { module: "Tenant" }
);
