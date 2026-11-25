import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import { formatMoney, outstanding } from "@/lib/money";
import { daysOverdue, unpaidLevel } from "@/lib/billing";
import CompanyModel from "@/models/companyModel";
import InvoiceModel from "@/models/invoiceModel";
import { invalidateCompanyAccess } from "../tenantServer/tenantAccessState";
import { loadPricing } from "./pricingStore";

/**
 * An unpaid plan bill locks the customer's companies; paying it reopens them.
 *
 * Looks at the oldest overdue plan bill on each account and sets every one of
 * its companies to what that calls for (lib/billing.js unpaidLevel): nothing,
 * read-only after a week, locked after two. The lock it puts on is marked
 * `auto`, and only an `auto` lock is ever lifted here — a lock a person put on
 * is a person's to take off.
 *
 * Tag-order invoices never lock anybody: a late payment for stickers is not
 * a reason to stop a company working.
 *
 * Run daily by the billing job, and straight after any payment is recorded,
 * so paying reopens the account at once rather than tomorrow.
 *
 * NOT "use server".
 */

async function oldestOverdue(accountId, now) {
  const invoices = await escapeTenant("billing: unpaid plan bills", () =>
    InvoiceModel.find({
      source: "subscription",
      accountId,
      status: { $in: ["issued", "part-paid"] },
      dueAt: { $lt: now },
    })
      .sort({ dueAt: 1 })
      .lean()
  );
  return invoices.find((inv) => outstanding(inv.grossPence, inv.payments) > 0) || null;
}

/**
 * @param {{ accountId?: any, now?: Date }} [o] one account, or every account
 *   with an unpaid plan bill or an automatic lock
 * @returns {Promise<{ locked: number, readOnly: number, reopened: number }>}
 */
export async function syncPaymentLocks({ accountId, now = new Date() } = {}) {
  await connect();
  const { settings } = await loadPricing();
  const tally = { locked: 0, readOnly: 0, reopened: 0 };

  let accountIds;
  if (accountId) {
    accountIds = [accountId];
  } else {
    const [owing, autoLocked] = await Promise.all([
      escapeTenant("billing: accounts owing", () =>
        InvoiceModel.distinct("accountId", {
          source: "subscription",
          status: { $in: ["issued", "part-paid"] },
        })
      ),
      CompanyModel.distinct("billing.accountId", { "billing.lock.auto": true }),
    ]);
    const seen = new Set();
    accountIds = [...owing, ...autoLocked].filter((id) => {
      if (!id || seen.has(String(id))) return false;
      seen.add(String(id));
      return true;
    });
  }

  for (const id of accountIds) {
    const invoice = await oldestOverdue(id, now);
    const days = invoice ? daysOverdue(invoice.dueAt, now) : 0;
    const level = unpaidLevel(days, settings);
    const message = invoice
      ? `Invoice ${invoice.number} (${formatMoney(outstanding(invoice.grossPence, invoice.payments), invoice.currency)}) is ${days} day${days === 1 ? "" : "s"} overdue. Pay it on Plan & Billing to reopen everything.`
      : "";

    const companies = await CompanyModel.find({
      "billing.accountId": id,
      delete: { $ne: true },
    })
      .select("billing.lock")
      .lean();

    for (const company of companies) {
      const lock = company.billing?.lock;
      // A person's lock: theirs to lift, whatever the bills say.
      if (lock?.level && !lock.auto) continue;

      if (level) {
        if (lock?.auto && lock.level === level && lock.message === message) continue;
        await CompanyModel.updateOne(
          { _id: company._id },
          {
            $set: {
              "billing.lock": { level, message, at: new Date(), by: "billing", auto: true },
            },
          }
        );
        tally[level === "locked" ? "locked" : "readOnly"] += 1;
        invalidateCompanyAccess(company._id);
      } else if (lock?.auto) {
        await CompanyModel.updateOne({ _id: company._id }, { $unset: { "billing.lock": "" } });
        tally.reopened += 1;
        invalidateCompanyAccess(company._id);
      }
    }
  }
  return tally;
}
