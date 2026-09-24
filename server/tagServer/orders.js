"use server";

import { randomBytes } from "node:crypto";

import { connect } from "@/db/db";
import { createObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";
import TagOrderModel from "@/models/tagOrderModel";
import TagProductModel from "@/models/tagProductModel";
import { carrierName, trackingUrl } from "@/data/carriers";
import { outstandingUnits } from "@/lib/tagOrderStatus";
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

/** The shop. Readable by any signed-in admin; it is a price list. */
export async function getTagProducts() {
  try {
    const { props } = await getServerSideProps();
    if (!props?.session?.user?._id) {
      return { success: false, message: "Not signed in" };
    }

    await connect();
    const rows = await TagProductModel.find({ isActive: true })
      .sort({ chipType: 1, unitPrice: 1 })
      .lean();

    return { success: true, data: JSON.stringify(rows) };
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
        if (quantity < product.minQuantity) {
          return {
            success: false,
            message: `${product.name} has a minimum order of ${product.minQuantity}.`,
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
          postcode: (shipTo.postcode || "").trim().toUpperCase(),
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
