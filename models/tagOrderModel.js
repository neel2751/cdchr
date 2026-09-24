import mongoose from "mongoose";
import { applyTenantScope } from "@/lib/tenantPlugin";
import { CARRIER_KEYS } from "@/data/carriers";

/**
 * An order for physical tags, and the manufacturing state of each unit in it.
 *
 * The per-unit state lives here rather than on ClockTag because it describes
 * *making* a tag, not being one. It also means a ClockTag always has a real
 * UID: a row is only created once an operator has read the chip, instead of
 * being born as a placeholder waiting to be filled in.
 *
 * See CLOCK_LOCATION_PLAN.md §6.3 and §6.4.
 */

const unitSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },

    // The sealed AES key for this unit. NEVER the key itself — see
    // lib/tagKeys.js. Only set for chips that carry one.
    keyRef: String,

    status: {
      type: String,
      // pending  — ordered, nothing generated yet
      // keyed    — a key exists, sealed, waiting to be written to a chip
      // written  — on the chip; the UID has been read back
      // verified — the server has checked the chip's own signature (§6.5)
      // shipped  — in the box, on a shipment (§6.9)
      // returned — came back: dead on arrival, damaged, wrong address. The
      //            ClockTag is retired, so the customer's registry does not
      //            fill with tags nobody can account for.
      // replaced — this unit was returned and a new unit was provisioned
      //            against the same order. Kept rather than deleted: an order
      //            of fifty that shipped fifty-one chips should say so.
      // failed   — a write went wrong. A NEW key is issued on retry: a key
      //            that may have been half-written to a chip is never reused.
      enum: [
        "pending",
        "keyed",
        "written",
        "verified",
        "shipped",
        "returned",
        "replaced",
        "failed",
      ],
      default: "pending",
    },

    uid: String, // read from the chip during programming
    tagId: mongoose.Schema.Types.ObjectId, // the ClockTag created for it

    keyIssuedAt: Date,
    writtenAt: Date,
    verifiedAt: Date,
    failureReason: String,

    // Which shipment carried it. A unit belongs to at most one: an order can
    // go out in several boxes, but a chip is only in one of them.
    shipmentRef: String,

    returnedAt: Date,
    returnReason: String,
    // The index of the unit provisioned to replace this one, so a returned
    // chip and its replacement can be read as a pair rather than two
    // unrelated rows.
    replacedByIndex: Number,
    // Set on the replacement, pointing back. The other half of that pair.
    replacesIndex: Number,

    _id: false,
  },
  { _id: false },
);

/**
 * One box, going to one address, with a tracking reference of its own.
 *
 * Shipments exist because an order is not always one parcel. Forty units of a
 * fifty verify and ten do not: §6.5 is right to refuse to ship an unverified
 * tag, and wrong to make the customer wait on the forty. So units are
 * dispatched in batches, and each batch carries its own carrier and reference
 * — which also means a replacement for a returned tag is just another
 * shipment rather than a special case.
 */
const shipmentSchema = new mongoose.Schema(
  {
    // Unique within the order, e.g. "TAG-260923-A1B2/2". Used instead of an
    // _id so it can be read aloud, put in an email, and matched by
    // arrayFilters without a second lookup.
    reference: { type: String, required: true },

    carrier: { type: String, enum: CARRIER_KEYS, default: "other" },
    trackingRef: String,
    parcelCount: { type: Number, default: 1, min: 1 },

    // Which units are in this box, by unit index.
    unitIndexes: [Number],

    dispatchedAt: Date,
    dispatchedByName: String,

    deliveredAt: Date,
    // "platform" when we marked it, "customer" when they confirmed receipt.
    // Worth distinguishing: one is our record-keeping, the other is the
    // customer saying the box is actually in their hands.
    deliveredSource: { type: String, enum: ["platform", "customer"] },
    deliveredByName: String,

    notes: String,

    // ---- postage (lib/carrierProviders.js) ----
    //
    // Who sold us the label, as distinct from `carrier`, which is who is
    // carrying it. Usually the same company; not always, and a manual
    // purchase has no provider at all.
    labelProvider: String,
    // base64. A Royal Mail label is ~50KB of PDF; the alternative is a file
    // store and a second thing that can be missing when the label is needed.
    labelData: String,
    labelFormat: { type: String, enum: ["pdf", "png", "zpl"] },
    labelAllocatedAt: Date,
    // The carrier's own id for the order behind this label, so a query to
    // their support desk has something to quote.
    labelProviderRef: String,
    // Cleared on a successful purchase. Kept when one fails, so the screen can
    // say what went wrong rather than only that nothing happened.
    labelError: String,

    // What we told the carrier the parcel weighs. Required by every postage
    // API, and priced on: a wrong weight is a surcharge, not a rejection.
    weightGrams: Number,

    _id: false,
  },
  { _id: false },
);

const tagOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true },

    // Derived from the units and shipments by recomputeOrderStatus() in
    // server/tagServer/provisioning.js, never set by hand — two sources for
    // one fact is how an order ends up saying "shipped" with units still on
    // the bench.
    status: {
      type: String,
      enum: [
        "placed",
        "accepted",
        "provisioning",
        // Some units are out, some are not. The state that did not exist
        // before shipments did, and the reason a partial order used to be
        // unshippable.
        "partially-shipped",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "placed",
    },

    items: [
      {
        productSku: String,
        productName: String,
        quantity: { type: Number, min: 1 },
        unitPrice: Number,
        customisation: {
          text: String,
          colour: String,
        },
        _id: false,
      },
    ],

    units: [unitSchema],

    currency: { type: String, default: "GBP" },
    total: Number,

    // Free text, as the customer typed it. Kept for display and for a
    // manually bought label, where a human reads it.
    shippingAddress: String,

    // The same address, in the fields a postage API demands.
    //
    // Held separately rather than parsed out of the free text above. Deciding
    // which line of a typed address is the city is a guess, and a wrong guess
    // sends the parcel to the wrong place without anything looking broken —
    // so the customer is asked for the parts, and a label cannot be bought
    // without them.
    shipTo: {
      name: String,
      company: String,
      line1: String,
      line2: String,
      city: String,
      postcode: String,
      countryCode: { type: String, default: "GB" },
    },

    notes: String,

    placedBy: mongoose.Schema.Types.ObjectId,
    placedByName: String,
    placedAt: Date,

    shipments: [shipmentSchema],

    fulfilledByName: String,
    // First dispatch and last delivery, for sorting and for "how long did that
    // take" without walking the shipments every time.
    shippedAt: Date,
    deliveredAt: Date,
  },
  { timestamps: true },
);

tagOrderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
tagOrderSchema.index({ orderNumber: 1 }, { unique: true });

// Tenant scoping (lib/tenantPlugin.js). An order belongs to the company that
// placed it; the platform side reads across tenants deliberately, through
// escapeTenant.
applyTenantScope(tagOrderSchema, "TagOrder");

const TagOrderModel =
  mongoose.models.TagOrder || mongoose.model("TagOrder", tagOrderSchema);

export default TagOrderModel;
