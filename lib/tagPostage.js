/**
 * What postage to add to a tag order.
 *
 * Pure, and in a lib, so the server can charge it and the order screen can
 * show it from one definition. A postage figure the customer sees and a
 * postage figure the order is written with that disagree is the kind of
 * difference somebody notices on an invoice.
 *
 * WHY THERE IS POSTAGE AT ALL. The minimum on a product is a batch minimum
 * (server/tagServer/orders.js), so a tag can now be bought one at a time. A
 * single £1.20 sticker does not cover picking it, packing it and posting it.
 * Charged per order rather than per unit, because that is what a parcel costs.
 *
 * OFF UNLESS CONFIGURED. With no policy, or a charge of zero, this returns
 * zero and no line appears — the state every deployment starts in, so nothing
 * begins quoting a charge nobody decided.
 */

/**
 * @param {number} goodsTotal the order's value before postage
 * @param {{tagPostage?: number, tagFreePostageOver?: number}} [policy]
 * @returns {number} postage to add, in the same units as goodsTotal
 */
export function postageFor(goodsTotal, policy = {}) {
  const charge = Number(policy?.tagPostage) || 0;
  if (charge <= 0) return 0;

  const freeOver = Number(policy?.tagFreePostageOver) || 0;
  // `>=`, not `>`: "free over £50" is read by everybody as including £50, and
  // charging £2.50 on an order of exactly £50 is the kind of surprise that
  // gets screenshotted.
  if (freeOver > 0 && Number(goodsTotal) >= freeOver) return 0;

  return charge;
}

/**
 * The sentence to print under a total.
 *
 * Here rather than in the screen because it has to stay true to the function
 * above: a threshold that is quoted but not applied, or applied but not
 * quoted, is worse than saying nothing.
 */
export function postageNote(policy = {}, currencyFormatter = (n) => `£${n}`) {
  const charge = Number(policy?.tagPostage) || 0;
  if (charge <= 0) return "";

  const freeOver = Number(policy?.tagFreePostageOver) || 0;
  return freeOver > 0
    ? `Postage is ${currencyFormatter(charge)}, free on orders of ${currencyFormatter(freeOver)} or more.`
    : `Postage is ${currencyFormatter(charge)} per order.`;
}
