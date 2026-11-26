"use server";

import { connect } from "@/db/db";
import { isValidObjectId } from "@/lib/mongodb";
import { recordAudit, withAudit } from "@/lib/audit";
import BillingAccountModel from "@/models/billingAccountModel";
import CompanyModel from "@/models/companyModel";
import { getServerSideProps } from "../session/session";
import { accountOf, ensureAccount } from "./accountStore";
import { cardSetupSession, removeCard, saveCardFromSession } from "./cardStore";
import { secretKey } from "./stripeCore";

/**
 * How a company pays, for its own super admin on Plan & Billing: the saved
 * card, adding or removing one, and choosing between paying by card each
 * month and being sent an invoice.
 *
 * The bill belongs to the customer's account (accountStore.js), so only the
 * super admin of its MAIN company manages it. An extra company's owner sees
 * who pays.
 */

async function requireBillingOwner() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { error: "Not signed in" };
  if (user.role !== "superAdmin" || !isValidObjectId(user.tenantId)) {
    return { error: "Only the company's super admin manages how it pays" };
  }
  await connect();
  const company = await CompanyModel.findById(user.tenantId)
    .select("name slug status billing")
    .lean();
  if (!company) return { error: "Company not found" };
  const account = await accountOf(company);
  const isMain = !account || String(account.primaryCompanyId) === String(company._id);
  let mainName = "";
  if (!isMain && account?.primaryCompanyId) {
    mainName =
      (await CompanyModel.findById(account.primaryCompanyId).select("name").lean())?.name || "";
  }
  return { user, company, account, isMain, mainName };
}

// A demo company is shown, not sold: nobody adds a card to it. (Read-only for
// an unpaid bill must still be able to — paying is how it reopens — so this
// asks about the demo, not about read-only.)
const DEMO_REFUSAL = {
  success: false,
  message: "This is a demo company, so payment details cannot be added",
};

const cardView = (account) =>
  account?.card?.paymentMethodId
    ? {
        brand: account.card.brand,
        last4: account.card.last4,
        expMonth: account.card.expMonth,
        expYear: account.card.expYear,
      }
    : null;

/** How this company's bill is paid, and when the next one is. */
export async function getMyPayment() {
  try {
    const auth = await requireBillingOwner();
    if (auth.error) return { success: false, message: auth.error };
    const { company, account, isMain, mainName } = auth;

    // The next bill: the earliest date any company on the account is paid up to.
    const companies = account
      ? await CompanyModel.find({ "billing.accountId": account._id, delete: { $ne: true } })
          .select("billing.paidThrough")
          .lean()
      : [company];
    const dates = companies.map((c) => c.billing?.paidThrough).filter(Boolean).map((d) => new Date(d));
    const nextBillAt = dates.length ? new Date(Math.min(...dates)) : null;

    return {
      success: true,
      data: JSON.stringify({
        canManage: isMain,
        mainCompany: mainName,
        paymentMethod: account?.paymentMethod || "invoice",
        card: cardView(account),
        cardFailedAt: account?.cardFailedAt || null,
        cardFailure: account?.cardFailure || "",
        stripeReady: Boolean(await secretKey().catch(() => null)),
        nextBillAt,
        onPlan: Boolean(company.billing?.planAppliedAt),
      }),
    };
  } catch (error) {
    console.log("getMyPayment error:", error?.message);
    return { success: false, message: "Could not load how you pay" };
  }
}

/** A Stripe page to add (or replace) the card. The card never reaches us. */
export async function startCardSetup({ returnUrl } = {}) {
  try {
    const auth = await requireBillingOwner();
    if (auth.error) return { success: false, message: auth.error };
    if (auth.company.billing?.demo) return DEMO_REFUSAL;
    if (!auth.isMain) {
      return { success: false, message: `Your bill is paid by ${auth.mainName}` };
    }
    // A company billed on its own gets its account now: the card belongs to it.
    const account = await ensureAccount(auth.company);
    const url = await cardSetupSession(account, returnUrl);
    return { success: true, data: JSON.stringify({ url }) };
  } catch (error) {
    console.log("startCardSetup error:", error?.message);
    return { success: false, message: error?.message || "Could not open the card page" };
  }
}

/** Back from Stripe's page: keep the card it saved. */
export async function finishCardSetup({ sessionId } = {}) {
  try {
    const auth = await requireBillingOwner();
    if (auth.error) return { success: false, message: auth.error };
    if (auth.company.billing?.demo) return DEMO_REFUSAL;
    if (!auth.account) return { success: false, message: "No card was being added" };
    const outcome = await saveCardFromSession(sessionId, {
      expectAccountId: auth.account._id,
    });
    const saved = outcome.startsWith("saved");
    if (saved) {
      recordAudit({
        module: "Tenant",
        entityId: String(auth.account._id),
        description: `Card ${outcome.replace(/^saved /, "")}`,
      });
    }
    const paid = outcome.match(/; paid (.+?)(;|$)/)?.[1];
    const notPaid = outcome.match(/; could not pay (.+)$/)?.[1];
    return {
      success: saved,
      message: !saved
        ? `Card not saved: ${outcome}`
        : paid
          ? `Card saved, and ${paid} paid with it`
          : notPaid
            ? `Card saved, but it could not pay ${notPaid}`
            : "Card saved — your bills will be paid with it",
    };
  } catch (error) {
    console.log("finishCardSetup error:", error?.message);
    return { success: false, message: "Could not save the card" };
  }
}

/** Pay by card each month, or be sent an invoice. */
export const setMyPaymentMethod = withAudit(
  "Tenant.paymentMethod",
  async (method) => {
    try {
      const auth = await requireBillingOwner();
      if (auth.error) return { success: false, message: auth.error };
      if (auth.company.billing?.demo) return DEMO_REFUSAL;
      if (!auth.isMain) {
        return { success: false, message: `Your bill is paid by ${auth.mainName}` };
      }
      if (!["card", "invoice"].includes(method)) {
        return { success: false, message: "Unknown choice" };
      }
      const account = await ensureAccount(auth.company);
      if (method === "card" && !account.card?.paymentMethodId) {
        return { success: false, message: "Add a card first" };
      }
      await BillingAccountModel.updateOne(
        { _id: account._id },
        { $set: { paymentMethod: method } }
      );
      return {
        success: true,
        message:
          method === "card"
            ? "Your card will be charged for each bill"
            : "Your bills will be sent as invoices",
      };
    } catch (error) {
      console.log("setMyPaymentMethod error:", error?.message);
      return { success: false, message: "Could not save that" };
    }
  },
  { module: "Tenant" }
);

/** Forget the card, here and at Stripe. Bills then come as invoices. */
export const removeMyCard = withAudit(
  "Tenant.removeCard",
  async () => {
    try {
      const auth = await requireBillingOwner();
      if (auth.error) return { success: false, message: auth.error };
      if (auth.company.billing?.demo) return DEMO_REFUSAL;
      if (!auth.isMain || !auth.account) {
        return { success: false, message: "There is no card to remove" };
      }
      await removeCard(auth.account);
      return { success: true, message: "Card removed — bills will come as invoices" };
    } catch (error) {
      console.log("removeMyCard error:", error?.message);
      return { success: false, message: "Could not remove the card" };
    }
  },
  { module: "Tenant" }
);
