"use server";

import { randomBytes } from "node:crypto";

import { connect } from "@/db/db";
import { createObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";
import TagOrderModel from "@/models/tagOrderModel";
import TagProductModel from "@/models/tagProductModel";
import { carrierName, trackingUrl } from "@/data/carriers";
import { isValidUkPostcode, normalisePostcode } from "@/lib/postcode";
import { escapeTenant } from "@/lib/tenantContext";
import { outstandingUnits } from "@/lib/tagOrderStatus";
import {
  availableToOrder,
  orderQuantityRefusal,
} from "@/lib/tagStock";
import { getServerSideProps } from "../session/session";

/**
 * Ordering physical tags.
 *
 * The customer's whole mental model should be "I ordered twenty tags and they
 * work". Nothing about AES reaches them: keys are generated during fulfilment
 * and never leave the server (lib/tagKeys.js).
 *
 * Billing is deliberately out of scope for the first cut — the order carries a
 * total for reference and the invoice happens outside the app. Half-building a
 * checkout costs more than adding one properly later.
 * See CLOCK_LOCATION_PLAN.md §6.3 and §6.8.
 */

/**
 * Promise blanks to an order, atomically.
 *
 * This is the whole reason reservedUnits is a stored counter rather than a
 * query over the open orders: acceptance is ONE conditional update on the
 * product document, so two customers ordering the last blank at the same
 * moment cannot both be told yes. Checking availability and then writing an
 * order are two steps, and between them is exactly where the second customer
 * gets a promise we cannot keep.
 *
 * `requireStock` is the stock-served case, where the condition does the work.
 * A batch order does not need the condition — it is being made, not picked —
 * but it is still recorded, because those units will come off the shelf when
 * their keys are issued and the next customer should see that.
 *
 * Returns false only when the shelf moved under a stock-served order.
 */
async function reserveUnits(sku, quantity, { requireStock }) {
  if (!requireStock) {
    await escapeTenant("tag stock: reserve for a batch", () =>
      TagProductModel.updateOne({ sku }, { $inc: { reservedUnits: quantity } })
    );
    return true;
  }

  const claimed = await escapeTenant("tag stock: claim from the shelf", () =>
    TagProductModel.findOneAndUpdate(
      {
        sku,
        $expr: {
          $gte: [
            {
              $subtract: [
                { $ifNull: ["$stockOnHand", 0] },
                { $ifNull: ["$reservedUnits", 0] },
              ],
            },
            quantity,
          ],
        },
      },
      { $inc: { reservedUnits: quantity } },
      { new: true }
    )
  );
  return !!claimed;
}

/** Give back what reserveUnits() took, when the order does not go ahead. */
async function releaseUnits(sku, quantity) {
  await escapeTenant("tag stock: release a reservation", () =>
    TagProductModel.updateOne({ sku }, { $inc: { reservedUnits: -quantity } })
  );
}

/** The shop. Readable by any signed-in admin; it is a price list. */
export async function getTagProducts() {
  try {
    const { props } = await getServerSideProps();
    if (!props?.session?.user?._id) {
      return { success: false, message: "Not signed in" };
    }

    await connect();
    // Selected, not the whole document. This is a price list for customers, and
    // it used to hand every tenant our inventory: stockOnHand and reorderLevel
    // say how much of each line we hold and when we reorder, which is nobody's
    // business but ours. They are read here to compute availability and do not
    // leave the server.
    const rows = await TagProductModel.find({ isActive: true })
      .select(
        "sku name chipType onMetal unitPrice currency minQuantity leadTimeDays stockOnHand reservedUnits"
      )
      .sort({ chipType: 1, unitPrice: 1 })
      .lean();

    // `availableNow` rather than letting the screen read stockOnHand and work
    // it out: the rule about what may be ordered belongs on one side of the
    // wire, and the raw figure is not the answer anyway — it does not account
    // for what other companies have already ordered and nobody has made yet.
    const catalogue = rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      chipType: row.chipType,
      onMetal: row.onMetal,
      unitPrice: row.unitPrice,
      currency: row.currency,
      minQuantity: row.minQuantity,
      leadTimeDays: row.leadTimeDays,
      availableNow: availableToOrder(row),
    }));

    return { success: true, data: JSON.stringify(catalogue) };
  } catch (error) {
    console.log("Error loading the tag catalogue:", error);
    return { success: false, message: "Could not load the catalogue" };
  }
}

/** This company's orders, newest first. */
export async function getTagOrders() {
  try {
    const { props } = await getServerSideProps();
    const role = props?.session?.user?.role;
    if (!["superAdmin", "admin"].includes(role)) {
      return { success: false, message: "Not authorized" };
    }

    await connect();
    const rows = await TagOrderModel.find({})
      .sort({ createdAt: -1 })
      .limit(50)
      // `units` carries sealed key material. It has no business leaving the
      // server for a customer screen that only shows progress.
      .select("-units.keyRef")
      .lean();

    // Progress and delivery, without exposing the manufacturing detail.
    //
    // The tracking URL is built here rather than on the client so the carrier
    // list has one home. A carrier we have no template for — or a shipment
    // with no reference yet — comes back with `trackingUrl: null`, and the
    // screen shows the plain reference instead of a link that goes nowhere.
    const summarised = rows.map((o) => ({
      ...o,
      units: undefined,
      unitCount: o.units?.length || 0,
      readyCount:
        o.units?.filter((u) => ["verified", "shipped"].includes(u.status))
          .length || 0,
      outstandingCount: outstandingUnits(o),
      returnedCount:
        o.units?.filter((u) => ["returned", "replaced"].includes(u.status))
          .length || 0,
      shipments: (o.shipments || []).map((s) => ({
        ...s,
        carrierName: carrierName(s.carrier),
        trackingUrl: trackingUrl(s.carrier, s.trackingRef),
        unitCount: s.unitIndexes?.length || 0,
        // The indexes are manufacturing detail; the count is what a customer
        // needs. Kept off the wire rather than rendered and ignored.
        unitIndexes: undefined,
      })),
    }));

    return { success: true, data: JSON.stringify(summarised) };
  } catch (error) {
    console.log("Error loading tag orders:", error);
    return { success: false, message: "Could not load orders" };
  }
}

/** Human-readable, unique, and not guessable as a sequence. */
function orderNumber() {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `TAG-${stamp}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export const placeTagOrder = withAudit(
  "TagOrder.place",
  async ({ items = [], shippingAddress, shipTo = {}, notes } = {}) => {
    try {
      const { props } = await getServerSideProps();
      const user = props?.session?.user;
      if (!user?._id) return { success: false, message: "Not signed in" };
      if (user.role !== "superAdmin") {
        return { success: false, message: "Not authorized" };
      }
      if (!Array.isArray(items) || items.length === 0) {
        return { success: false, message: "Add something to the order first" };
      }
      if (!shippingAddress?.trim()) {
        return { success: false, message: "A delivery address is required" };
      }
      // The parts a postage label needs. Collected rather than parsed out of
      // the free text above: deciding which typed line is the city is a guess,
      // and a wrong guess delivers the parcel somewhere else without anything
      // looking broken.
      if (!shipTo?.line1?.trim() || !shipTo?.city?.trim()) {
        return {
          success: false,
          message: "The street and town are needed separately for the postage label",
        };
      }
      // Format only, and only for the UK. Decided offline against the
      // government's own pattern, so it needs nobody's permission and cannot
      // fail because a third party is down. Whether the postcode *exists* is a
      // warning on the form, never a refusal — see server/addressServer.
      const country = (shipTo.countryCode || "GB").trim().toUpperCase();
      if (country === "GB") {
        const typed = (shipTo.postcode || "").trim();
        if (!typed) {
          return {
            success: false,
            message: "A postcode is needed — nothing can be delivered without one.",
          };
        }
        if (!isValidUkPostcode(typed)) {
          return {
            success: false,
            message: `"${typed}" is not a valid UK postcode.`,
          };
        }
      }

      await connect();

      // Priced from the catalogue, never from the request. A total the client
      // computed is a total the client chose.
      const skus = items.map((i) => i.productSku);
      const products = await TagProductModel.find({
        sku: { $in: skus },
        isActive: true,
      }).lean();
      const bySku = new Map(products.map((p) => [p.sku, p]));

      const lines = [];
      let total = 0;
      for (const item of items) {
        const product = bySku.get(item.productSku);
        if (!product) {
          return { success: false, message: `"${item.productSku}" is not available` };
        }
        const quantity = Math.floor(Number(item.quantity));
        if (!Number.isFinite(quantity) || quantity < 1) {
          return { success: false, message: `Invalid quantity for ${product.name}` };
        }
        // The minimum is a PRODUCTION minimum, so it only applies to an order
        // that needs production.
        //
        // It used to apply to every order, which read as arbitrary from the
        // customer's side and was: a company with five offices that opens a
        // sixth had to buy five more tags to get one. Printing and encoding a
        // single tag does have a setup cost that one unit's price will not
        // cover — that is what the minimum is protecting — but shipping one
        // off the shelf does not. Blanks on the shelf are the whole reason
        // stockOnHand and reorderLevel exist, and until now nothing at the
        // point of sale consulted either.
        //
        // So: any quantity we can ship from stock, or the configured minimum
        // when a batch has to be made. Restocking in bulk stays the platform's
        // job, which is what reorderLevel is for.
        const refusal = orderQuantityRefusal(product, quantity);
        if (refusal === "below-minimum-with-stock") {
          const available = availableToOrder(product);
          return {
            success: false,
            message: `${product.name}: ${available} in stock. Order up to ${available}, or ${product.minQuantity}+ for a new batch.`,
          };
        }
        if (refusal === "below-minimum-no-stock") {
          return {
            success: false,
            message: `${product.name} is out of stock, so this is a new batch — minimum ${product.minQuantity}.`,
          };
        }

        lines.push({
          productSku: product.sku,
          productName: product.name,
          quantity,
          unitPrice: product.unitPrice,
          customisation: {
            text: item.customisation?.text?.trim() || undefined,
            colour: item.customisation?.colour || undefined,
          },
        });
        total += product.unitPrice * quantity;
      }

      const currency = products[0]?.currency || "GBP";

      // Reserve before writing the order, so an order that cannot be honoured
      // is never created. Each line is claimed on its own and anything already
      // claimed is given back if a later line fails — a partial promise is
      // worse than a refusal, because nobody is waiting on a refusal.
      const reserved = [];
      for (const line of lines) {
        const product = bySku.get(line.productSku);
        const fromStock = line.quantity <= availableToOrder(product);
        const ok = await reserveUnits(line.productSku, line.quantity, {
          requireStock: fromStock,
        });
        if (!ok) {
          for (const done of reserved) {
            await releaseUnits(done.productSku, done.quantity);
          }
          // Only reachable when another order claimed the same blanks between
          // the check above and this write. Saying so is better than a generic
          // failure: the quantity was fine a moment ago and the customer has
          // done nothing wrong.
          return {
            success: false,
            message: `${product.name} was just taken by another order. Try a smaller number, or ${product.minQuantity}+ for a new batch.`,
          };
        }
        reserved.push(line);
      }

      const order = await TagOrderModel.create({
        orderNumber: orderNumber(),
        status: "placed",
        items: lines,
        units: [],
        currency,
        total,
        shippingAddress: shippingAddress.trim(),
        shipTo: {
          name: (shipTo.name || "").trim(),
          company: (shipTo.company || "").trim(),
          line1: shipTo.line1.trim(),
          line2: (shipTo.line2 || "").trim(),
          city: shipTo.city.trim(),
          // Canonical form on the way in: carriers vary in how forgiving they
          // are about "sw1a1aa", and one postcode stored three ways cannot be
          // grouped or compared.
          postcode: normalisePostcode(shipTo.postcode),
          countryCode: (shipTo.countryCode || "GB").trim().toUpperCase(),
        },
        notes: notes?.trim(),
        placedBy: createObjectId(user._id),
        placedByName: user.name,
        placedAt: new Date(),
      });

      recordAudit({
        entityId: order._id,
        after: { orderNumber: order.orderNumber, items: lines, total },
        description: `Ordered ${lines.reduce((n, l) => n + l.quantity, 0)} tag(s), ${order.orderNumber}`,
      });

      return {
        success: true,
        message: `Order ${order.orderNumber} placed`,
        data: JSON.stringify({ orderNumber: order.orderNumber }),
      };
    } catch (error) {
      console.log("Error placing a tag order:", error);
      return { success: false, message: "Could not place that order" };
    }
  },
  { module: "TagOrder" },
);
