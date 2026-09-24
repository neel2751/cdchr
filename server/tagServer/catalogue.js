"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { logAuditDirect } from "@/lib/audit";
import TagOrderModel from "@/models/tagOrderModel";
import TagProductModel from "@/models/tagProductModel";
import { getServerSideProps } from "../session/session";

/**
 * The shop, from our side.
 *
 * The catalogue is platform-level (GLOBAL_MODELS in lib/tenantPlugin.js): one
 * price list every company orders from, maintained here rather than in a seed
 * script somebody has to remember to edit and re-run.
 *
 * See CLOCK_LOCATION_PLAN.md §6.2.
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

const FORM_FACTORS = ["round", "card", "keyfob", "sticker", "wristband"];
const CHIP_TYPES = ["ntag213", "ntag424"];

/** Everything, including what is currently withdrawn from sale. */
export async function getCatalogueProducts() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const rows = await TagProductModel.find({})
      .sort({ isActive: -1, chipType: 1, unitPrice: 1 })
      .lean();

    return { success: true, data: JSON.stringify(rows) };
  } catch (error) {
    console.log("Error loading the catalogue:", error);
    return { success: false, message: "Could not load the catalogue" };
  }
}

/**
 * Add a product, or change one.
 *
 * A price change applies to orders placed *after* it. Orders already placed
 * keep the price they were quoted — `placeTagOrder` copies the unit price onto
 * the order line, so changing it here cannot re-price somebody's invoice after
 * the fact.
 */
export async function saveTagProduct({
  id,
  _id,
  sku,
  name,
  formFactor,
  chipType,
  onMetal,
  weatherproof,
  unitPrice,
  currency,
  minQuantity,
  leadTimeDays,
  weightGrams,
  description,
} = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const cleanSku = (sku || "").trim().toUpperCase();
    if (!cleanSku) return { success: false, message: "A SKU is required" };
    if (!name?.trim()) return { success: false, message: "A name is required" };
    if (formFactor && !FORM_FACTORS.includes(formFactor)) {
      return { success: false, message: "Unknown form factor" };
    }
    if (chipType && !CHIP_TYPES.includes(chipType)) {
      return { success: false, message: "Unknown chip type" };
    }

    const price = Number(unitPrice);
    if (!Number.isFinite(price) || price < 0) {
      return { success: false, message: "Price must be zero or more" };
    }
    const minQty = Math.floor(Number(minQuantity));
    if (!Number.isFinite(minQty) || minQty < 1) {
      return { success: false, message: "Minimum quantity must be at least 1" };
    }
    const lead = Math.floor(Number(leadTimeDays));
    if (!Number.isFinite(lead) || lead < 0) {
      return { success: false, message: "Lead time must be zero or more days" };
    }

    await connect();

    const fields = {
      sku: cleanSku,
      name: name.trim(),
      formFactor: formFactor || "round",
      chipType: chipType || "ntag213",
      onMetal: Boolean(onMetal),
      weatherproof: Boolean(weatherproof),
      unitPrice: price,
      currency: (currency || "GBP").toUpperCase(),
      minQuantity: minQty,
      leadTimeDays: lead,
      // Every postage API prices on weight and none accepts an order without
      // it, so a product with none cannot have a label bought for it. Zero is
      // allowed — it means "not measured yet", which the dispatch screen says
      // out loud rather than guessing a number that becomes a surcharge.
      weightGrams: Math.max(0, Math.round(Number(weightGrams) || 0)),
      description: description?.trim(),
    };

    // Accept either spelling: a caller that spreads a loaded product carries
    // `_id`, and silently treating that as "new" collides on the SKU.
    const productId = id || _id;

    let before = null;
    let saved;
    if (productId && isValidObjectId(productId)) {
      before = await TagProductModel.findById(createObjectId(productId)).lean();
      if (!before) return { success: false, message: "Product not found" };
      saved = await TagProductModel.findByIdAndUpdate(
        createObjectId(productId),
        { $set: fields },
        { new: true },
      ).lean();
    } else {
      saved = (await TagProductModel.create({ ...fields, isActive: true })).toObject();
    }

    await logAuditDirect({
      action: before ? "TagProduct.update" : "TagProduct.create",
      module: "TagProduct",
      entityId: String(saved._id),
      before: before
        ? { sku: before.sku, unitPrice: before.unitPrice, name: before.name }
        : undefined,
      after: { sku: saved.sku, unitPrice: saved.unitPrice, name: saved.name },
      description: before
        ? `Updated ${saved.sku}${
            before.unitPrice !== saved.unitPrice
              ? ` (price ${before.unitPrice} → ${saved.unitPrice})`
              : ""
          }`
        : `Added ${saved.sku} to the catalogue`,
      actor: auth.user,
    }).catch(() => {});

    return { success: true, message: before ? "Product updated" : "Product added" };
  } catch (error) {
    if (error?.code === 11000) {
      return { success: false, message: "That SKU already exists" };
    }
    console.log("Error saving a product:", error);
    return { success: false, message: "Could not save that product" };
  }
}

/**
 * Withdraw a product from sale, or put it back.
 *
 * Never deleted. Orders reference a SKU, and a product that vanishes turns
 * every order that bought it into a row nobody can explain.
 */
export async function setTagProductActive({ id, isActive } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid product" };
    }

    await connect();
    const product = await TagProductModel.findByIdAndUpdate(
      createObjectId(id),
      { $set: { isActive: Boolean(isActive) } },
      { new: true },
    ).lean();
    if (!product) return { success: false, message: "Product not found" };

    await logAuditDirect({
      action: "TagProduct.availability",
      module: "TagProduct",
      entityId: String(product._id),
      description: `${product.sku} ${isActive ? "put back on sale" : "withdrawn from sale"}`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: isActive ? "Back on sale" : "Withdrawn from sale",
    };
  } catch (error) {
    console.log("Error changing product availability:", error);
    return { success: false, message: "Could not update that product" };
  }
}

/**
 * How much a product is actually being bought.
 *
 * Shown next to the price because that is the question a price change raises:
 * whether anyone is buying it at the current one.
 */
export async function getCatalogueDemand() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const { escapeTenant } = await import("@/lib/tenantContext");
    const rows = await escapeTenant("catalogue: demand across tenants", () =>
      TagOrderModel.aggregate([
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productSku",
            orders: { $sum: 1 },
            units: { $sum: "$items.quantity" },
          },
        },
      ]),
    );

    return { success: true, data: JSON.stringify(rows) };
  } catch (error) {
    console.log("Error loading catalogue demand:", error);
    return { success: false, message: "Could not load demand" };
  }
}
