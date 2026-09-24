"use server";

import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import { carrierName, trackingUrl } from "@/data/carriers";
import CompanyModel from "@/models/companyModel";
import PlatformSettingModel from "@/models/platformSettingModel";
import TagOrderModel from "@/models/tagOrderModel";
import { getServerSideProps } from "../session/session";

/**
 * What goes on a printed dispatch label.
 *
 * WHAT THIS IS NOT: a carrier's shipping label. Postage-paid labels with a
 * scannable carrier barcode are allocated by the carrier, through their own
 * account and API — Royal Mail Click & Drop, the DPD API, and so on. Producing
 * one here would mean inventing a barcode, and a parcel carrying an invented
 * barcode does not get delivered; it gets stopped. That integration is a
 * separate piece of work needing credentials we do not have.
 *
 * WHAT THIS IS: the label that goes on the box alongside whatever postage the
 * carrier produces — who it is going to, what is in it, which order and
 * shipment it belongs to, and where to send it back if it never arrives. That
 * is the part nobody needs an API for, and the part that stops a box being
 * opened to find out whose it is.
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

/** Our sender details, created empty on first read so the screen has a shape. */
export async function getDispatchSettings() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const settings = await escapeTenant("labels: dispatch settings", async () => {
      const found = await PlatformSettingModel.findOne({ singleton: "only" }).lean();
      if (found) return found;
      const made = await PlatformSettingModel.create({ singleton: "only" });
      return made.toObject();
    });

    return { success: true, data: JSON.stringify(settings) };
  } catch (error) {
    console.log("Error loading dispatch settings:", error);
    return { success: false, message: "Could not load dispatch settings" };
  }
}

/** Change our sender details. */
export async function saveDispatchSettings({
  dispatchFromName,
  dispatchFromAddress,
  dispatchContact,
  dispatchReturnNote,
} = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    await escapeTenant("labels: save dispatch settings", () =>
      PlatformSettingModel.updateOne(
        { singleton: "only" },
        {
          $set: {
            dispatchFromName: (dispatchFromName || "").trim(),
            dispatchFromAddress: (dispatchFromAddress || "").trim(),
            dispatchContact: (dispatchContact || "").trim(),
            dispatchReturnNote: (dispatchReturnNote || "").trim(),
          },
          $setOnInsert: { singleton: "only" },
        },
        { upsert: true },
      ),
    );

    return { success: true, message: "Dispatch details saved" };
  } catch (error) {
    console.log("Error saving dispatch settings:", error);
    return { success: false, message: "Could not save those details" };
  }
}

/**
 * Everything one label needs, resolved server-side.
 *
 * Assembled here rather than in the page so the label cannot print a field the
 * server would not have shown — and so a shipment that does not exist fails as
 * a refusal rather than as a half-empty label that somebody sticks on a box.
 */
export async function getShipmentLabel({ orderNumber, reference } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const order = await escapeTenant("labels: find the order", () =>
      TagOrderModel.findOne({ orderNumber }).lean(),
    );
    if (!order) return { success: false, message: "Order not found" };

    const shipment = (order.shipments || []).find(
      (s) => s.reference === reference,
    );
    if (!shipment) return { success: false, message: "Shipment not found" };

    const [company, settings] = await Promise.all([
      escapeTenant("labels: the customer", () =>
        CompanyModel.findById(order.tenantId).select("name").lean(),
      ),
      escapeTenant("labels: dispatch settings", () =>
        PlatformSettingModel.findOne({ singleton: "only" }).lean(),
      ),
    ]);

    // What is actually in this box, by product, rather than the whole order's
    // items — a partial shipment's label listing the full order is how a
    // customer opens forty tags and reports ten missing.
    const inThisBox = (order.units || []).filter((u) =>
      (shipment.unitIndexes || []).includes(u.index),
    );
    const productName =
      order.items?.[0]?.productName || order.items?.[0]?.productSku || "Tags";

    return {
      success: true,
      data: JSON.stringify({
        orderNumber: order.orderNumber,
        reference: shipment.reference,
        shipTo: {
          company: company?.name || "",
          address: order.shippingAddress || "",
        },
        from: {
          name: settings?.dispatchFromName || "",
          address: settings?.dispatchFromAddress || "",
          contact: settings?.dispatchContact || "",
          returnNote: settings?.dispatchReturnNote || "",
        },
        carrier: carrierName(shipment.carrier),
        trackingRef: shipment.trackingRef || "",
        trackingUrl: trackingUrl(shipment.carrier, shipment.trackingRef),
        parcelCount: shipment.parcelCount || 1,
        dispatchedAt: shipment.dispatchedAt,
        notes: shipment.notes || "",
        contents: [
          {
            name: productName,
            quantity: inThisBox.length,
            // The UIDs in the box. A customer with a dead tag quotes one of
            // these, and it is the difference between finding the unit on the
            // order and guessing.
            uids: inThisBox.map((u) => u.uid).filter(Boolean),
          },
        ],
        // Whether this label can actually be used. An empty sender address is
        // the one thing that makes a label useless, so the screen is told
        // rather than printing a blank half.
        senderIncomplete: !(
          settings?.dispatchFromName && settings?.dispatchFromAddress
        ),
      }),
    };
  } catch (error) {
    console.log("Error building a shipment label:", error);
    return { success: false, message: "Could not build that label" };
  }
}
