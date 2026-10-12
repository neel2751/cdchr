import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import TagOrderModel from "@/models/tagOrderModel";
import TagProductModel from "@/models/tagProductModel";

/**
 * Keeping reservedUnits honest.
 *
 * NOT a "use server" module, deliberately. These two are called by other
 * server modules — provisioning when a key is issued, orders when one is
 * cancelled — and every export of a "use server" file is a public endpoint.
 * They were briefly exported from stock.js, which made two writes to our own
 * inventory counter callable by anyone; that is the mistake the rest of this
 * codebase has just been swept for, so it does not get to stand here.
 *
 * The counter itself, and why it is a stored number rather than a query, is
 * documented on models/tagProductModel.js.
 */

/**
 * Rebuild reservedUnits from the orders, the way recountStock() rebuilds
 * stockOnHand from the ledger.
 *
 * The truth is "pending units on orders that are still live". The counter is a
 * cache of it, kept so a reservation can be made in one atomic update, and a
 * cache needs a way back to the truth: the release at key issue is deliberately
 * allowed to fail rather than block the bench, so this is what fixes the drift
 * that failure leaves.
 *
 * `pending` only. A unit past that has already had its blank deducted from
 * stockOnHand — see lib/tagStock.js.
 */
export async function recountReservations(sku) {
  return escapeTenant("tag stock: recount reservations", async () => {
    const orders = await TagOrderModel.find({
      status: { $in: ["placed", "accepted", "provisioning", "partially-shipped"] },
      "items.productSku": sku,
    })
      .select("items units")
      .lean();

    let pending = 0;
    for (const order of orders) {
      // Attributed to the first item, the same assumption getStockLevels() and
      // provisioning.js already make: one product per order in practice, and a
      // coarse attribution beats a wrong one.
      if (order.items?.[0]?.productSku !== sku) continue;
      const made = (order.units || []).filter((u) => u.status !== "pending").length;
      const ordered = Number(order.items[0].quantity) || 0;
      pending += Math.max(ordered - made, 0);
    }

    await TagProductModel.updateOne({ sku }, { $set: { reservedUnits: pending } });
    return pending;
  });
}

/**
 * One kept promise. Called when a key is issued and the blank leaves the shelf.
 *
 * Floored at zero rather than allowed to go negative: a negative reservation
 * would make us look like we hold MORE than we do, which is the error that
 * oversells. recountReservations() is the way back if it ever drifts.
 */
export async function releaseReservedUnit(sku) {
  return escapeTenant("tag stock: keep a promise", () =>
    TagProductModel.updateOne(
      { sku, reservedUnits: { $gt: 0 } },
      { $inc: { reservedUnits: -1 } }
    )
  );
}
