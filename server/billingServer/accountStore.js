import { connect } from "@/db/db";
import { quote } from "@/lib/pricing";
import BillingAccountModel from "@/models/billingAccountModel";
import CompanyModel from "@/models/companyModel";
import { companyUsage, loadPricing } from "./pricingStore";

/**
 * Billing accounts, on the server: which customer a company is billed under,
 * whether it is that customer's main company or an extra one, and keeping
 * each company's recorded price right when the account changes.
 *
 * NOT "use server": takes ids and trusts them. The console's actions
 * (accountServer.js) check who is asking.
 */

/** Is this company one of a customer's extra companies (a branch)? */
export function isExtraCompany(companyId, account) {
  if (!account?.primaryCompanyId) return false;
  return String(account.primaryCompanyId) !== String(companyId);
}

/** The account a company is billed under, or null. */
export async function accountOf(company) {
  const id = company?.billing?.accountId;
  if (!id) return null;
  await connect();
  return BillingAccountModel.findById(id).lean();
}

/**
 * The quote for one company as things stand: its package, cycle, add-ons and
 * deal discount, today's usage, and whether its account makes it an extra
 * company.
 */
export async function quoteCompany(company, { pricing, usage, account } = {}) {
  const [p, u, a] = await Promise.all([
    pricing || loadPricing(),
    usage || companyUsage(company._id),
    account === undefined ? accountOf(company) : account,
  ]);
  const billing = company.billing || {};
  const extraCompany = isExtraCompany(company._id, a);
  return {
    extraCompany,
    usage: u,
    result: quote({
      companies: [
        {
          label: company.name,
          planKey: billing.plan,
          officeStaff: u.officeStaff,
          workers: u.workers,
          storageGb: u.storageGb || 0,
          addOns: billing.addOns || [],
          extraCompany,
        },
      ],
      cycle: billing.cycle || "monthly",
      discountPercent: billing.discountPercent || 0,
      plans: p.plans,
      settings: p.settings,
    }),
  };
}

/**
 * Re-price every company in an account after it changed — a company joined
 * or left, or the main company moved — so each one's recorded price and
 * "extra company" mark match the account. Companies without a package are
 * only re-marked.
 */
export async function refreshAccount(accountId) {
  await connect();
  const [account, companies, pricing] = await Promise.all([
    BillingAccountModel.findById(accountId).lean(),
    CompanyModel.find({ "billing.accountId": accountId, delete: { $ne: true } })
      .select("name billing")
      .lean(),
    loadPricing(),
  ]);
  if (!account) return;
  for (const company of companies) {
    await repriceCompany(company, { pricing, account });
  }
}

/** Record a company's price and extra-company mark as they now stand. */
export async function repriceCompany(company, { pricing, account } = {}) {
  const set = { "billing.extraCompany": isExtraCompany(company._id, account) };
  if (company.billing?.plan && company.billing?.planAppliedAt) {
    const { result } = await quoteCompany(company, { pricing, account });
    set["billing.quotedMonthlyPence"] = result.monthlyNetPence;
    set["billing.quotedPeriodPence"] = result.periodNetPence;
  }
  await CompanyModel.updateOne({ _id: company._id }, { $set: set });
}
