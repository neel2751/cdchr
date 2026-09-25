/**
 * Money, in whole pence.
 *
 * Every amount in the billing code is an integer number of the smallest unit —
 * pence, cents — and never a decimal. This is not fastidiousness:
 *
 *     0.1 + 0.2 === 0.30000000000000004
 *
 * A float that is a hundredth of a penny out is invisible until somebody sums
 * a year of invoices and the total does not match the bank. Integers cannot
 * drift, and the only place a decimal exists is the string a human reads.
 *
 * The other rule with teeth is WHERE ROUNDING HAPPENS. VAT is computed on the
 * line total, once, and rounded once. Rounding each unit price and then
 * multiplying gives a different answer — on 3 items at £4.995 it is 2p out —
 * and "which of us rounded differently" is a genuinely awful afternoon.
 */

/**
 * Pounds (or a string of them) to whole pence.
 *
 * The shift is done by rewriting the EXPONENT in a string, not by multiplying
 * by 100, and that is not fussiness — it is the difference between right and
 * wrong on ordinary money:
 *
 *     1.005 * 100          === 100.49999999999999  ->  rounds to 100  ✗
 *     Number("1.005e2")    === 100.5               ->  rounds to 101  ✓
 *
 * Multiplying reuses the error already in the double; re-parsing at the
 * shifted exponent asks for the nearest double to the number a person
 * actually wrote. A penny lost here is a penny nobody finds again.
 */
export function toPence(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;

  const shifted = Number(`${n}e2`);
  // Exponential input ("1e-7") can produce a string this trick cannot read
  // back; falling through to the multiplication is still better than NaN.
  return Math.round(Number.isFinite(shifted) ? shifted : n * 100);
}

/** Whole pence back to a number of pounds, for display or for an API. */
export function toDecimal(pence) {
  return Math.round(Number(pence) || 0) / 100;
}

/** "£1,234.56". The only place money becomes a decimal string. */
export function formatMoney(pence, currency = "GBP") {
  const value = toDecimal(pence);
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    // An unknown currency code should not take a page down.
    return `${currency} ${value.toFixed(2)}`;
  }
}

/**
 * VAT on an amount, at a rate in basis points.
 *
 * Basis points — 2000 for 20%, 500 for 5%, 0 for zero-rated — because 0.2 is
 * not representable either, and a rate stored as a float re-introduces exactly
 * the problem the pence are there to avoid.
 */
export function vatOn(netPence, rateBasisPoints) {
  const net = Math.round(Number(netPence) || 0);
  const rate = Math.round(Number(rateBasisPoints) || 0);
  if (!rate) return 0;
  return Math.round((net * rate) / 10000);
}

/** Standard UK rates, as basis points. */
export const VAT_RATES = [
  { value: 2000, label: "20% — standard" },
  { value: 500, label: "5% — reduced" },
  { value: 0, label: "0% — zero rated or exempt" },
];

/**
 * Total one invoice's lines.
 *
 * Each line is `{ quantity, unitPricePence, vatRateBasisPoints }`. VAT is
 * summed per line rather than taken on the grand total, because lines may sit
 * at different rates and a single rate applied to the sum would be wrong the
 * moment one of them is zero-rated.
 */
export function totalLines(lines = []) {
  let net = 0;
  let vat = 0;

  for (const line of lines) {
    // NOT clamped to zero. A credit note is the same lines with negative
    // quantities (see models/invoiceModel.js), so clamping here would total
    // every credit note as nothing and quietly credit the customer £0.
    const quantity = Math.round(Number(line?.quantity) || 0);
    const unit = Math.round(Number(line?.unitPricePence) || 0);
    // Once, on the line total. See the note at the top of this file.
    const lineNet = quantity * unit;
    net += lineNet;
    vat += vatOn(lineNet, line?.vatRateBasisPoints);
  }

  return { netPence: net, vatPence: vat, grossPence: net + vat };
}

/** What is still owed, given what has been paid. Never negative. */
export function outstanding(grossPence, payments = []) {
  const paid = payments.reduce(
    (total, p) => total + Math.round(Number(p?.amountPence) || 0),
    0,
  );
  return Math.max(0, Math.round(Number(grossPence) || 0) - paid);
}
