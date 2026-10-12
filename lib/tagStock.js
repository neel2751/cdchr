/**
 * How many blanks of a product are actually free.
 *
 * One definition, because there were two and they disagreed.
 *
 * getStockLevels() in server/tagServer/stock.js computed commitment from the
 * open orders and counted units in `pending` OR `keyed`. The ordering path
 * needed the same answer, and a second implementation of "available" is the
 * kind of thing that stays consistent for about a month.
 *
 * WHY `keyed` MUST NOT COUNT. Provisioning writes a stock movement of -1 at
 * the moment it issues a unit's key, so a keyed unit has already left the
 * shelf as far as stockOnHand is concerned. Counting it as committed as well
 * subtracted it twice, which made `available` pessimistic by however many
 * chips were sitting on the bench — and under the ordering rule that would
 * quote a customer a batch minimum for stock we are holding.
 *
 * So: the shelf, minus what is promised and not yet taken off it.
 *
 * Can be negative, deliberately. Negative means we have promised more than we
 * hold, which is the one thing a stock screen must be able to say out loud —
 * see `short` in getStockLevels(). Callers deciding what a customer may order
 * clamp it themselves.
 */
export function availableUnits(product) {
  const onHand = Number(product?.stockOnHand) || 0;
  const reserved = Number(product?.reservedUnits) || 0;
  return onHand - reserved;
}

/** The same, floored at zero, for "how many may I order right now". */
export function availableToOrder(product) {
  return Math.max(availableUnits(product), 0);
}

/**
 * Whether a quantity may be ordered, and why not.
 *
 * The minimum on a product is a PRODUCTION minimum: it pays for setting up a
 * print and encode run. It has no business applying to units we can pick off
 * the shelf, which is what made a company with five offices buy five more tags
 * to equip its sixth.
 *
 * Pure, so the server can enforce it and the screen can explain it without
 * either restating the rule.
 */
export function orderQuantityRefusal(product, quantity) {
  const qty = Math.floor(Number(quantity));
  if (!Number.isFinite(qty) || qty < 1) return "invalid";

  const available = availableToOrder(product);
  const minimum = Number(product?.minQuantity) || 1;

  if (qty <= available) return null; // from stock
  if (qty >= minimum) return null; // a new batch
  return available ? "below-minimum-with-stock" : "below-minimum-no-stock";
}
