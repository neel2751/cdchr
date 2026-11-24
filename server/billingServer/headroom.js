import { connect } from "@/db/db";
import { isValidObjectId } from "@/lib/mongodb";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { headroom } from "@/lib/pricing";
import { resolveTerms } from "@/data/terminology";
import CompanyModel from "@/models/companyModel";
import PricingPlanModel from "@/models/pricingPlanModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";

/**
 * Has this company room for more people? One answer for every way people
 * arrive: the add-employee forms, the bulk import, and switching a leaver back
 * on. The rule itself is headroom() in lib/pricing.js:
 *
 *   - the platform admin's hard cap (limits.maxEmployees / maxWorkers), and
 *   - the package allowance, if the company chose to stop there rather than
 *     pay for extras (billing.overageMode "block").
 *
 * Counts current people only: leavers and anyone switched off are not
 * counted, the same as the price list counts them.
 *
 * Fails OPEN, like the seat check it replaces: a company must never be unable
 * to take someone on because a limit could not be read.
 *
 * NOT "use server": it takes a tenant id and trusts it. Callers have already
 * established whose company this is.
 */

const CURRENT = { delete: { $ne: true }, isActive: { $ne: false } };

const KINDS = {
  officeStaff: { model: OfficeEmployeeModel, cap: "maxEmployees", included: "officeStaff" },
  workers: { model: EmployeModel, cap: "maxWorkers", included: "workers" },
};

/** The company, its package, and what it calls its workers. */
export async function companyLimits(tenantId) {
  const company = await escapeTenant("headroom: company limits", () =>
    CompanyModel.findById(tenantId)
      .select("limits billing.plan billing.overageMode industry terms")
      .lean()
  );
  if (!company) return null;
  const plan = company.billing?.plan
    ? await PricingPlanModel.findOne({ key: company.billing.plan }).lean()
    : null;
  return { company, plan, terms: resolveTerms(company) };
}

/**
 * @param {string} tenantId
 * @param {"officeStaff"|"workers"} kind
 * @param {number} [adding]
 * @returns {Promise<{ allowed: boolean, message?: string }>}
 */
export async function checkHeadroom(tenantId, kind, adding = 1) {
  const spec = KINDS[kind];
  if (!spec || !tenantId || !isValidObjectId(String(tenantId)) || adding <= 0) {
    return { allowed: true };
  }
  try {
    await connect();
    const found = await companyLimits(tenantId);
    if (!found) return { allowed: true };
    const { company, plan, terms } = found;

    const cap = company.limits?.[spec.cap] ?? null;
    const overageMode = company.billing?.overageMode || "charge";
    const included = plan?.included?.[spec.included] ?? null;
    // Nothing to stop at: no count needed.
    if (!(cap > 0) && !(overageMode === "block" && included != null)) {
      return { allowed: true };
    }

    const used = await runWithTenant(String(tenantId), () =>
      spec.model.countDocuments(CURRENT)
    );
    return headroom({
      used,
      adding,
      cap,
      included,
      overageMode,
      planName: plan?.name,
      label: kind === "workers" ? terms.siteEmployees.toLowerCase() : "office staff",
    });
  } catch (error) {
    console.log("Headroom check failed:", error?.message);
    return { allowed: true };
  }
}
