"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { logAuditDirect } from "@/lib/audit";
import { FEATURE_KEYS } from "@/data/features";
import {
  cleanPlan,
  cleanPricingSettings,
  normaliseOfferCode,
  quote,
} from "@/lib/pricing";
import { resolveFeatureDependencies } from "@/lib/tenantPlan";
import CompanyModel from "@/models/companyModel";
import PricingPlanModel from "@/models/pricingPlanModel";
import PricingSettingModel from "@/models/pricingSettingModel";
import TrialOfferModel from "@/models/trialOfferModel";
import { getServerSideProps } from "../session/session";
import { invalidateTenantCache } from "../tenantServer/tenantServer";
import { invalidateCompanyAccess } from "../tenantServer/tenantAccessState";
import { companyUsage, loadPricing } from "./pricingStore";

/**
 * The platform console's price list: packages, discounts, add-ons, trial
 * length and offer codes — and putting a company on a package at a price.
 *
 * Platform admin only, every function, first line. The arithmetic is
 * lib/pricing.js; this stores and applies.
 */

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user) return { error: "Not signed in" };
  if (user.role !== "platformAdmin") return { error: "Not authorised" };
  return { user };
}

const actorOf = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: "platformAdmin",
});

function audit(user, action, description, extra = {}) {
  return logAuditDirect({
    actor: actorOf(user),
    action,
    module: "Platform",
    description,
    status: "success",
    ...extra,
  }).catch(() => {});
}

/** Everything the pricing page shows. */
export async function getPricing() {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    const pricing = await loadPricing();
    const offers = await TrialOfferModel.find({}).sort({ createdAt: -1 }).lean();
    return {
      success: true,
      data: JSON.stringify({ ...pricing, offers }),
    };
  } catch (error) {
    console.log("getPricing error:", error?.message);
    return { success: false, message: "Could not load the price list" };
  }
}

/** Add or change a package. The key never changes once a plan exists. */
export async function savePlan(input) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    const { plan, error } = cleanPlan(input);
    if (error) return { success: false, message: error };

    await connect();
    const before = await PricingPlanModel.findOne({ key: plan.key }).lean();
    if (input.isNew && before) {
      return { success: false, message: `A plan called "${plan.key}" already exists` };
    }
    await PricingPlanModel.updateOne({ key: plan.key }, { $set: plan }, { upsert: true });
    await audit(auth.user, "Platform.savePlan", `Saved the ${plan.name} package`, {
      entityId: plan.key,
      before: before || undefined,
      after: plan,
    });
    return { success: true, message: `${plan.name} saved` };
  } catch (error) {
    console.log("savePlan error:", error?.message);
    return { success: false, message: "Could not save the plan" };
  }
}

/** Discounts, VAT, add-on prices and trial length. */
export async function savePricingSettings(input) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    const settings = cleanPricingSettings(input);

    await connect();
    const before = await PricingSettingModel.findOne({ singleton: "only" }).lean();
    await PricingSettingModel.updateOne(
      { singleton: "only" },
      {
        $set: {
          ...settings,
          reviewedAt: new Date(),
          reviewedBy: auth.user.email || auth.user.name || "",
        },
      },
      { upsert: true }
    );
    await audit(auth.user, "Platform.savePricing", "Saved the price list settings", {
      before: before || undefined,
      after: settings,
    });
    return { success: true, message: "Price list saved" };
  } catch (error) {
    console.log("savePricingSettings error:", error?.message);
    return { success: false, message: "Could not save the price list" };
  }
}

/**
 * Add or change a trial offer code — "EXPO30": 30 days, for a trade show.
 * The code itself cannot change once made: it may already be printed.
 */
export async function saveTrialOffer(input = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };

    const code = normaliseOfferCode(input.code);
    if (!code) {
      return {
        success: false,
        message: "Codes are 3 to 30 letters, numbers or dashes, e.g. EXPO30",
      };
    }
    const trialDays = parseInt(input.trialDays, 10);
    if (!Number.isFinite(trialDays) || trialDays < 1 || trialDays > 365) {
      return { success: false, message: "A trial is 1 to 365 days" };
    }
    const date = (v) => (v ? new Date(v) : null);
    const validFrom = date(input.validFrom);
    const validUntil = date(input.validUntil);
    if ([validFrom, validUntil].some((d) => d && Number.isNaN(d.getTime()))) {
      return { success: false, message: "Check the dates" };
    }
    // The end of the day it ends on, not its first second.
    if (validUntil) validUntil.setUTCHours(23, 59, 59, 999);
    const maxUses = parseInt(input.maxUses, 10);

    await connect();
    const exists = await TrialOfferModel.exists({ code });
    if (input.isNew && exists) {
      return { success: false, message: `${code} already exists` };
    }
    const fields = {
      label: String(input.label || "").trim().slice(0, 120),
      trialDays,
      validFrom,
      validUntil,
      maxUses: Number.isFinite(maxUses) && maxUses > 0 ? maxUses : null,
      isActive: input.isActive !== false,
    };
    await TrialOfferModel.updateOne(
      { code },
      {
        $set: fields,
        $setOnInsert: { code, uses: 0, createdBy: auth.user.email || "" },
      },
      { upsert: true }
    );
    await audit(auth.user, "Platform.saveTrialOffer", `Saved offer ${code} (${trialDays} days)`, {
      entityId: code,
      after: fields,
    });
    return { success: true, message: `${code} saved` };
  } catch (error) {
    console.log("saveTrialOffer error:", error?.message);
    return { success: false, message: "Could not save the offer" };
  }
}

/**
 * What a company uses and is on now, for its pricing panel: the calculator
 * starts from real numbers rather than guesses.
 */
export async function getCompanyPricing(tenantId) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) return { success: false, message: "Invalid company" };

    const [pricing, usage] = await Promise.all([loadPricing(), companyUsage(tenantId)]);
    const company = await CompanyModel.findById(tenantId)
      .select("name status billing features")
      .lean();
    if (!company) return { success: false, message: "Company not found" };

    return {
      success: true,
      data: JSON.stringify({ ...pricing, usage, billing: company.billing || {} }),
    };
  } catch (error) {
    console.log("getCompanyPricing error:", error?.message);
    return { success: false, message: "Could not load the company's pricing" };
  }
}

/**
 * Put a company on a package, at a price.
 *
 * Records the package, cycle, any deal discount, add-ons and whether it is a
 * customer's extra company, with the quote worked out from its usage today.
 * Optionally switches its modules to what the package (and add-ons) include,
 * and marks it as a paying customer — ending its trial.
 */
export async function applyPlanToCompany(
  tenantId,
  {
    planKey,
    cycle = "monthly",
    discountPercent = 0,
    addOns = [],
    extraCompany = false,
    matchModules = false,
    markPaying = false,
  } = {}
) {
  try {
    const auth = await requirePlatformAdmin();
    if (auth.error) return { success: false, message: auth.error };
    if (!isValidObjectId(tenantId)) return { success: false, message: "Invalid company" };

    const [pricing, usage] = await Promise.all([loadPricing(), companyUsage(tenantId)]);
    const plan = pricing.plans.find((p) => p.key === planKey);
    if (!plan) return { success: false, message: "Choose a package" };

    const before = await CompanyModel.findById(tenantId).lean();
    if (!before) return { success: false, message: "Company not found" };

    const chosenAddOns = [...new Set(addOns)].filter(
      (k) => FEATURE_KEYS.includes(k) && !plan.features.includes(k)
    );
    const priced = quote({
      companies: [
        {
          label: before.name,
          planKey,
          officeStaff: usage.officeStaff,
          workers: usage.workers,
          storageGb: usage.storageGb || 0,
          addOns: chosenAddOns,
          extraCompany: Boolean(extraCompany),
        },
      ],
      cycle,
      discountPercent,
      plans: pricing.plans,
      settings: pricing.settings,
    });

    const set = {
      "billing.plan": plan.key,
      "billing.cycle": priced.cycle,
      "billing.discountPercent": priced.discountPercent,
      "billing.addOns": chosenAddOns,
      "billing.extraCompany": Boolean(extraCompany),
      "billing.quotedMonthlyPence": priced.monthlyNetPence,
      "billing.quotedPeriodPence": priced.periodNetPence,
      "billing.planAppliedAt": new Date(),
      "billing.planAppliedBy": auth.user.email || auth.user.name || "",
    };

    // The package decides the modules — only when asked, because switching a
    // module off hides a company's records in it (nothing is deleted).
    if (matchModules) {
      const wanted = new Set([...plan.features, ...chosenAddOns]);
      const resolved = resolveFeatureDependencies(
        Object.fromEntries(FEATURE_KEYS.map((k) => [k, wanted.has(k)]))
      );
      for (const key of FEATURE_KEYS) set[`features.${key}`] = resolved[key] !== false;
    }

    // Ends the trial. A lock put on by hand stays: that is a separate
    // decision, lifted on the Access tab.
    if (markPaying) {
      set.status = "active";
      set.isActive = true;
    }
    const update = { $set: set };

    await connect();
    await CompanyModel.updateOne({ _id: createObjectId(tenantId) }, update);
    await invalidateTenantCache();
    invalidateCompanyAccess(tenantId);

    await audit(
      auth.user,
      "Platform.applyPlan",
      `Put ${before.name} on ${plan.name} (${priced.cycle})${markPaying ? " and marked as paying" : ""}`,
      {
        tenantId,
        entityId: tenantId,
        before: { billing: before.billing, status: before.status },
        after: set,
      }
    );

    return {
      success: true,
      message: `${before.name} is on ${plan.name}${markPaying ? " and marked as paying" : ""}`,
    };
  } catch (error) {
    console.log("applyPlanToCompany error:", error?.message);
    return { success: false, message: "Could not apply the plan" };
  }
}
