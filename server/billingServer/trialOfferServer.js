"use server";

import { defaultTrialDays, findUsableOffer } from "./pricingStore";

/**
 * The signup page's two questions about the free trial. Public — the page is
 * used signed out — so both answer only what the page shows anyway: how many
 * days, and whether a code works. Neither says how many times a code has been
 * used or by whom.
 */

/** How long a trial lasts, with this code or without one. */
export async function getSignupTrial(rawCode) {
  try {
    const standard = await defaultTrialDays();
    if (!rawCode) return { success: true, trialDays: standard, offer: null };
    const offer = await findUsableOffer(rawCode);
    if (!offer) {
      return {
        success: false,
        trialDays: standard,
        message: "That offer code is not valid, or has ended",
      };
    }
    return {
      success: true,
      trialDays: offer.trialDays,
      offer: { code: offer.code, label: offer.label || "" },
    };
  } catch (error) {
    console.log("getSignupTrial error:", error?.message);
    return { success: false, trialDays: 14, message: "Could not check the code" };
  }
}
