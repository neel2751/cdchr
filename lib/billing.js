/**
 * The arithmetic of the monthly bill: billing periods, the lines on the
 * invoice, and when an unpaid one locks the customer out.
 *
 * Pure, so the billing run (server/billingServer/subscriptionBilling.js), the
 * console's preview and the tests agree to the penny.
 */

/**
 * The same day next month — or next year — in UTC. A month-end start keeps to
 * the month's end: 31 January is followed by 28 (or 29) February, then 31
 * March, not 3 March.
 */
export function addPeriod(date, cycle = "monthly") {
  const d = new Date(date);
  const months = cycle === "yearly" ? 12 : 1;
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Midnight UTC on the day of `date` — periods run whole days. */
export function dayStart(date = new Date()) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const fmtDay = (d) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * One company's lines on the invoice, from its quote (lib/pricing.js quote()).
 *
 * Monthly: the quote's lines as they are. Yearly: each line for twelve
 * months, then the yearly discount. Either way a deal discount is its own
 * line, so the customer can see it. The lines total exactly the quote's
 * periodNetPence.
 *
 * @param {object} o
 * @param {string} o.companyName
 * @param {object} o.result     a quote() for this one company
 * @param {Date} o.from
 * @param {Date} o.to
 * @param {number} o.vatRateBasisPoints
 */
export function invoiceLinesFor({ companyName, result, from, to, vatRateBasisPoints }) {
  const yearly = result.cycle === "yearly";
  const months = yearly ? 12 : 1;
  const period = `${fmtDay(from)} – ${fmtDay(to)}`;
  const vat = vatRateBasisPoints;
  const lines = [];

  for (const line of result.companies[0]?.lines || []) {
    lines.push({
      description: `${companyName}: ${line.label}${yearly ? " (12 months)" : ""}, ${period}`,
      quantity: line.quantity * months,
      unitPricePence: line.unitPence,
      vatRateBasisPoints: vat,
    });
  }
  if (result.discountPence > 0) {
    lines.push({
      description: `${companyName}: deal discount (${result.discountPercent}%)`,
      quantity: months,
      unitPricePence: -result.discountPence,
      vatRateBasisPoints: vat,
    });
  }
  if (result.yearlyDiscountPence > 0) {
    lines.push({
      description: `${companyName}: yearly billing discount (${result.yearlyDiscountPercent}%)`,
      quantity: 1,
      unitPricePence: -result.yearlyDiscountPence,
      vatRateBasisPoints: vat,
    });
  }
  return lines;
}

/**
 * What an unpaid bill does to the customer, `daysOverdue` days past its due
 * date: nothing, read-only, or locked. A setting of 0 switches that step off.
 */
export function unpaidLevel(daysOverdue, { unpaidReadOnlyDays = 7, unpaidLockDays = 14 } = {}) {
  if (!Number.isFinite(daysOverdue) || daysOverdue <= 0) return null;
  if (unpaidLockDays > 0 && daysOverdue >= unpaidLockDays) return "locked";
  if (unpaidReadOnlyDays > 0 && daysOverdue >= unpaidReadOnlyDays) return "readOnly";
  return null;
}

/** Whole days from `due` to `now`, positive once overdue. */
export function daysOverdue(dueAt, now = new Date()) {
  if (!dueAt) return 0;
  return Math.floor((new Date(now) - new Date(dueAt)) / 86400000);
}
