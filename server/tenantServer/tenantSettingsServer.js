"use server";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import TenantMembershipModel from "@/models/tenantMembershipModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { isTenantUsable, resolveBranding } from "@/lib/tenant";
import { withAudit, recordAudit } from "@/lib/audit";
import { getServerSideProps } from "../session/session";
import {
  addDomain,
  applyBranding,
  applySlug,
  removeDomain,
  setPrimaryDomain,
  verifyDomain,
  checkDomainTls,
} from "./tenantOps";

/**
 * Self-service settings for the companies a person owns.
 *
 * Every action takes an explicit company id, because an owner of several
 * companies needs to give each its own domain and branding without switching
 * the whole session back and forth. The id is authorised against
 * TenantMembership on every call — holding a super admin membership for *that*
 * company is the only thing that grants access, so an id from the browser is a
 * request, never permission.
 *
 * The session's active tenant still decides what ordinary pages show; it just
 * no longer limits which company can be configured here.
 */

/** The companies this account may configure, i.e. where it is super admin. */
async function settableTenantIds(userId) {
  await connect();
  const rows = await TenantMembershipModel.find({
    userId: createObjectId(userId),
    isActive: true,
    role: "superAdmin",
  })
    .lean()
    .exec();
  return rows.map((r) => String(r.tenantId));
}

/**
 * Authorise the caller for one company.
 * @returns {{ tenantId: string } | { error: string }}
 */
async function requireCompanyAdmin(tenantId) {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { error: "Not signed in" };
  if (!tenantId || !isValidObjectId(tenantId)) {
    return { error: "Unknown company" };
  }

  await connect();
  const membership = await TenantMembershipModel.findOne({
    userId: createObjectId(user._id),
    tenantId: createObjectId(tenantId),
    isActive: true,
    role: "superAdmin",
  })
    .lean()
    .exec();
  if (!membership) {
    return { error: "You do not manage that company" };
  }

  const tenant = await CompanyModel.findById(tenantId).lean().exec();
  if (!tenant || !isTenantUsable(tenant)) {
    return { error: "That company is not active" };
  }

  return { tenantId: String(tenantId), user };
}

/** Wrap a tenantOps call with the membership check and an audit entry. */
async function asCompanyAdmin(tenantId, op, describe) {
  const auth = await requireCompanyAdmin(tenantId);
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

function serializeTenant(tenant) {
  return {
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
  };
}

/**
 * Every company this account can configure, each with its own settings.
 *
 * Returns them all at once so the page can show one company per tab and an
 * owner can set up a different domain for each without leaving the page.
 */
export async function getMyCompanySettings() {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user?._id) return { success: false, message: "Not signed in" };

    const ids = await settableTenantIds(user._id);
    if (!ids.length) {
      return {
        success: false,
        message:
          "You are not a super admin of any company. Ask the platform team for access.",
      };
    }

    const tenants = await CompanyModel.find({
      _id: { $in: ids.map((id) => createObjectId(id)) },
      delete: { $ne: true },
    })
      .sort({ name: 1 })
      .lean()
      .exec();

    return {
      success: true,
      data: JSON.stringify({
        activeTenantId: user.tenantId || null,
        platformRootDomain: process.env.PLATFORM_ROOT_DOMAIN || "",
        companies: tenants.filter(isTenantUsable).map(serializeTenant),
      }),
    };
  } catch (error) {
    console.log("getMyCompanySettings error:", error?.message);
    return { success: false, message: "Could not load company settings" };
  }
}

export const updateTenantBranding = withAudit(
  "Tenant.updateBranding",
  async (tenantId, data) =>
    asCompanyAdmin(tenantId, (id) => applyBranding(id, data), "Updated branding"),
  { module: "Tenant" }
);

export const updateTenantSlug = withAudit(
  "Tenant.updateSlug",
  async (tenantId, slug) =>
    asCompanyAdmin(tenantId, (id) => applySlug(id, slug), "Updated workspace address"),
  { module: "Tenant" }
);

export const addTenantDomain = withAudit(
  "Tenant.addDomain",
  async (tenantId, host) =>
    asCompanyAdmin(tenantId, (id) => addDomain(id, host), "Added a domain"),
  { module: "Tenant" }
);

export const verifyTenantDomain = withAudit(
  "Tenant.verifyDomain",
  async (tenantId, host) =>
    asCompanyAdmin(tenantId, (id) => verifyDomain(id, host), "Verified a domain"),
  { module: "Tenant" }
);

export const setPrimaryTenantDomain = withAudit(
  "Tenant.setPrimaryDomain",
  async (tenantId, host) =>
    asCompanyAdmin(tenantId, (id) => setPrimaryDomain(id, host), "Set the primary domain"),
  { module: "Tenant" }
);

export const checkTenantDomainTls = withAudit(
  "Tenant.checkDomainTls",
  async (tenantId, host) =>
    asCompanyAdmin(tenantId, (id) => checkDomainTls(id, host), "Checked HTTPS"),
  { module: "Tenant" }
);

export const removeTenantDomain = withAudit(
  "Tenant.removeDomain",
  async (tenantId, host) =>
    asCompanyAdmin(tenantId, (id) => removeDomain(id, host), "Removed a domain"),
  { module: "Tenant" }
);
