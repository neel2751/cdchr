"use server";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { resolveBranding } from "@/lib/tenant";
import { runWithTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { getServerSideProps } from "../session/session";
import { invalidateTenantCache } from "./tenantServer";
import {
  addDomain,
  applyBranding,
  applySlug,
  removeDomain,
  setPrimaryDomain,
  verifyDomain,
} from "./tenantOps";

/**
 * Provider-side tenant management.
 *
 * Unlike tenantSettingsServer.js, these DO take a tenant id — that is the whole
 * point of a platform console. Which makes the role check the only thing
 * standing between a caller and every company's data, so every function starts
 * with it and none of them trust anything else.
 *
 * Audited through logAuditDirect rather than withAudit: withAudit only records
 * admin/superAdmin, and a platform admin is neither.
 */

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user) return { error: "Not signed in" };
  if (user.role !== "platformAdmin") return { error: "Not authorised" };
  return { user };
}

/** Run a tenantOps call against an explicit tenant, gated and audited. */
async function asPlatformAdmin(tenantId, op, action, describe) {
  const auth = await requirePlatformAdmin();
  if (auth.error) return { success: false, message: auth.error };
  if (!tenantId || !isValidObjectId(tenantId)) {
    return { success: false, message: "Invalid company" };
  }

  const result = await op(tenantId);

  await logAuditDirect({
    actor: {
      _id: auth.user._id,
      name: auth.user.name,
      email: auth.user.email,
      role: "platformAdmin",
    },
    action,
    module: "Platform",
    tenantId,
    entityId: tenantId,
    description: describe,
    before: result?.before,
    after: result?.after,
    status: result?.success ? "success" : "failure",
    errorMessage: result?.success ? undefined : result?.message,
  });

  return { success: !!result?.success, message: result?.message };
}

/** Everything the platform console shows for one tenant. */
export async function getTenantDetail(tenantId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid company" };
    }

    await connect();
    const tenant = await CompanyModel.findById(tenantId).lean().exec();
    if (!tenant) return { success: false, message: "Company not found" };

    // Scoped TO the tenant being viewed rather than escaping the scope: the
    // plugin then applies the filter itself, so this cannot read another
    // company's rows even if the id were wrong.
    const employeeCount = await runWithTenant(tenantId, () =>
      OfficeEmployeeModel.countDocuments({ delete: { $ne: true } })
    );

    return {
      success: true,
      data: JSON.stringify({
        _id: String(tenant._id),
        name: tenant.name,
        description: tenant.description || "",
        slug: tenant.slug || "",
        status: tenant.status || "active",
        isActive: tenant.isActive !== false,
        branding: resolveBranding(tenant),
        storedBranding: tenant.branding || {},
        domains: (tenant.domains || []).map((d) => ({
          host: d.host,
          isPrimary: !!d.isPrimary,
          verified: !!d.verified,
          verificationToken: d.verificationToken || "",
          sslStatus: d.sslStatus || "pending",
        })),
        features: tenant.features || {},
        limits: tenant.limits || {},
        billing: tenant.billing || {},
        employeeCount,
        createdAt: tenant.createdAt,
        platformRootDomain: process.env.PLATFORM_ROOT_DOMAIN || "",
      }),
    };
  } catch (error) {
    console.log("getTenantDetail error:", error?.message);
    return { success: false, message: "Could not load the company" };
  }
}

/** Provision a new tenant. */
export async function createTenant({ name, slug, description } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };

    const trimmed = String(name || "").trim();
    if (!trimmed) return { success: false, message: "Name is required" };

    const wanted = String(slug || "").trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(wanted)) {
      return {
        success: false,
        message: "Address must be lowercase letters, numbers or hyphens",
      };
    }

    await connect();
    if (await CompanyModel.findOne({ slug: wanted }).lean().exec()) {
      return { success: false, message: "That address is taken" };
    }

    const created = await CompanyModel.create({
      name: trimmed,
      description: String(description || "").trim(),
      slug: wanted,
      status: "trial",
      domains: [],
      isActive: true,
      delete: false,
    });

    await logAuditDirect({
      actor: {
        _id: auth.user._id,
        name: auth.user.name,
        email: auth.user.email,
        role: "platformAdmin",
      },
      action: "Platform.createTenant",
      module: "Platform",
      tenantId: String(created._id),
      entityId: String(created._id),
      description: `Created company ${trimmed}`,
      after: { name: trimmed, slug: wanted },
    });

    await invalidateTenantCache();
    return {
      success: true,
      message: `${trimmed} created`,
      data: JSON.stringify({ _id: String(created._id) }),
    };
  } catch (error) {
    console.log("createTenant error:", error?.message);
    return { success: false, message: "Could not create the company" };
  }
}

const STATUSES = new Set(["active", "trial", "suspended", "cancelled"]);

/**
 * Change a tenant's lifecycle state.
 *
 * Suspending stops the tenant resolving, so its domains stop serving — the
 * legacy `isActive` flag is kept in step so both checks in isTenantUsable()
 * agree.
 */
export async function setTenantStatus(tenantId, status) {
  if (!STATUSES.has(status)) {
    return { success: false, message: "Unknown status" };
  }
  return asPlatformAdmin(
    tenantId,
    async (id) => {
      await connect();
      const before = await CompanyModel.findById(id).lean().exec();
      if (!before) return { success: false, message: "Company not found" };

      const usable = status === "active" || status === "trial";
      await CompanyModel.updateOne(
        { _id: createObjectId(id) },
        { $set: { status, isActive: usable } }
      );
      await invalidateTenantCache();

      return {
        success: true,
        message: `Status set to ${status}`,
        before: { status: before.status || "active" },
        after: { status },
      };
    },
    "Platform.setTenantStatus",
    `Set status to ${status}`
  );
}

/** Plan, seats and feature flags. */
export async function updateTenantPlan(tenantId, { plan, seats, features, limits } = {}) {
  return asPlatformAdmin(
    tenantId,
    async (id) => {
      await connect();
      const before = await CompanyModel.findById(id).lean().exec();
      if (!before) return { success: false, message: "Company not found" };

      const set = {};
      if (plan !== undefined) set["billing.plan"] = String(plan).trim();
      if (seats !== undefined) {
        const n = parseInt(seats, 10);
        set["billing.seats"] = Number.isFinite(n) && n > 0 ? n : null;
      }
      if (features && typeof features === "object") {
        for (const [key, value] of Object.entries(features)) {
          set[`features.${key}`] = !!value;
        }
      }
      if (limits && typeof limits === "object") {
        for (const [key, value] of Object.entries(limits)) {
          const n = parseInt(value, 10);
          set[`limits.${key}`] = Number.isFinite(n) && n > 0 ? n : null;
        }
      }
      if (!Object.keys(set).length) {
        return { success: false, message: "Nothing to change" };
      }

      await CompanyModel.updateOne({ _id: createObjectId(id) }, { $set: set });
      await invalidateTenantCache();

      return {
        success: true,
        message: "Plan saved",
        before: { billing: before.billing, features: before.features },
        after: set,
      };
    },
    "Platform.updateTenantPlan",
    "Updated plan and features"
  );
}

// --- Branding and domains, for any tenant ---------------------------------

export async function platformUpdateBranding(tenantId, data) {
  return asPlatformAdmin(
    tenantId,
    (id) => applyBranding(id, data),
    "Platform.updateBranding",
    "Updated branding"
  );
}

export async function platformUpdateSlug(tenantId, slug) {
  return asPlatformAdmin(
    tenantId,
    (id) => applySlug(id, slug),
    "Platform.updateSlug",
    "Updated workspace address"
  );
}

export async function platformAddDomain(tenantId, host) {
  return asPlatformAdmin(
    tenantId,
    (id) => addDomain(id, host),
    "Platform.addDomain",
    "Added a domain"
  );
}

export async function platformVerifyDomain(tenantId, host) {
  return asPlatformAdmin(
    tenantId,
    (id) => verifyDomain(id, host),
    "Platform.verifyDomain",
    "Verified a domain"
  );
}

export async function platformSetPrimaryDomain(tenantId, host) {
  return asPlatformAdmin(
    tenantId,
    (id) => setPrimaryDomain(id, host),
    "Platform.setPrimaryDomain",
    "Set the primary domain"
  );
}

export async function platformRemoveDomain(tenantId, host) {
  return asPlatformAdmin(
    tenantId,
    (id) => removeDomain(id, host),
    "Platform.removeDomain",
    "Removed a domain"
  );
}
