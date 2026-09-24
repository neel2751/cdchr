"use server";

import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import TagOrderModel from "@/models/tagOrderModel";
import TagProductModel from "@/models/tagProductModel";
import TagStockMovementModel from "@/models/tagStockModel";
import { getServerSideProps } from "../session/session";

/**
 * Blanks on the shelf.
 *
 * CLOCK_LOCATION_PLAN.md §6.9 said lead times were "a number typed into the
 * catalogue rather than anything that knows how many blanks are on the shelf".
 * This is the thing that knows.
 *
 * WHEN A BLANK IS COUNTED AS GONE
 *
 * At key issue, not at write. That looks early, and it is the only point that
 * is actually correct: fetching a key is an operator holding one physical chip,
 * about to write it. Counting at write would miss every chip that failed; and
 * counting at *both* write and failure would double-count a chip that was
 * written and then failed verification, because that is one blank, not two.
 *
 * A failed unit is reissued a new key (§6.4, and a key that may have been
 * half-written is never reused), so the retry fetches again and takes another
 * blank — which is exactly what happens on the bench. One fetch, one chip.
 *
 * STOCK NEVER REFUSES ANYTHING
 *
 * A count that says zero while an operator is holding a blank is the count
 * being wrong, not the blank being imaginary. So a shortfall warns, loudly and
 * everywhere it is relevant, and blocks nothing. The alternative is a screen
 * that stops a real person doing a thing they are physically doing.
 */

async function requirePlatformAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { ok: false, message: "Not signed in" };
  if (user.role !== "platformAdmin") {
    return { ok: false, message: "Not authorized" };
  }
  return { ok: true, user };
}

/**
 * Rebuild one product's cached count from the ledger.
 *
 * Summed rather than incremented, so a cache that has drifted — a crash
 * between two writes, a movement deleted by hand — heals on the next movement
 * instead of staying wrong for ever.
 */
async function recountStock(sku) {
  const [row] = await TagStockMovementModel.aggregate([
    { $match: { sku } },
    { $group: { _id: null, total: { $sum: "$delta" } } },
  ]);
  const total = row?.total || 0;
  await TagProductModel.updateOne({ sku }, { $set: { stockOnHand: total } });
  return total;
}

/**
 * Write a movement and refresh the cache.
 *
 * Exported for the provisioning station, which consumes a blank when it issues
 * a key. Never called with a zero delta: a ledger line that changes nothing is
 * noise a reader has to skip past.
 */
export async function recordStockMovement({
  sku,
  delta,
  reason,
  orderNumber,
  unitIndex,
  note,
  byName,
} = {}) {
  if (!sku || !delta) return null;

  await connect();
  await escapeTenant("tag stock: record a movement", () =>
    TagStockMovementModel.create({
      sku,
      delta,
      reason,
      orderNumber,
      unitIndex,
      note,
      byName,
      at: new Date(),
    }),
  );
  return escapeTenant("tag stock: recount", () => recountStock(sku));
}

/**
 * What we have, what is spoken for, and what is actually free.
 *
 * "Committed" is the part a bare shelf count gets wrong: twenty blanks with
 * eighteen already promised to an accepted order is two available, not twenty,
 * and ordering against the twenty is how the next customer waits a fortnight.
 */
export async function getStockLevels() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const products = await escapeTenant("tag stock: products", () =>
      TagProductModel.find({})
        .select("sku name stockOnHand reorderLevel leadTimeDays isActive")
        .sort({ name: 1 })
        .lean(),
    );

    // Units on live orders that have not taken a blank yet. An order that is
    // cancelled, or delivered, or whose units are already written, commits
    // nothing.
    const openOrders = await escapeTenant("tag stock: open orders", () =>
      TagOrderModel.find({
        status: {
          $in: ["placed", "accepted", "provisioning", "partially-shipped"],
        },
      })
        .select("items units status")
        .lean(),
    );

    const committed = new Map();
    for (const order of openOrders) {
      // One product per order in practice, but the model allows several, so
      // the commitment is attributed to the first item rather than guessed
      // across all of them — a wrong attribution is worse than a coarse one.
      const sku = order.items?.[0]?.productSku;
      if (!sku) continue;
      const waiting = (order.units || []).filter((u) =>
        ["pending", "keyed"].includes(u.status),
      ).length;
      if (waiting) committed.set(sku, (committed.get(sku) || 0) + waiting);
    }

    const levels = products.map((p) => {
      const spokenFor = committed.get(p.sku) || 0;
      const available = (p.stockOnHand || 0) - spokenFor;
      return {
        ...p,
        committed: spokenFor,
        available,
        // Two different warnings. `short` means we cannot fulfil what is
        // already promised; `low` means we can, but only just.
        short: available < 0,
        low: available >= 0 && p.reorderLevel > 0 && available <= p.reorderLevel,
      };
    });

    return { success: true, data: JSON.stringify(levels) };
  } catch (error) {
    console.log("Error loading stock levels:", error);
    return { success: false, message: "Could not load stock" };
  }
}

/** The ledger for one product, newest first. */
export async function getStockHistory({ sku, limit = 50 } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!sku) return { success: false, message: "Which product?" };

    await connect();
    const rows = await escapeTenant("tag stock: history", () =>
      TagStockMovementModel.find({ sku })
        .sort({ at: -1 })
        .limit(Math.min(200, Number(limit) || 50))
        .lean(),
    );

    return { success: true, data: JSON.stringify(rows) };
  } catch (error) {
    console.log("Error loading stock history:", error);
    return { success: false, message: "Could not load that history" };
  }
}

/** A delivery of blanks arrived. */
export async function receiveStock({ sku, quantity, note } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const count = Number(quantity);
    if (!Number.isFinite(count) || count <= 0) {
      return { success: false, message: "How many arrived?" };
    }

    await connect();
    const product = await escapeTenant("tag stock: find product", () =>
      TagProductModel.findOne({ sku }).select("name").lean(),
    );
    if (!product) return { success: false, message: "Unknown product" };

    const total = await recordStockMovement({
      sku,
      delta: Math.round(count),
      reason: "received",
      note: (note || "").trim(),
      byName: auth.user.name,
    });

    await logAuditDirect({
      action: "TagStock.receive",
      module: "TagProduct",
      description: `Received ${Math.round(count)} × ${sku}; now ${total} on hand`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: `${Math.round(count)} received — ${total} on hand`,
    };
  } catch (error) {
    console.log("Error receiving stock:", error);
    return { success: false, message: "Could not record that delivery" };
  }
}

/**
 * A stocktake: "there are actually this many".
 *
 * Takes the counted total and writes the difference, rather than taking a
 * difference and trusting the caller to have worked it out. A person at a
 * shelf knows what they counted; making them subtract is how a correction
 * becomes a second error.
 */
export async function adjustStock({ sku, countedTotal, note } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const counted = Number(countedTotal);
    if (!Number.isFinite(counted) || counted < 0) {
      return { success: false, message: "What did the count come to?" };
    }

    await connect();
    const product = await escapeTenant("tag stock: find product", () =>
      TagProductModel.findOne({ sku }).select("stockOnHand").lean(),
    );
    if (!product) return { success: false, message: "Unknown product" };

    const delta = Math.round(counted) - (product.stockOnHand || 0);
    if (!delta) {
      return { success: true, message: "That matches the count already held" };
    }

    const total = await recordStockMovement({
      sku,
      delta,
      reason: "adjusted",
      note:
        (note || "").trim() ||
        `Stocktake: counted ${Math.round(counted)}, held ${product.stockOnHand || 0}`,
      byName: auth.user.name,
    });

    await logAuditDirect({
      action: "TagStock.adjust",
      module: "TagProduct",
      description: `Stocktake on ${sku}: ${delta > 0 ? "+" : ""}${delta}, now ${total}`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: `Adjusted by ${delta > 0 ? "+" : ""}${delta} — ${total} on hand`,
    };
  } catch (error) {
    console.log("Error adjusting stock:", error);
    return { success: false, message: "Could not adjust that count" };
  }
}

/** Set the level below which a product is flagged as running out. */
export async function setReorderLevel({ sku, reorderLevel } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const level = Number(reorderLevel);
    if (!Number.isFinite(level) || level < 0) {
      return { success: false, message: "Invalid reorder level" };
    }

    await connect();
    const res = await escapeTenant("tag stock: set reorder level", () =>
      TagProductModel.updateOne(
        { sku },
        { $set: { reorderLevel: Math.round(level) } },
      ),
    );
    if (!res.matchedCount) return { success: false, message: "Unknown product" };

    return { success: true, message: "Reorder level saved" };
  } catch (error) {
    console.log("Error setting a reorder level:", error);
    return { success: false, message: "Could not save that" };
  }
}
