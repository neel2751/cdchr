"use server";

import mongoose from "mongoose";

import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";
import TenantMembershipModel from "@/models/tenantMembershipModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { escapeTenant } from "@/lib/tenantContext";
import { GLOBAL_MODELS } from "@/lib/tenantPlugin";
import { logAuditDirect } from "@/lib/audit";
import { getServerSideProps } from "../session/session";
import { cacheInvalidate } from "@/lib/tenantCache";

/**
 * Tenant lifecycle: taking a company's data out, and taking a company away.
 *
 * Both walk the registered models rather than a hand-written list, so a
 * collection added later is included automatically. A hardcoded list would
 * silently omit new data — the worst possible failure for an export, and for a
 * deletion that is supposed to leave nothing behind.
 */

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user) return { error: "Not signed in" };
  if (user.role !== "platformAdmin") return { error: "Not authorised" };
  return { user };
}

/** Every model that carries a tenantId, i.e. everything a company owns. */
function tenantScopedModels() {
  return Object.entries(mongoose.models)
    .filter(([name, model]) => !GLOBAL_MODELS.has(name) && model.schema.path("tenantId"))
    .map(([name, model]) => ({ name, model }));
}

/**
 * Everything one company owns, as plain JSON.
 *
 * Reads outside the tenant scope and filters by tenantId explicitly: the caller
 * is a platform admin with no tenant of their own, so a scoped read would
 * return nothing.
 */
export async function exportTenant(tenantId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid company" };
    }

    await connect();
    const company = await CompanyModel.findById(tenantId).lean();
    if (!company) return { success: false, message: "Company not found" };

    const oid = createObjectId(tenantId);
    const collections = {};
    let total = 0;

    await escapeTenant("platform: export a company", async () => {
      for (const { name, model } of tenantScopedModels()) {
        const docs = await model.find({ tenantId: oid }).lean();
        if (!docs.length) continue;
        collections[name] = docs;
        total += docs.length;
      }
      // Memberships are global but describe this company, so they belong in
      // the export — otherwise who could access it is lost.
      const memberships = await TenantMembershipModel.find({ tenantId: oid }).lean();
      if (memberships.length) {
        collections.TenantMembership = memberships;
        total += memberships.length;
      }
    });

    await logAuditDirect({
      actor: {
        _id: auth.user._id,
        name: auth.user.name,
        email: auth.user.email,
        role: "platformAdmin",
      },
      action: "Platform.exportTenant",
      module: "Platform",
      tenantId,
      entityId: tenantId,
      description: `Exported ${company.name} (${total} documents)`,
      metadata: { documents: total, collections: Object.keys(collections) },
    });

    return {
      success: true,
      message: `Exported ${total} documents`,
      data: JSON.stringify({
        exportedAt: new Date().toISOString(),
        company,
        counts: Object.fromEntries(
          Object.entries(collections).map(([k, v]) => [k, v.length])
        ),
        collections,
      }),
    };
  } catch (error) {
    console.log("exportTenant error:", error?.message);
    return { success: false, message: "Export failed" };
  }
}

/** What a delete would remove, without removing it. */
export async function previewTenantDeletion(tenantId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid company" };
    }

    await connect();
    const company = await CompanyModel.findById(tenantId).lean();
    if (!company) return { success: false, message: "Company not found" };

    const oid = createObjectId(tenantId);
    const counts = {};
    let total = 0;

    await escapeTenant("platform: preview a deletion", async () => {
      for (const { name, model } of tenantScopedModels()) {
        const n = await model.countDocuments({ tenantId: oid });
        if (n) {
          counts[name] = n;
          total += n;
        }
      }
      const m = await TenantMembershipModel.countDocuments({ tenantId: oid });
      if (m) {
        counts.TenantMembership = m;
        total += m;
      }
    });

    return {
      success: true,
      data: JSON.stringify({
        name: company.name,
        status: company.status || "active",
        total,
        counts,
      }),
    };
  } catch (error) {
    console.log("previewTenantDeletion error:", error?.message);
    return { success: false, message: "Could not read the company" };
  }
}

/**
 * Permanently remove a company and everything it owns.
 *
 * Three guards, because this cannot be undone:
 *   - the company must already be suspended or cancelled, so deletion is never
 *     the first action taken against a live business
 *   - the caller must type the company's name exactly
 *   - an audit entry is written BEFORE anything is removed, so the record
 *     survives even if the deletion fails halfway
 *
 * Export first. This does not do it for you, and afterwards there is nothing
 * left to export.
 */
export async function deleteTenantPermanently(tenantId, confirmation) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid company" };
    }

    await connect();
    const company = await CompanyModel.findById(tenantId).lean();
    if (!company) return { success: false, message: "Company not found" };

    const status = company.status || "active";
    if (status !== "suspended" && status !== "cancelled") {
      return {
        success: false,
        message:
          "Suspend the company first. Deleting a live company is never a single step.",
      };
    }

    if (String(confirmation || "").trim() !== company.name) {
      return {
        success: false,
        message: `Type the company name exactly to confirm: ${company.name}`,
      };
    }

    const oid = createObjectId(tenantId);

    // Written before the deletion, not after: if this fails partway there must
    // still be a record that it was attempted, by whom, and against what.
    await logAuditDirect({
      actor: {
        _id: auth.user._id,
        name: auth.user.name,
        email: auth.user.email,
        role: "platformAdmin",
      },
      action: "Platform.deleteTenant",
      module: "Platform",
      entityId: tenantId,
      description: `Permanently deleting ${company.name}`,
      before: { name: company.name, slug: company.slug, status },
    });

    const removed = {};
    let total = 0;

    await escapeTenant("platform: delete a company", async () => {
      for (const { name, model } of tenantScopedModels()) {
        const res = await model.deleteMany({ tenantId: oid });
        if (res.deletedCount) {
          removed[name] = res.deletedCount;
          total += res.deletedCount;
        }
      }
      const m = await TenantMembershipModel.deleteMany({ tenantId: oid });
      if (m.deletedCount) {
        removed.TenantMembership = m.deletedCount;
        total += m.deletedCount;
      }
      await CompanyModel.deleteOne({ _id: oid });
    });

    // Its hostnames now resolve to nothing; drop them from the cache so that
    // takes effect immediately rather than after the TTL.
    cacheInvalidate();

    return {
      success: true,
      message: `Deleted ${company.name} and ${total} documents`,
      data: JSON.stringify({ removed, total }),
    };
  } catch (error) {
    console.log("deleteTenantPermanently error:", error?.message);
    return { success: false, message: "Deletion failed" };
  }
}
