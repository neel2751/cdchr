import { escapeTenant } from "@/lib/tenantContext";
import InvoiceCounterModel from "@/models/invoiceCounterModel";
import PlatformSettingModel from "@/models/platformSettingModel";

/**
 * The parts of invoicing that have no caller to check: the number sequence
 * and our own details as the seller. Shared by the console's actions
 * (invoices.js) and the monthly billing run (subscriptionBilling.js), which
 * runs from a cron job with nobody signed in.
 *
 * NOT "use server": allocating an invoice number is not something a browser
 * may ask for.
 */

/**
 * The next invoice number, allocated atomically.
 *
 * One findOneAndUpdate with $inc and upsert. Reading the highest number and
 * adding one would be a race, and two invoices sharing a number is not
 * something that can be fixed afterwards — the copies are already out.
 *
 * Called only at issue. A draft that is abandoned must not consume a number,
 * or the sequence has a gap for something that never existed.
 */
export async function allocateNumber() {
  const year = new Date().getUTCFullYear();
  const counter = await escapeTenant("invoicing: allocate a number", () =>
    InvoiceCounterModel.findOneAndUpdate(
      { year },
      { $inc: { lastNumber: 1 } },
      { upsert: true, new: true },
    ).lean(),
  );
  return `INV-${year}-${String(counter.lastNumber).padStart(4, "0")}`;
}

/** Our billing identity as it stands right now, to be frozen onto an invoice. */
export async function sellerDetails() {
  const settings = await escapeTenant("invoicing: our details", () =>
    PlatformSettingModel.findOne({ singleton: "only" }).lean(),
  );
  return {
    settings: settings || {},
    seller: {
      name: settings?.billingName || settings?.dispatchFromName || "",
      address: settings?.billingAddress || settings?.dispatchFromAddress || "",
      vatNumber: settings?.vatNumber || "",
      companyNumber: settings?.companyNumber || "",
    },
  };
}
