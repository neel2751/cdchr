import mongoose from "mongoose";

/**
 * Every blank that has moved on or off the shelf.
 *
 * A ledger rather than a number, because a number cannot answer "why is this
 * wrong". Stock counts drift — a blank gets dropped, a delivery is short, two
 * people count the same box — and the only way back to the truth is a list of
 * what happened. `TagProduct.stockOnHand` is the sum of these and is a cache:
 * this collection is what is authoritative.
 *
 * Platform-level, not tenant-scoped: the blanks are ours, on our shelf, before
 * any customer's order touches them. Listed in GLOBAL_MODELS alongside
 * TagProduct for the same reason — scoping it would give every company their
 * own empty warehouse.
 *
 * See CLOCK_LOCATION_PLAN.md §6.9.
 */
const tagStockMovementSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true, index: true },

    // Signed. Positive puts blanks on the shelf, negative takes them off.
    // Stored signed rather than as a magnitude plus a direction so that the
    // running total is a sum and cannot disagree with itself.
    delta: { type: Number, required: true },

    reason: {
      type: String,
      enum: [
        // A delivery of blanks arrived.
        "received",
        // A blank was picked up to be written. See the note in
        // server/tagServer/stock.js on why this is counted at key issue and
        // not at write: one key fetch is one physical chip in somebody's hand,
        // whether or not the write then succeeds.
        "consumed",
        // A stocktake correction. The note should say what was counted.
        "adjusted",
        // An unopened blank went back on the shelf.
        "returned",
      ],
      required: true,
    },

    // Set when the movement belongs to an order, so a blank can be traced to
    // the chip it became.
    orderNumber: String,
    unitIndex: Number,

    note: String,
    byName: String,
    at: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

tagStockMovementSchema.index({ sku: 1, at: -1 });
tagStockMovementSchema.index({ orderNumber: 1, unitIndex: 1 });

// Deliberately NOT tenant-scoped. See the note above.
const TagStockMovementModel =
  mongoose.models.TagStockMovement ||
  mongoose.model("TagStockMovement", tagStockMovementSchema);

export default TagStockMovementModel;
