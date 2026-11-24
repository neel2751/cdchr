import { connect } from "@/db/db";
import { runWithTenant } from "@/lib/tenantContext";
import {
  DEFAULT_PLANS,
  DEFAULT_PRICING_SETTINGS,
  normaliseOfferCode,
  offerUsable,
} from "@/lib/pricing";
import PricingPlanModel from "@/models/pricingPlanModel";
import PricingSettingModel from "@/models/pricingSettingModel";
import TrialOfferModel from "@/models/trialOfferModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";

/**
 * Reading the price list, trial offers and a company's headcount.
 *
 * NOT "use server": the signup flow, the platform console's actions and the
 * cron jobs call these on the server, with their own checks. None of it is
 * for a browser to call directly.
 */

const plain = (doc) => (doc ? JSON.parse(JSON.stringify(doc)) : doc);

/**
 * The packages and price list. A console that has never been set up starts
 * from the suggestions in lib/pricing.js — written to the database the first
 * time, so editing one plan does not leave the others imaginary.
 */
export async function loadPricing() {
  await connect();

  let settings = await PricingSettingModel.findOne({ singleton: "only" }).lean();
  if (!settings) {
    await PricingSettingModel.updateOne(
      { singleton: "only" },
      { $setOnInsert: { singleton: "only", ...DEFAULT_PRICING_SETTINGS } },
      { upsert: true }
    );
    settings = await PricingSettingModel.findOne({ singleton: "only" }).lean();
  }

  if (!(await PricingPlanModel.exists({}))) {
    // ordered:false so two first visits racing each other each insert what
    // the other did not, rather than one failing outright on the unique key.
    await PricingPlanModel.insertMany(DEFAULT_PLANS, { ordered: false }).catch(() => {});
  }
  const plans = await PricingPlanModel.find({}).sort({ sortOrder: 1, name: 1 }).lean();

  return {
    plans: plain(plans),
    settings: {
      ...DEFAULT_PRICING_SETTINGS,
      ...plain(settings),
      addOnPence: { ...(plain(settings)?.addOnPence || {}) },
    },
    reviewed: Boolean(settings?.reviewedAt),
  };
}

/** How long a trial lasts without an offer code. */
export async function defaultTrialDays() {
  try {
    await connect();
    const s = await PricingSettingModel.findOne({ singleton: "only" })
      .select("trialDays")
      .lean();
    return s?.trialDays || DEFAULT_PRICING_SETTINGS.trialDays;
  } catch {
    return DEFAULT_PRICING_SETTINGS.trialDays;
  }
}

/** The offer behind a code, if it can be used today. */
export async function findUsableOffer(rawCode) {
  const code = normaliseOfferCode(rawCode);
  if (!code) return null;
  await connect();
  const offer = await TrialOfferModel.findOne({ code }).lean();
  return offerUsable(offer) ? offer : null;
}

/**
 * Use one of an offer's places, when a company is actually created with it.
 *
 * The limit is in the filter, so two sign-ups racing for the last place get
 * one success between them — the other falls back to the standard trial
 * rather than going over.
 *
 * @returns the offer, or null if it cannot be used (any more)
 */
export async function redeemTrialOffer(rawCode) {
  const code = normaliseOfferCode(rawCode);
  if (!code) return null;
  await connect();
  const now = new Date();
  return TrialOfferModel.findOneAndUpdate(
    {
      code,
      isActive: true,
      $and: [
        { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
        { $or: [{ validUntil: null }, { validUntil: { $gte: now } }] },
        {
          $or: [
            { maxUses: null },
            { maxUses: 0 },
            { $expr: { $lt: ["$uses", "$maxUses"] } },
          ],
        },
      ],
    },
    { $inc: { uses: 1 } },
    { new: true }
  ).lean();
}

/**
 * What a company is using, as the price list counts it.
 *
 * Current people only: leavers and anyone switched off are not charged for.
 * Storage is best-effort — the bucket may be unreachable — and comes back as
 * null rather than zero when it is not known.
 */
export async function companyUsage(tenantId) {
  await connect();
  const current = { delete: { $ne: true }, isActive: { $ne: false } };
  const [officeStaff, workers] = await runWithTenant(String(tenantId), () =>
    Promise.all([
      OfficeEmployeeModel.countDocuments(current),
      EmployeModel.countDocuments(current),
    ])
  );

  let storageGb = null;
  try {
    const { tenantStorageUsage } = await import("@/server/aws/branding");
    const usage = await tenantStorageUsage(String(tenantId));
    if (usage && Number.isFinite(usage.bytes)) {
      storageGb = Math.round((usage.bytes / 1024 ** 3) * 100) / 100;
    }
  } catch (error) {
    console.log("companyUsage: storage unavailable:", error?.message);
  }

  return { officeStaff, workers, storageGb };
}
