import mongoose from "mongoose";

/**
 * A tag a customer can order.
 *
 * Platform-level, not tenant-scoped: one catalogue every company orders from,
 * maintained by us. That is why it is listed in GLOBAL_MODELS in
 * lib/tenantPlugin.js — scoping it would give each company an empty shop.
 *
 * See CLOCK_LOCATION_PLAN.md §6.2.
 */
const tagProductSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },

    formFactor: {
      type: String,
      enum: ["round", "card", "keyfob", "sticker", "wristband"],
      default: "round",
    },
    chipType: {
      type: String,
      enum: ["ntag213", "ntag424"],
      default: "ntag213",
    },

    // Ferrite-backed. NFC does not work stuck to bare metal — the metal
    // detunes the antenna and the tag is simply dead — and site cabins are
    // usually steel. Ordering twenty plain discs for steel cabins buys twenty
    // things that do not work, and it gets reported as a software bug, so the
    // ordering screen asks about the mounting surface and filters on this.
    onMetal: { type: Boolean, default: false },
    weatherproof: { type: Boolean, default: false },

    unitPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "GBP" },
    minQuantity: { type: Number, default: 10, min: 1 },
    leadTimeDays: { type: Number, default: 10 },

    // Blanks on the shelf. A CACHE — the sum of TagStockMovement for this sku
    // is what is authoritative, and recountStock() in
    // server/tagServer/stock.js rebuilds this from it after every movement.
    //
    // Cached because the ordering screen and the provisioning queue both ask
    // "can we make this", and summing a ledger on every render is how a screen
    // gets slow enough that somebody caches it badly later.
    stockOnHand: { type: Number, default: 0 },

    // Below this, say so. Lead times are long enough that finding out at the
    // moment of need is finding out too late.
    reorderLevel: { type: Number, default: 0, min: 0 },

    // One tag, in grams. Every postage API prices on weight and none of them
    // will accept an order without it, so a product with no weight cannot
    // have a label bought for it — which the dispatch screen says rather than
    // guessing a number that turns into a surcharge.
    weightGrams: { type: Number, default: 0, min: 0 },

    customisation: {
      logo: { type: Boolean, default: false },
      text: { type: Boolean, default: false },
      colours: [String],
    },

    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

tagProductSchema.index({ isActive: 1, chipType: 1 });

// Deliberately NOT tenant-scoped. See the note above.
const TagProductModel =
  mongoose.models.TagProduct || mongoose.model("TagProduct", tagProductSchema);

export default TagProductModel;
