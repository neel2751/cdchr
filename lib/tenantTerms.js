import CompanyModel from "@/models/companyModel";
import { escapeTenant } from "@/lib/tenantContext";
import { isValidObjectId } from "@/lib/mongodb";
import { resolveTerms } from "@/data/terminology";

/**
 * A company's words for sites, site employees and the rest, read from the
 * database. data/terminology.js holds the templates and the filling; this is
 * the one thing it cannot do, fetch the company.
 *
 * For server code that builds text: the menu, refusal messages. Screens get
 * the same words through useTerms(), which reads them from the branding the
 * admin layout already resolved.
 *
 * Deliberately NOT a "use server" module, like lib/tenantFeatures.js.
 *
 * Fails to the construction words. They are what every company saw before
 * there was a choice, so a lookup error costs a tuition centre the word
 * "class" for one page, not the page.
 *
 * @param {string} tenantId
 * @returns {Promise<Record<string, string>>}
 */
export async function getTenantTerms(tenantId) {
  if (!tenantId || !isValidObjectId(tenantId)) return resolveTerms(null);
  try {
    const tenant = await escapeTenant("terms: company words", () =>
      CompanyModel.findById(tenantId).select("industry terms").lean()
    );
    return resolveTerms(tenant);
  } catch {
    return resolveTerms(null);
  }
}
