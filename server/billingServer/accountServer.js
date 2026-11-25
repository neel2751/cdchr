"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { logAuditDirect } from "@/lib/audit";
import { MANUAL_LOCK_LEVELS, companyAccess } from "@/lib/tenantAccess";
import BillingAccountModel from "@/models/billingAccountModel";
import CompanyModel from "@/models/companyModel";
import TenantMembershipModel from "@/models/tenantMembershipModel";
import { getServerSideProps } from "../session/session";
import { invalidateTenantCache } from "../tenantServer/tenantServer";
import { invalidateCompanyAccess } from "../tenantServer/tenantAccessState";
import { loadPricing } from "./pricingStore";
import { quoteCompany, refreshAccount, repriceCompany } from "./accountStore";
import {
  previewSubscriptionBilling,
  runSubscriptionBilling,
} from "./subscriptionBilling";
import InvoiceModel from "@/models/invoiceModel";
import { escapeTenant } from "@/lib/tenantContext";
import { outstanding } from "@/lib/money";

/**
 * Billing accounts in the platform console: a customer's companies on one
 * bill. Platform admin only, every function, first line.
 */

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user) return { error: "Not signed in" };
  if (user.role !== "platformAdmin") return { error: "Not authorised" };
  return { user };
}

function audit(user, action, description, extra = {}) {
  return logAuditDirect({
    actor: { _id: user._id, name: user.name, email: user.email, role: "platformAdmin" },
    action,
    module: "Platform",
    description,
    status: "success",
    ...extra,
  }).catch(() => {});
}

const companyFields = "name slug status delete billing";

function summary(company, account) {
  return {
    _id: company._id,
    name: company.name,
    slug: company.slug || "",
    status: company.status || "active",
    access: companyAccess(company).level,
    plan: company.billing?.plan || null,
    quotedMonthlyPence: company.billing?.quotedMonthlyPence ?? null,
    primary: account ? String(account.primaryCompanyId) === String(company._id) : false,
  };
}

/**
 * Companies that look like one customer but are billed apart: they share a
 * super admin login. The likeliest way an owner's branches ended up as
 * separate companies.
 */
async function suggestedGroups() {
  const rows = await TenantMembershipModel.aggregate([
    { $match: { role: "superAdmin", isActive: true } },
    { $group: { _id: "$email", tenants: { $addToSet: "$tenantId" } } },
    { $match: { "tenants.1": { $exists: true } } },
  ]);
  const groups = [];
  const seen = new Set();
  for (const row of rows) {
    const companies = await CompanyModel.find({
      _id: { $in: row.tenants },
      delete: { $ne: true },
      "billing.accountId": { $exists: false },
    })
      .select("name")
      .lean();
    const key = companies.map((c) => String(c._id)).sort().join(",");
    if (companies.length < 2 || seen.has(key)) continue;
    seen.add(key);
    groups.push({ owner: row._id, companies });
  }
  return groups;
}

/** Every account, with its companies, and groups worth making one. */
export async function listAccounts() {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    await connect();
    const accounts = await BillingAccountModel.find({}).sort({ name: 1 }).lean();
    const companies = await CompanyModel.find({
      "billing.accountId": { $in: accounts.map((a) => a._id) },
      delete: { $ne: true },
    })
      .select(companyFields)
      .lean();
    const byAccount = (id) =>
      companies.filter((c) => String(c.billing.accountId) === String(id));

    return {
      success: true,
      data: JSON.stringify({
        accounts: accounts.map((a) => {
          const list = byAccount(a._id).map((c) => summary(c, a));
          return {
            _id: a._id,
            name: a.name,
            billingEmail: a.billingEmail,
            companies: list,
            // As recorded when each package was applied; the account page
            // works it out live.
            monthlyPence: list.reduce((sum, c) => sum + (c.quotedMonthlyPence || 0), 0),
          };
        }),
        suggestions: await suggestedGroups(),
      }),
    };
  } catch (error) {
    console.log("listAccounts error:", error?.message);
    return { success: false, message: "Could not load the accounts" };
  }
}

/** One account: its companies, each one's live price, and the total. */
export async function getAccount(accountId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(accountId)) return { success: false, message: "Invalid account" };
    await connect();
    const account = await BillingAccountModel.findById(accountId).lean();
    if (!account) return { success: false, message: "Account not found" };

    const [companies, pricing] = await Promise.all([
      CompanyModel.find({ "billing.accountId": account._id, delete: { $ne: true } })
        .select(companyFields)
        .sort({ name: 1 })
        .lean(),
      loadPricing(),
    ]);

    const priced = [];
    for (const company of companies) {
      const { result, usage, extraCompany } = await quoteCompany(company, { pricing, account });
      priced.push({
        ...summary(company, account),
        paidThrough: company.billing?.paidThrough || null,
        extraCompany,
        usage,
        cycle: result.cycle,
        quote: result,
      });
    }

    // Companies not in any account, to add.
    const free = await CompanyModel.find({
      "billing.accountId": { $exists: false },
      delete: { $ne: true },
    })
      .select("name")
      .sort({ name: 1 })
      .lean();

    // The account's plan bills, newest first.
    const invoices = await escapeTenant("accounts: plan bills", () =>
      InvoiceModel.find({ accountId: account._id, source: "subscription" })
        .sort({ issuedAt: -1, createdAt: -1 })
        .limit(24)
        .select("number status grossPence currency issuedAt dueAt periodFrom periodTo payments")
        .lean()
    );

    return {
      success: true,
      data: JSON.stringify({
        account: {
          ...account,
          // Only what the console shows: never a Stripe id it has no use for.
          card: account.card?.paymentMethodId
            ? {
                brand: account.card.brand,
                last4: account.card.last4,
                expMonth: account.card.expMonth,
                expYear: account.card.expYear,
              }
            : null,
        },
        invoices: invoices.map((inv) => ({
          _id: inv._id,
          number: inv.number,
          status: inv.status,
          grossPence: inv.grossPence,
          outstandingPence: outstanding(inv.grossPence, inv.payments),
          issuedAt: inv.issuedAt,
          dueAt: inv.dueAt,
          periodFrom: inv.periodFrom,
          periodTo: inv.periodTo,
        })),
        companies: priced,
        total: {
          monthlyNetPence: priced.reduce((s, c) => s + c.quote.monthlyNetPence, 0),
          vatPence: priced.reduce((s, c) => s + c.quote.vatPence, 0),
          periodGrossPence: priced.reduce((s, c) => s + c.quote.periodGrossPence, 0),
        },
        currency: pricing.settings.currency,
        extraCompanyDiscountPercent: pricing.settings.extraCompanyDiscountPercent,
        available: free,
      }),
    };
  } catch (error) {
    console.log("getAccount error:", error?.message);
    return { success: false, message: "Could not load the account" };
  }
}

/**
 * A new account, with the companies that start in it. The first is the main
 * company; the rest are extras.
 */
export async function createAccount({ name, billingEmail = "", companyIds = [] } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    const title = String(name || "").trim();
    if (!title) return { success: false, message: "Give the account a name" };
    const ids = [...new Set(companyIds.map(String))].filter(isValidObjectId);
    if (!ids.length) return { success: false, message: "Choose at least one company" };

    await connect();
    const taken = await CompanyModel.find({
      _id: { $in: ids.map(createObjectId) },
      "billing.accountId": { $exists: true },
    })
      .select("name")
      .lean();
    if (taken.length) {
      return {
        success: false,
        message: `${taken.map((c) => c.name).join(", ")} already ${taken.length === 1 ? "is" : "are"} in an account`,
      };
    }

    const account = await BillingAccountModel.create({
      name: title,
      billingEmail: String(billingEmail || "").trim().toLowerCase(),
      primaryCompanyId: createObjectId(ids[0]),
      createdBy: auth.user.email || "",
    });
    await CompanyModel.updateMany(
      { _id: { $in: ids.map(createObjectId) } },
      { $set: { "billing.accountId": account._id } }
    );
    await refreshAccount(account._id);
    await audit(auth.user, "Platform.createAccount", `Created billing account ${title}`, {
      entityId: String(account._id),
      after: { name: title, companies: ids },
    });
    return { success: true, message: `${title} created`, id: String(account._id) };
  } catch (error) {
    console.log("createAccount error:", error?.message);
    return { success: false, message: "Could not create the account" };
  }
}

/** Rename an account, or change where its bill goes. */
export async function updateAccount(accountId, { name, billingEmail, notes } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(accountId)) return { success: false, message: "Invalid account" };
    const set = {};
    if (name !== undefined) {
      if (!String(name).trim()) return { success: false, message: "Give the account a name" };
      set.name = String(name).trim();
    }
    if (billingEmail !== undefined) set.billingEmail = String(billingEmail).trim().toLowerCase();
    if (notes !== undefined) set.notes = String(notes).slice(0, 2000);
    await connect();
    await BillingAccountModel.updateOne({ _id: accountId }, { $set: set });
    await audit(auth.user, "Platform.updateAccount", "Updated a billing account", {
      entityId: accountId,
      after: set,
    });
    return { success: true, message: "Saved" };
  } catch (error) {
    console.log("updateAccount error:", error?.message);
    return { success: false, message: "Could not save the account" };
  }
}

/** Put a company on an account's bill, as an extra company. */
export async function addCompanyToAccount(accountId, tenantId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(accountId) || !isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid account or company" };
    }
    await connect();
    const account = await BillingAccountModel.findById(accountId).lean();
    if (!account) return { success: false, message: "Account not found" };
    const company = await CompanyModel.findById(tenantId).select("name billing").lean();
    if (!company) return { success: false, message: "Company not found" };
    if (company.billing?.accountId) {
      return {
        success: false,
        message: String(company.billing.accountId) === String(accountId)
          ? `${company.name} is already in this account`
          : `${company.name} is in another account — take it out of that one first`,
      };
    }
    await CompanyModel.updateOne(
      { _id: company._id },
      { $set: { "billing.accountId": account._id } }
    );
    // An account whose main company left has none: this one takes the place.
    if (!account.primaryCompanyId) {
      await BillingAccountModel.updateOne(
        { _id: account._id },
        { $set: { primaryCompanyId: company._id } }
      );
    }
    await refreshAccount(account._id);
    await audit(auth.user, "Platform.addToAccount", `Added ${company.name} to ${account.name}`, {
      entityId: accountId,
      tenantId,
    });
    return { success: true, message: `${company.name} added to ${account.name}` };
  } catch (error) {
    console.log("addCompanyToAccount error:", error?.message);
    return { success: false, message: "Could not add the company" };
  }
}

/**
 * Take a company off its account's bill: billed on its own, at the full
 * package price, from now. If it was the main company, the next one takes
 * its place.
 */
export async function removeCompanyFromAccount(tenantId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) return { success: false, message: "Invalid company" };
    await connect();
    const company = await CompanyModel.findById(tenantId).select("name billing").lean();
    const accountId = company?.billing?.accountId;
    if (!accountId) return { success: false, message: "That company is not in an account" };
    const account = await BillingAccountModel.findById(accountId).lean();

    await CompanyModel.updateOne({ _id: company._id }, { $unset: { "billing.accountId": "" } });
    if (account && String(account.primaryCompanyId) === String(company._id)) {
      const next = await CompanyModel.findOne({
        "billing.accountId": accountId,
        delete: { $ne: true },
      })
        .sort({ createdAt: 1 })
        .select("_id")
        .lean();
      await BillingAccountModel.updateOne(
        { _id: accountId },
        next ? { $set: { primaryCompanyId: next._id } } : { $unset: { primaryCompanyId: "" } }
      );
    }
    // Billed alone now: the full package price.
    await repriceCompany(
      { ...company, billing: { ...company.billing, accountId: undefined } },
      { account: null }
    );
    await refreshAccount(accountId);
    await audit(
      auth.user,
      "Platform.removeFromAccount",
      `Took ${company.name} out of ${account?.name || "its account"}`,
      { entityId: String(accountId), tenantId }
    );
    return { success: true, message: `${company.name} is billed on its own now` };
  } catch (error) {
    console.log("removeCompanyFromAccount error:", error?.message);
    return { success: false, message: "Could not take the company out" };
  }
}

/** Which company pays the full package price. */
export async function setPrimaryCompany(accountId, tenantId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(accountId) || !isValidObjectId(tenantId)) {
      return { success: false, message: "Invalid account or company" };
    }
    await connect();
    const company = await CompanyModel.findOne({
      _id: tenantId,
      "billing.accountId": createObjectId(accountId),
    })
      .select("name")
      .lean();
    if (!company) return { success: false, message: "That company is not in this account" };
    await BillingAccountModel.updateOne(
      { _id: accountId },
      { $set: { primaryCompanyId: company._id } }
    );
    await refreshAccount(accountId);
    await audit(auth.user, "Platform.setPrimaryCompany", `${company.name} is now the main company`, {
      entityId: accountId,
      tenantId,
    });
    return { success: true, message: `${company.name} is now the main company` };
  } catch (error) {
    console.log("setPrimaryCompany error:", error?.message);
    return { success: false, message: "Could not change the main company" };
  }
}

/**
 * Lock every company in an account, make them read-only, or lift it — an
 * unpaid bill is the customer's, not one branch's. Same lock as the Access
 * tab (lib/tenantAccess.js), set on each company.
 */
export async function setAccountLock(accountId, { level = null, message = "" } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(accountId)) return { success: false, message: "Invalid account" };
    if (level !== null && !MANUAL_LOCK_LEVELS.includes(level)) {
      return { success: false, message: "Unknown lock" };
    }
    await connect();
    const account = await BillingAccountModel.findById(accountId).lean();
    if (!account) return { success: false, message: "Account not found" };
    const filter = { "billing.accountId": account._id, delete: { $ne: true } };
    const companies = await CompanyModel.find(filter).select("_id status").lean();

    if (level) {
      await CompanyModel.updateMany(filter, {
        $set: {
          "billing.lock": {
            level,
            message: String(message || "").trim().slice(0, 500),
            at: new Date(),
            by: auth.user.email || auth.user.name || "platform",
          },
        },
      });
    } else {
      await CompanyModel.updateMany(filter, { $unset: { "billing.lock": "" } });
      // Unlocking means unlocked, as on a single company.
      await CompanyModel.updateMany(
        { ...filter, status: "suspended" },
        { $set: { status: "active", isActive: true } }
      );
    }
    await invalidateTenantCache();
    for (const c of companies) invalidateCompanyAccess(c._id);

    await audit(
      auth.user,
      level ? "Platform.lockAccount" : "Platform.unlockAccount",
      level
        ? `Set ${account.name} (${companies.length} companies) to ${level}`
        : `Lifted the lock on ${account.name} (${companies.length} companies)`,
      { entityId: accountId }
    );
    return {
      success: true,
      message: level
        ? `${companies.length} compan${companies.length === 1 ? "y" : "ies"} ${level === "locked" ? "locked" : "made read-only"}`
        : `${companies.length} compan${companies.length === 1 ? "y" : "ies"} unlocked`,
    };
  } catch (error) {
    console.log("setAccountLock error:", error?.message);
    return { success: false, message: "Could not change the lock" };
  }
}

/** What billing this account today would charge — nothing is billed. */
export async function previewAccountBilling(accountId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(accountId)) return { success: false, message: "Invalid account" };
    const preview = await previewSubscriptionBilling({ accountId: createObjectId(accountId) });
    return { success: true, data: JSON.stringify(preview) };
  } catch (error) {
    console.log("previewAccountBilling error:", error?.message);
    return { success: false, message: "Could not work out the bill" };
  }
}

/**
 * Bill this account now, for every company whose paid period has run out:
 * make the invoice, then charge the saved card or email it. A person
 * deciding, so it works with automatic billing off.
 */
export async function billAccountNow(accountId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(accountId)) return { success: false, message: "Invalid account" };
    const result = await runSubscriptionBilling({
      accountId: createObjectId(accountId),
      force: true,
      by: auth.user.name || auth.user.email || "Platform admin",
    });
    if (result.failed.length) {
      return { success: false, message: result.failed[0].reason };
    }
    const bill = result.billed[0];
    await audit(auth.user, "Platform.billNow", bill ? `Billed ${bill.account}: ${bill.invoice}` : "Bill now: nothing was due", {
      entityId: accountId,
    });
    if (!bill) return { success: true, message: "Nothing is due — every company is paid up" };
    return {
      success: true,
      message: bill.charged
        ? `${bill.invoice} issued and paid by card`
        : `${bill.invoice} issued — ${bill.reason}`,
    };
  } catch (error) {
    console.log("billAccountNow error:", error?.message);
    return { success: false, message: error?.message || "Could not bill the account" };
  }
}
