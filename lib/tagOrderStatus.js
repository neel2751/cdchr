/**
 * What a tag order's status should be, given its units and shipments.
 *
 * A pure function, and in a lib rather than beside the actions, because it is
 * the single definition of a fact that three screens ask about: the customer's
 * order list, the provisioning queue, and the delivery view. Two definitions
 * of "is this order shipped" is how the order list and the queue end up
 * disagreeing in front of the person on the phone.
 *
 * Derived, never set by hand. The old code set `status: "shipped"` in the ship
 * action itself, which is precisely how an order could read "shipped" with
 * half its units still on the bench — the flag recorded that somebody pressed
 * the button, not that anything had gone out.
 */

/**
 * @param order a TagOrder with `status`, `units` and `shipments`.
 * @returns one of the values in the model's status enum.
 */
export function recomputeOrderStatus(order) {
  if (order?.status === "cancelled") return "cancelled";

  const units = order?.units || [];
  const shipments = order?.shipments || [];

  if (!shipments.length) {
    // Nothing has gone out. Keep wherever provisioning had got to — but never
    // leave a stale shipped/delivered behind, which would otherwise survive
    // every shipment being removed.
    return order?.status === "shipped" || order?.status === "delivered"
      ? "accepted"
      : order?.status || "placed";
  }

  // Units still owed to the customer: not shipped, and not written off as
  // returned-and-replaced. A `failed` unit is still owed — it gets retried —
  // and so is a `returned` one until a replacement is added, which is what
  // marks it `replaced`.
  const outstanding = units.filter(
    (u) => !["shipped", "replaced"].includes(u.status),
  );
  if (outstanding.length) return "partially-shipped";

  // Everything is out. Delivered only when every box has arrived: one
  // outstanding parcel means the order has not landed.
  return shipments.every((s) => s.deliveredAt) ? "delivered" : "shipped";
}

/** How many units the customer is still waiting on. */
export function outstandingUnits(order) {
  return (order?.units || []).filter(
    (u) => !["shipped", "replaced"].includes(u.status),
  ).length;
}

/** Plain English for a status, for a screen that should not show a slug. */
export const ORDER_STATUS_LABEL = {
  placed: "Placed",
  accepted: "Accepted",
  provisioning: "Being made",
  "partially-shipped": "Part shipped",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
