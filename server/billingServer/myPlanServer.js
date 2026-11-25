"use server";

import { connect } from "@/db/db";
import { isValidObjectId } from "@/lib/mongodb";
import { recordAudit, withAudit } from "@/lib/audit";
import { companyAccess, describeAccess } from "@/lib/tenantAccess";
import { OVERAGE_MODES, quote, usageRows } from "@/lib/pricing";
import { FEATURE_BY_KEY } from "@/data/features";
import { resolveTerms } from "@/data/terminology";
import CompanyModel from "@/models/companyModel";
import { getServerSideProps } from "../session/session";
import { invalidateCompanyAccess } from "../tenantServer/tenantAccessState";
import { companyUsage, loadPricing } from "./pricingStore";
import { forgetPlanNotice } from "./planNotice";
import { accountOf, isExtraCompany } from "./accountStore";

/**
 * Plan & billing, for the company's own super admin: the package, what it
 * costs at today's numbers, how much of each allowance is used, and what
 * happens when they go over. Reads; the one thing they change here is that
 * last choice. Packages and prices are set by us (pricingServer.js).
 */

async function requireOwner() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { error: "Not signed in" };
  if (user.role !== "superAdmin" || !isValidObjectId(user.tenantId)) {
    return { error: "Only the company's super admin can see its plan" };
  }
  return { user, tenantId: String(user.tenantId) };
}

export async function getMyPlan() {
  try {
    const auth = await requireOwner();
    if (auth.error) return { success: false, message: auth.error };

    await connect();
    const company = await CompanyModel.findById(auth.tenantId)
      .select("name status delete billing limits industry terms")
      .lean();
    if (!company) return { success: false, message: "Company not found" };

    const [pricing, usage] = await Promise.all([
      loadPricing(),
      companyUsage(auth.tenantId),
    ]);
    const billing = company.billing || {};
    const plan = pricing.plans.find((p) => p.key === billing.plan) || null;
    const terms = resolveTerms(company);
    const overageMode = billing.overageMode || "charge";
    const access = companyAccess(company);
    // Billed together with the customer's other companies, if it is.
    const account = await accountOf(company);
    const extraCompany = isExtraCompany(company._id, account);
    const siblings = account
      ? await CompanyModel.find({
          "billing.accountId": account._id,
          delete: { $ne: true },
        })
          .select("name")
          .lean()
      : [];

    const priced = plan
      ? quote({
          companies: [
            {
              label: company.name,
              planKey: plan.key,
              officeStaff: usage.officeStaff,
              workers: usage.workers,
              storageGb: usage.storageGb || 0,
              addOns: billing.addOns || [],
              extraCompany,
            },
          ],
          cycle: billing.cycle || "monthly",
          discountPercent: billing.discountPercent || 0,
          plans: pricing.plans,
          settings: pricing.settings,
        })
      : null;

    // The packages on offer, to compare — what a trial company is choosing
    // between. Prices only; a package is chosen with us, not from here.
    const packages = pricing.plans
      .filter((p) => p.isActive !== false || p.key === billing.plan)
      .map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        monthlyPence: p.monthlyPence,
        included: p.included,
        extraPence: p.extraPence,
        modules: p.features.map((k) => FEATURE_BY_KEY[k]?.label).filter(Boolean),
        current: p.key === billing.plan,
      }));

    return {
      success: true,
      data: JSON.stringify({
        companyName: company.name,
        status: company.status || "active",
        access: { ...access, text: describeAccess(access, { owner: true }) },
        plan: plan && {
          key: plan.key,
          name: plan.name,
          description: plan.description,
          included: plan.included,
          extraPence: plan.extraPence,
        },
        cycle: billing.cycle || "monthly",
        addOns: (billing.addOns || []).map((k) => FEATURE_BY_KEY[k]?.label || k),
        quote: priced,
        overageMode,
        rows: usageRows({
          plan,
          usage,
          limits: company.limits || {},
          overageMode,
          workersLabel: terms.siteEmployees,
        }),
        workersLabel: terms.siteEmployees,
        account: account && {
          name: account.name,
          extraCompany,
          extraCompanyDiscountPercent: pricing.settings.extraCompanyDiscountPercent,
          others: siblings
            .filter((c) => String(c._id) !== String(company._id))
            .map((c) => ({
              name: c.name,
              main: String(c._id) === String(account.primaryCompanyId),
            })),
        },
        packages,
        currency: pricing.settings.currency,
        contactEmail: process.env.PLATFORM_SUPPORT_EMAIL || "",
      }),
    };
  } catch (error) {
    console.log("getMyPlan error:", error?.message);
    return { success: false, message: "Could not load your plan" };
  }
}

/**
 * Over the package's allowance: pay for extras ("charge"), or stop there
 * ("block") so the bill never holds a surprise.
 */
export const setOverageMode = withAudit(
  "Tenant.overageMode",
  async (mode) => {
    try {
      const auth = await requireOwner();
      if (auth.error) return { success: false, message: auth.error };
      if (!OVERAGE_MODES.includes(mode)) {
        return { success: false, message: "Unknown choice" };
      }
      await connect();
      await CompanyModel.updateOne(
        { _id: auth.tenantId },
        { $set: { "billing.overageMode": mode } }
      );
      invalidateCompanyAccess(auth.tenantId);
      forgetPlanNotice(auth.tenantId);
      recordAudit({
        module: "Tenant",
        entityId: auth.tenantId,
        after: { overageMode: mode },
        description:
          mode === "block"
            ? "Set to stop at the package allowance"
            : "Set to pay for extras over the package",
      });
      return {
        success: true,
        message:
          mode === "block"
            ? "You will stop at your package's allowance"
            : "Extras over your package will be on your bill",
      };
    } catch (error) {
      console.log("setOverageMode error:", error?.message);
      return { success: false, message: "Could not save that" };
    }
  },
  { module: "Tenant" }
);
