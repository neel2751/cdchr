"use server";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { resolveBranding } from "@/lib/tenant";
import { normalizeHost } from "@/lib/tenantHost";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { getServerSideProps } from "../session/session";
import { invalidateTenantCache } from "./tenantServer";
import { tenantStorageUsage } from "../aws/branding";
// Imported for the module-usage counts below. Explicit imports rather than
// walking mongoose.models, which only lists models something has already
// imported — a count that silently goes missing is worse than no count.
import EmployeModel from "@/models/employeModel";
import ProjectSiteModel from "@/models/siteProjectModel";
import ExpenseModel from "@/models/expense/expenseModel";
import MediaModel from "@/models/document/mediaModel";
import AnnouncementModel from "@/models/announcementModel";
import DeviceModel from "@/models/deviceModel";
import VisitorModel from "@/models/visitorModel";
import LeadModel from "@/models/leadModel";
import LeaveRequestModel from "@/models/leaveRequestModel";
import WeeklyRotaModel from "@/models/weeklyRotaModel";
import BookingModel from "@/models/bookingModel";
import { FEATURE_BY_KEY, FEATURE_KEYS } from "@/data/features";
import {
  isFeatureEnabled,
  resolveFeatureDependencies,
} from "@/lib/tenantPlan";
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

    // Best-effort: the console should still render if the bucket is
    // unreachable, so a failure here shows "unknown" rather than an error page.
    let storage = null;
    try {
      storage = await tenantStorageUsage(tenantId);
    } catch (error) {
      console.log("tenant storage usage unavailable:", error?.message);
    }

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
        storage,
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

/**
 * How much a company would lose sight of if a module were switched off.
 *
 * Switching a module off hides its records; it never deletes them (see
 * FEATURE_TOGGLES_PLAN.md, D4). But "hidden" is small comfort if nobody knew
 * there were 200 of them, so the console shows the count before saving and says
 * plainly that nothing is deleted.
 *
 * Modules with no records of their own — attendance reports, AI — are absent
 * from the map rather than reported as zero. Zero reads as "nothing there",
 * which is a different statement from "this module does not store anything".
 *
 * Counts explicitly by tenantId inside escapeTenant, the same way
 * previewTenantDeletion does: the caller is a platform admin with no tenant of
 * their own, so a scoped read would return nothing — and the explicit filter is
 * correct whether or not TENANT_ENFORCEMENT is on.
 */
const USAGE_MODELS = {
  siteEmployees: EmployeModel,
  siteProjects: ProjectSiteModel,
  expenses: ExpenseModel,
  documents: MediaModel,
  announcements: AnnouncementModel,
  devices: DeviceModel,
  visitors: VisitorModel,
  crm: LeadModel,
  leave: LeaveRequestModel,
  weeklyRota: WeeklyRotaModel,
  reception: BookingModel,
};

export async function getTenantModuleUsage(tenantId) {
  const auth = await requirePlatformAdmin();
  if (auth.error) return { success: false, message: auth.error };
  if (!tenantId || !isValidObjectId(tenantId)) {
    return { success: false, message: "Invalid company" };
  }

  try {
    await connect();
    const oid = createObjectId(tenantId);
    const counts = {};

    await escapeTenant("platform: module usage counts", async () => {
      for (const [key, model] of Object.entries(USAGE_MODELS)) {
        try {
          counts[key] = await model.countDocuments({ tenantId: oid });
        } catch {
          // One uncountable collection must not cost the operator every other
          // number. Absent means "no count available", which the console
          // renders as a softer warning than a figure it cannot stand behind.
        }
      }
    });

    return { success: true, data: JSON.stringify(counts) };
  } catch (error) {
    console.log("getTenantModuleUsage error:", error?.message);
    return { success: false, message: "Could not read usage" };
  }
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
      // Cascaded off by a dependency rather than asked for, reported back so the
      // console can say which modules went with the one that was switched off.
      const cascaded = [];

      if (features && typeof features === "object") {
        // Only keys the registry knows. An unrecognised one is either a typo or
        // a module that has been removed; writing it would put a flag in the
        // document that nothing will ever read or clean up.
        const incoming = {};
        for (const [key, value] of Object.entries(features)) {
          if (FEATURE_KEYS.includes(key)) incoming[key] = !!value;
        }

        // Resolved against what the company already has, not against `incoming`
        // alone: a partial update that switches one module off must still be
        // judged together with the flags it is not mentioning.
        const merged = { ...(before.features || {}), ...incoming };
        const resolved = resolveFeatureDependencies(merged);

        for (const key of FEATURE_KEYS) {
          const asked = key in incoming;
          const forced =
            isFeatureEnabled(merged, key) && !isFeatureEnabled(resolved, key);
          // Untouched flags stay untouched, so a save never rewrites a module
          // nobody mentioned.
          if (!asked && !forced) continue;
          set[`features.${key}`] = resolved[key] !== false;
          if (forced && incoming[key] !== false) cascaded.push(key);
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

      const alsoOff = cascaded
        .map((key) => FEATURE_BY_KEY[key]?.label || key)
        .join(", ");

      return {
        success: true,
        message: alsoOff
          ? `Plan saved. ${alsoOff} switched off too — it depends on a module you turned off.`
          : "Plan saved",
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

/**
 * Who currently owns a hostname, and who else has claimed it.
 *
 * The console needs this to settle a "that domain is ours" support request:
 * releasing it returns the hostname to the open pool so the rightful company
 * can verify it.
 */
export async function lookupDomain(rawHost) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };

    const host = normalizeHost(rawHost);
    if (!host) return { success: false, message: "Enter a domain" };

    await connect();
    const holders = await CompanyModel.find({ "domains.host": host })
      .select("name slug domains")
      .lean()
      .exec();

    return {
      success: true,
      data: JSON.stringify(
        holders.map((c) => {
          const d = (c.domains || []).find((x) => x.host === host);
          return {
            tenantId: String(c._id),
            name: c.name,
            verified: !!d?.verified,
            addedAt: d?.addedAt || null,
          };
        })
      ),
    };
  } catch (error) {
    console.log("lookupDomain error:", error?.message);
    return { success: false, message: "Could not look up the domain" };
  }
}

/**
 * Take a verified hostname away from a company.
 *
 * The manual half of the ownership rules: a verified domain is closed to
 * everyone else, so when it genuinely belongs to another business the team
 * releases it here and the rightful owner can then claim and verify it.
 */
export async function releaseDomain(tenantId, host) {
  return asPlatformAdmin(
    tenantId,
    (id) => removeDomain(id, host),
    "Platform.releaseDomain",
    `Released ${normalizeHost(host)} back to the open pool`
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
