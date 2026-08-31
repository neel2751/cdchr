import CompanyModel from "@/models/companyModel";
import { escapeTenant } from "@/lib/tenantContext";
import { isValidObjectId } from "@/lib/mongodb";

/**
 * Reading a company's plan flags from the database.
 *
 * `lib/tenantPlan.js` holds the pure decisions — which path needs which flag,
 * whether a flag is on. This is the one thing those cannot do: fetch the
 * company. Kept apart so tenantPlan.js stays usable from a test or a layout
 * with no database behind it.
 *
 * Deliberately NOT a "use server" module, for the same reason as
 * lib/tenantAssets.js: these back authorisation decisions, and exporting them
 * from a server-action file would publish them as endpoints.
 */

/**
 * A company's module flags; `{}` (meaning everything on) when they cannot be
 * read.
 *
 * Failing open is deliberate and matches `isFeatureEnabled`, where an absent
 * flag means enabled: a lookup error must not take a module away from a company
 * that pays for it. The consequence — a company briefly keeping a module its
 * plan excludes — is the cheaper mistake.
 *
 * `escapeTenant` because the companies collection is global (see GLOBAL_MODELS
 * in lib/tenantPlugin.js); there is no tenant scope to read it under.
 *
 * @param {string} tenantId
 * @returns {Promise<Object>}
 */
export async function getTenantFeatures(tenantId) {
  if (!tenantId || !isValidObjectId(tenantId)) return {};
  try {
    const tenant = await escapeTenant("plan: company feature flags", () =>
      CompanyModel.findById(tenantId).select("features").lean()
    );
    return tenant?.features || {};
  } catch {
    return {};
  }
}
