"use server";

import { connect } from "@/db/db";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import {
  generateTagKey,
  openTagKey,
  sealTagKey,
  tagKeyToHex,
  tagKeysConfigured,
} from "@/lib/tagKeys";
import ClockTagModel from "@/models/clockTagModel";
import CompanyModel from "@/models/companyModel";
import TagOrderModel from "@/models/tagOrderModel";
import { CARRIER_KEYS, carrierName } from "@/data/carriers";
import { recomputeOrderStatus } from "@/lib/tagOrderStatus";
import { recordStockMovement } from "./stock";
import { normaliseUid } from "../clockServer/clockTagStore";
import { getServerSideProps } from "../session/session";

/**
 * The provisioning station: turning an accepted order into working hardware.
 *
 * This is the most sensitive surface in the whole tag feature, because it is
 * the one place a live key is handed out. Four rules hold it shut, and each
 * exists for a reason worth keeping:
 *
 *   - platformAdmin only, and every order is reached across tenants
 *     deliberately through escapeTenant rather than by accident.
 *   - A key is never handed out again once its chip is written. There is no
 *     legitimate second fetch.
 *   - Key material never reaches a log, an audit entry or an error message.
 *     The audit records *that* a key was issued, never the key.
 *   - A failed write issues a NEW key. A key that may have been half-written
 *     to a chip is never reused.
 *
 * See CLOCK_LOCATION_PLAN.md §6.4 and §6.5.
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

/** Find one order across every tenant, and the company that placed it. */
async function loadOrder(orderNumber) {
  return escapeTenant("tag provisioning: find an order across tenants", () =>
    TagOrderModel.findOne({ orderNumber }).lean(),
  );
}

/** Every order waiting on us, newest first. */
export async function getProvisioningQueue() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const orders = await escapeTenant("tag provisioning: the queue", () =>
      TagOrderModel.find({
        // "partially-shipped" and "shipped" stay in the queue: the first has
        // units still to make, the second still needs marking delivered.
        status: {
          $in: [
            "placed",
            "accepted",
            "provisioning",
            "partially-shipped",
            "shipped",
          ],
        },
      })
        .sort({ createdAt: -1 })
        .limit(50)
        // Never send sealed key material to a screen.
        .select("-units.keyRef")
        .lean(),
    );

    const companies = await escapeTenant("tag provisioning: company names", () =>
      CompanyModel.find({
        _id: { $in: orders.map((o) => o.tenantId).filter(Boolean) },
      })
        .select("name")
        .lean(),
    );
    const nameOf = new Map(companies.map((c) => [String(c._id), c.name]));

    return {
      success: true,
      data: JSON.stringify(
        orders.map((o) => ({
          ...o,
          companyName: nameOf.get(String(o.tenantId)) || "Unknown company",
        })),
      ),
      configured: tagKeysConfigured(),
    };
  } catch (error) {
    console.log("Error loading the provisioning queue:", error);
    return { success: false, message: "Could not load the queue" };
  }
}

/**
 * Accept an order: mint one sealed key per unit ordered.
 *
 * No ClockTag rows yet — a tag's UID is not known until an operator reads the
 * chip, and a ClockTag born as a placeholder waiting to be filled in is a
 * ClockTag that can be tapped before it means anything.
 */
export async function acceptTagOrder({ orderNumber } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!tagKeysConfigured()) {
      return {
        success: false,
        message:
          "TAG_KEY_MASTER is not set on this server — keys cannot be sealed.",
      };
    }

    await connect();
    const order = await loadOrder(orderNumber);
    if (!order) return { success: false, message: "Order not found" };
    if (order.status !== "placed") {
      return { success: false, message: `That order is already ${order.status}` };
    }

    const quantity = order.items.reduce((n, i) => n + i.quantity, 0);
    const units = Array.from({ length: quantity }, (_, index) => ({
      index,
      keyRef: sealTagKey(generateTagKey()),
      status: "keyed",
    }));

    await escapeTenant("tag provisioning: accept", () =>
      TagOrderModel.updateOne(
        { _id: order._id },
        { $set: { status: "accepted", units } },
      ),
    );

    await logAuditDirect({
      action: "TagOrder.accept",
      module: "TagOrder",
      entityId: String(order._id),
      tenantId: order.tenantId,
      description: `Accepted ${orderNumber}; generated ${quantity} key(s)`,
      actor: auth.user,
    }).catch(() => {});

    return { success: true, message: `Accepted. ${quantity} key(s) generated.` };
  } catch (error) {
    console.log("Error accepting a tag order:", error);
    return { success: false, message: "Could not accept that order" };
  }
}

/**
 * Hand the operator one unit's key, to write onto a chip.
 *
 * The only place plaintext key material leaves the server, and it refuses once
 * the chip has been written — there is no legitimate second fetch.
 */
export async function fetchUnitKey({ orderNumber, index } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const order = await loadOrder(orderNumber);
    if (!order) return { success: false, message: "Order not found" };

    const unit = order.units?.find((u) => u.index === Number(index));
    if (!unit) return { success: false, message: "No such unit on that order" };
    if (["written", "verified", "shipped"].includes(unit.status)) {
      return {
        success: false,
        message:
          "That chip has already been written. If the write failed, mark it failed — a new key will be issued.",
      };
    }
    if (!unit.keyRef) {
      return { success: false, message: "That unit has no key yet" };
    }

    const key = tagKeyToHex(openTagKey(unit.keyRef));

    await escapeTenant("tag provisioning: mark a key issued", () =>
      TagOrderModel.updateOne(
        { _id: order._id, "units.index": unit.index },
        { $set: { "units.$.keyIssuedAt": new Date(), status: "provisioning" } },
      ),
    );

    // A blank has left the shelf. Counted here rather than at write, because
    // this is the moment an operator is holding one physical chip: counting at
    // write would miss every chip that failed, and counting at both write and
    // failure would count a chip that was written and then failed twice.
    // server/tagServer/stock.js has the full reasoning.
    //
    // Never allowed to fail the fetch. The operator is standing at the bench
    // with the chip in their hand; a bookkeeping error must not stop them.
    const sku = order.items?.[0]?.productSku;
    if (sku) {
      await recordStockMovement({
        sku,
        delta: -1,
        reason: "consumed",
        orderNumber,
        unitIndex: unit.index,
        byName: auth.user.name,
      }).catch((error) =>
        console.log("Could not record stock for a key issue:", error?.message),
      );
    }

    // The audit records THAT a key was issued. Never the key.
    await logAuditDirect({
      action: "TagOrder.keyIssued",
      module: "TagOrder",
      entityId: String(order._id),
      tenantId: order.tenantId,
      description: `Key issued for ${orderNumber} unit ${unit.index}`,
      actor: auth.user,
    }).catch(() => {});

    return { success: true, data: JSON.stringify({ index: unit.index, key }) };
  } catch (error) {
    console.log("Error issuing a tag key:", error?.message);
    return { success: false, message: "Could not issue that key" };
  }
}

/**
 * The chip is written. Record its UID and create the customer's ClockTag.
 *
 * The tag lands in their registry as `unassigned`, so when the box arrives
 * somebody carries a tag to a door, sticks it up and taps it — and tap-to-enrol
 * binds it. No UID is ever typed and no key is ever mentioned.
 */
export async function recordUnitWritten({ orderNumber, index, uid } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const cleanUid = normaliseUid(uid);
    if (!cleanUid) return { success: false, message: "That UID could not be read" };

    await connect();
    const order = await loadOrder(orderNumber);
    if (!order) return { success: false, message: "Order not found" };

    const unit = order.units?.find((u) => u.index === Number(index));
    if (!unit) return { success: false, message: "No such unit on that order" };
    if (unit.status === "shipped") {
      return { success: false, message: "That unit has already shipped" };
    }

    const item = order.items[0];
    const label = `${item?.productName || "Tag"} ${cleanUid.slice(-6)}`;

    // Created inside the customer's own scope, so the tag belongs to them and
    // the tenant plugin stamps it correctly.
    const tag = await runWithTenant(String(order.tenantId), async () => {
      const existing = await ClockTagModel.findOne({ uid: cleanUid }).lean();
      if (existing) return existing;
      const created = await ClockTagModel.create({
        uid: cleanUid,
        label,
        chipType: unit.keyRef ? "ntag424" : "ntag213",
        status: "unassigned",
        keyRef: unit.keyRef,
        history: [
          {
            toStatus: "unassigned",
            at: new Date(),
            byName: auth.user.name,
            reason: `Provisioned on ${orderNumber}`,
          },
        ],
      });
      return created.toObject();
    });

    await escapeTenant("tag provisioning: mark written", () =>
      TagOrderModel.updateOne(
        { _id: order._id, "units.index": unit.index },
        {
          $set: {
            "units.$.status": "written",
            "units.$.uid": cleanUid,
            "units.$.tagId": tag._id,
            "units.$.writtenAt": new Date(),
            "units.$.failureReason": null,
          },
        },
      ),
    );

    return { success: true, message: `Unit ${unit.index} written (${cleanUid})` };
  } catch (error) {
    if (error?.code === 11000) {
      return { success: false, message: "That UID is already registered" };
    }
    console.log("Error recording a written unit:", error?.message);
    return { success: false, message: "Could not record that chip" };
  }
}

/**
 * Tap the written chip on the bench and confirm the server can read it.
 *
 * **A tag that has not verified does not ship.** Without this a customer finds
 * out three days later and two hundred miles away, and nobody can tell whether
 * the fault is the chip, the key, the URL or the phone. Catching it here costs
 * seconds.
 */
export async function verifyUnit({ orderNumber, index, uid } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const order = await loadOrder(orderNumber);
    if (!order) return { success: false, message: "Order not found" };

    const unit = order.units?.find((u) => u.index === Number(index));
    if (!unit) return { success: false, message: "No such unit on that order" };
    if (unit.status !== "written") {
      return { success: false, message: "Write the chip before verifying it" };
    }

    // What the bench tap has to agree with: the UID we recorded, and a tag row
    // that actually exists in the customer's registry.
    const cleanUid = normaliseUid(uid);
    if (!cleanUid || cleanUid !== unit.uid) {
      return {
        success: false,
        message: `That tap reads ${cleanUid || "nothing"}, but this unit was written as ${unit.uid}.`,
      };
    }

    const tag = await runWithTenant(String(order.tenantId), () =>
      ClockTagModel.findOne({ uid: cleanUid }).lean(),
    );
    if (!tag) {
      return { success: false, message: "That tag is not in the customer's registry" };
    }

    await escapeTenant("tag provisioning: mark verified", () =>
      TagOrderModel.updateOne(
        { _id: order._id, "units.index": unit.index },
        { $set: { "units.$.status": "verified", "units.$.verifiedAt": new Date() } },
      ),
    );

    return { success: true, message: `Unit ${unit.index} verified` };
  } catch (error) {
    console.log("Error verifying a unit:", error?.message);
    return { success: false, message: "Could not verify that chip" };
  }
}

/**
 * A write went wrong. Issue a NEW key rather than retrying the old one.
 *
 * A key that may have been partially written to a chip is a key that may be on
 * a chip somebody else ends up holding.
 */
export async function markUnitFailed({ orderNumber, index, reason } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const order = await loadOrder(orderNumber);
    if (!order) return { success: false, message: "Order not found" };

    const unit = order.units?.find((u) => u.index === Number(index));
    if (!unit) return { success: false, message: "No such unit on that order" };

    await escapeTenant("tag provisioning: reissue after a failure", () =>
      TagOrderModel.updateOne(
        { _id: order._id, "units.index": unit.index },
        {
          $set: {
            "units.$.status": "keyed",
            "units.$.keyRef": sealTagKey(generateTagKey()),
            "units.$.keyIssuedAt": null,
            "units.$.uid": null,
            "units.$.failureReason": reason?.trim() || "Write failed",
          },
        },
      ),
    );

    return { success: true, message: `Unit ${unit.index} reset with a new key` };
  } catch (error) {
    console.log("Error resetting a unit:", error?.message);
    return { success: false, message: "Could not reset that unit" };
  }
}

/** Into the box. Refuses while anything is unverified. */
/** Persist the derived status, plus the two summary dates that hang off it. */
async function syncOrderStatus(orderId) {
  const order = await escapeTenant("tag orders: recompute status", () =>
    TagOrderModel.findById(orderId).lean(),
  );
  if (!order) return null;

  const shipments = order.shipments || [];
  const dispatched = shipments.map((s) => s.dispatchedAt).filter(Boolean);
  const delivered = shipments.map((s) => s.deliveredAt).filter(Boolean);
  const status = recomputeOrderStatus(order);

  await escapeTenant("tag orders: recompute status", () =>
    TagOrderModel.updateOne(
      { _id: orderId },
      {
        $set: {
          status,
          shippedAt: dispatched.length
            ? new Date(Math.min(...dispatched.map((d) => new Date(d))))
            : null,
          deliveredAt:
            delivered.length === shipments.length && shipments.length
              ? new Date(Math.max(...delivered.map((d) => new Date(d))))
              : null,
        },
      },
    ),
  );
  return status;
}

/**
 * Send a box.
 *
 * Replaces the old all-or-nothing `shipTagOrder`. That refused to ship while
 * any unit was unverified, which is the right rule for a *tag* — an unverified
 * chip is one nobody has proved works — and the wrong rule for the customer
 * waiting on the forty that did verify. So the rule moves from the order to
 * the units: verified units ship, the rest stay, and the order says
 * "partially-shipped" until they follow.
 *
 * `unitIndexes` omitted means "everything ready that has not gone yet", which
 * is the common case and saves the operator ticking forty boxes.
 */
export async function dispatchShipment({
  orderNumber,
  carrier = "other",
  trackingRef,
  unitIndexes,
  parcelCount = 1,
  notes,
} = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!CARRIER_KEYS.includes(carrier)) {
      return { success: false, message: "Unknown carrier" };
    }

    await connect();
    const order = await loadOrder(orderNumber);
    if (!order) return { success: false, message: "Order not found" };
    if (order.status === "cancelled") {
      return { success: false, message: "That order was cancelled" };
    }

    const units = order.units || [];
    const readyNow = units
      .filter((u) => u.status === "verified")
      .map((u) => u.index);

    let chosen = Array.isArray(unitIndexes) && unitIndexes.length
      ? unitIndexes.map(Number)
      : readyNow;

    // Deduplicated, because a caller passing the same index twice would put
    // one chip in the box twice and make the counts disagree for ever.
    chosen = [...new Set(chosen)];

    if (!chosen.length) {
      return {
        success: false,
        message:
          "Nothing is ready to ship. A tag that has not verified does not go in the box.",
      };
    }

    // Every chosen unit has to be verified and unshipped. Checked per unit so
    // the message names the problem rather than saying "some units".
    const problems = [];
    for (const index of chosen) {
      const unit = units.find((u) => u.index === index);
      if (!unit) problems.push(`#${index} is not on this order`);
      else if (unit.status === "shipped") problems.push(`#${index} already shipped`);
      else if (unit.status !== "verified") {
        problems.push(`#${index} is ${unit.status}, not verified`);
      }
    }
    if (problems.length) {
      return { success: false, message: problems.slice(0, 4).join("; ") };
    }

    const reference = `${order.orderNumber}/${(order.shipments || []).length + 1}`;
    const now = new Date();

    await escapeTenant("tag provisioning: dispatch", () =>
      TagOrderModel.updateOne(
        { _id: order._id },
        {
          $push: {
            shipments: {
              reference,
              carrier,
              trackingRef: (trackingRef || "").trim(),
              parcelCount: Math.max(1, Number(parcelCount) || 1),
              unitIndexes: chosen,
              dispatchedAt: now,
              dispatchedByName: auth.user.name,
              notes: (notes || "").trim(),
            },
          },
          $set: {
            fulfilledByName: auth.user.name,
            // Only the units in this box. The old action set
            // `units.$[].status`, marking every unit shipped whether or not it
            // was in the parcel.
            "units.$[chosen].status": "shipped",
            "units.$[chosen].shipmentRef": reference,
          },
        },
        { arrayFilters: [{ "chosen.index": { $in: chosen } }] },
      ),
    );

    const status = await syncOrderStatus(order._id);

    await logAuditDirect({
      action: "TagOrder.dispatch",
      module: "TagOrder",
      entityId: String(order._id),
      tenantId: order.tenantId,
      description:
        `Dispatched ${reference}: ${chosen.length} tag(s) via ` +
        `${carrierName(carrier)}${trackingRef ? ` (${trackingRef})` : ""}`,
      actor: auth.user,
    }).catch(() => {});

    const left = (order.units || []).length - chosen.length;
    return {
      success: true,
      message:
        `${reference} dispatched — ${chosen.length} tag(s)` +
        (status === "partially-shipped" && left > 0
          ? `. ${left} still to go.`
          : "."),
    };
  } catch (error) {
    console.log("Error dispatching a shipment:", error);
    return { success: false, message: "Could not dispatch that shipment" };
  }
}

/**
 * Mark a box as arrived.
 *
 * Callable by the platform (our record) and by the customer (their word that
 * it is actually in their hands). `deliveredSource` keeps the two apart,
 * because they are not the same claim and a dispute later turns on which was
 * which.
 */
export async function markShipmentDelivered({
  orderNumber,
  reference,
  deliveredAt,
} = {}) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user?._id) return { success: false, message: "Not signed in" };

    const isPlatform = user.role === "platformAdmin";
    const isCustomer = user.role === "superAdmin";
    if (!isPlatform && !isCustomer) {
      return { success: false, message: "Not authorized" };
    }

    await connect();
    const order = await loadOrder(orderNumber);
    if (!order) return { success: false, message: "Order not found" };

    // A customer may only confirm their own company's order. The platform
    // reads across tenants on purpose; nobody else does.
    if (isCustomer && String(order.tenantId) !== String(user.tenantId)) {
      return { success: false, message: "Order not found" };
    }

    const shipment = (order.shipments || []).find(
      (s) => s.reference === reference,
    );
    if (!shipment) return { success: false, message: "Shipment not found" };
    if (shipment.deliveredAt) {
      return { success: true, message: `${reference} is already marked delivered` };
    }

    // A delivery date in the future is a typo, and one before dispatch is a
    // different typo. Both would make "how long did that take" nonsense.
    let when = deliveredAt ? new Date(deliveredAt) : new Date();
    if (Number.isNaN(when.getTime()) || when > new Date()) when = new Date();
    if (shipment.dispatchedAt && when < new Date(shipment.dispatchedAt)) {
      when = new Date(shipment.dispatchedAt);
    }

    await escapeTenant("tag orders: mark delivered", () =>
      TagOrderModel.updateOne(
        { _id: order._id },
        {
          $set: {
            "shipments.$[s].deliveredAt": when,
            "shipments.$[s].deliveredSource": isPlatform
              ? "platform"
              : "customer",
            "shipments.$[s].deliveredByName": user.name || "",
          },
        },
        { arrayFilters: [{ "s.reference": reference }] },
      ),
    );

    await syncOrderStatus(order._id);

    await logAuditDirect({
      action: "TagOrder.delivered",
      module: "TagOrder",
      entityId: String(order._id),
      tenantId: order.tenantId,
      description: `${reference} marked delivered by the ${isPlatform ? "platform" : "customer"}`,
      actor: user,
    }).catch(() => {});

    return { success: true, message: `${reference} marked delivered` };
  } catch (error) {
    console.log("Error marking a shipment delivered:", error);
    return { success: false, message: "Could not update that shipment" };
  }
}

/**
 * A tag came back.
 *
 * Retires the ClockTag as well as marking the unit, which is the half that
 * matters: a dead chip left `active` in the customer's registry is a tag
 * nobody can account for, and it would still be offered on the locations
 * screen as though it were in somebody's pocket.
 *
 * Retired, never deleted — a returned tag may have clock records against it,
 * and those are a record of where somebody actually was.
 */
export async function recordUnitReturn({
  orderNumber,
  index,
  reason,
} = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const order = await loadOrder(orderNumber);
    if (!order) return { success: false, message: "Order not found" };

    const unit = (order.units || []).find((u) => u.index === Number(index));
    if (!unit) return { success: false, message: "Unit not found" };
    if (unit.status === "returned" || unit.status === "replaced") {
      return { success: false, message: `Unit #${index} is already returned` };
    }

    await escapeTenant("tag orders: record a return", () =>
      TagOrderModel.updateOne(
        { _id: order._id },
        {
          $set: {
            "units.$[u].status": "returned",
            "units.$[u].returnedAt": new Date(),
            "units.$[u].returnReason": (reason || "").trim() || "Not given",
          },
        },
        { arrayFilters: [{ "u.index": Number(index) }] },
      ),
    );

    // Retire the customer's tag, inside their own tenant scope.
    if (unit.tagId) {
      await runWithTenant(String(order.tenantId), () =>
        ClockTagModel.updateOne(
          { _id: unit.tagId },
          {
            $set: { status: "retired" },
            $push: {
              history: {
                at: new Date(),
                fromStatus: unit.status,
                toStatus: "retired",
                reason: `Returned to the supplier: ${(reason || "").trim() || "no reason given"}`,
              },
            },
          },
        ),
      ).catch((error) => {
        // The unit is recorded either way. A tag that could not be retired is
        // visible on the order and fixable; losing the return record is not.
        console.log("Could not retire the returned tag:", error?.message);
      });
    }

    await syncOrderStatus(order._id);

    await logAuditDirect({
      action: "TagOrder.return",
      module: "TagOrder",
      entityId: String(order._id),
      tenantId: order.tenantId,
      description: `Unit #${index} of ${orderNumber} returned: ${(reason || "").trim() || "no reason given"}`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: `Unit #${index} recorded as returned. Add a replacement to send another.`,
    };
  } catch (error) {
    console.log("Error recording a return:", error);
    return { success: false, message: "Could not record that return" };
  }
}

/**
 * Add a replacement for a returned unit.
 *
 * A new unit on the same order rather than a new order: the customer bought
 * fifty working tags and a replacement is us finishing that, not them buying
 * again. The pair is linked in both directions so an order of fifty that
 * shipped fifty-one chips can say why.
 *
 * The replacement starts at `pending` and goes through provisioning normally —
 * a new key, a new chip, a new verification. Nothing about the dead unit is
 * carried over, least of all its key.
 */
export async function replaceUnit({ orderNumber, index } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const order = await loadOrder(orderNumber);
    if (!order) return { success: false, message: "Order not found" };

    const unit = (order.units || []).find((u) => u.index === Number(index));
    if (!unit) return { success: false, message: "Unit not found" };
    // The more specific message first: a unit that has already been replaced
    // has status "replaced", so checking "is it returned" first would answer
    // "record the return" about a return that was recorded.
    if (unit.replacedByIndex != null) {
      return {
        success: false,
        message: `Unit #${index} already has replacement #${unit.replacedByIndex}`,
      };
    }
    if (unit.status !== "returned") {
      return {
        success: false,
        message: "Only a returned unit can be replaced. Record the return first.",
      };
    }

    // Indexes are append-only, so a replacement never reuses a number that
    // appears in an earlier shipment's unitIndexes.
    const nextIndex =
      Math.max(...(order.units || []).map((u) => u.index), -1) + 1;

    // Two updates, not one: MongoDB refuses a $push and a $set that both
    // touch `units` ("would create a conflict at 'units'").
    //
    // The $set goes first, guarded on the unit still being an unreplaced
    // return. That makes the pair atomic enough: if two operators press the
    // button together only one claims the unit, and the loser's push never
    // happens. Pushing first would risk a spare pending unit nobody asked for.
    const claimed = await escapeTenant("tag orders: claim the return", () =>
      TagOrderModel.updateOne(
        {
          _id: order._id,
          units: {
            $elemMatch: {
              index: Number(index),
              status: "returned",
              replacedByIndex: null,
            },
          },
        },
        {
          $set: {
            "units.$[u].status": "replaced",
            "units.$[u].replacedByIndex": nextIndex,
          },
        },
        { arrayFilters: [{ "u.index": Number(index) }] },
      ),
    );
    if (!claimed.modifiedCount) {
      return {
        success: false,
        message: "That unit was replaced by somebody else a moment ago.",
      };
    }

    await escapeTenant("tag orders: add a replacement", () =>
      TagOrderModel.updateOne(
        { _id: order._id },
        {
          $push: {
            units: {
              index: nextIndex,
              status: "pending",
              replacesIndex: Number(index),
            },
          },
        },
      ),
    );

    await syncOrderStatus(order._id);

    await logAuditDirect({
      action: "TagOrder.replace",
      module: "TagOrder",
      entityId: String(order._id),
      tenantId: order.tenantId,
      description: `Unit #${index} of ${orderNumber} replaced by #${nextIndex}`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: `Replacement #${nextIndex} added. It needs a key, a chip and a verification like any other.`,
    };
  } catch (error) {
    console.log("Error adding a replacement:", error);
    return { success: false, message: "Could not add a replacement" };
  }
}
