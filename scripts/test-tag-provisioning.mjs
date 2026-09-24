/**
 * Tag ordering and provisioning.
 *
 * The rules under test are the ones that protect key material, and each exists
 * because the alternative is a box of tags somebody else can clone:
 *
 *   - a key is sealed at rest, so a database dump is not working hardware
 *   - the plaintext key leaves the server exactly once, and never after the
 *     chip is written
 *   - a failed write gets a NEW key, never the one that may be half-written
 *   - nothing unverified ships
 *   - the customer never sees, generates or handles any of it
 *
 * Needs a LOCAL database — it writes and drops.
 *
 *   TAG_KEY_MASTER=$(openssl rand -hex 32) \
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_tagprov" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-tag-provisioning.mjs
 */
import assert from "node:assert";
import crypto from "node:crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();

// Self-provisioning: the suite is about key handling, so it brings its own.
process.env.TAG_KEY_MASTER =
  process.env.TAG_KEY_MASTER || crypto.randomBytes(32).toString("hex");

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const {
    generateTagKey,
    openTagKey,
    sealTagKey,
    tagKeyToHex,
    tagKeysConfigured,
  } = await import("@/lib/tagKeys");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const TagProduct = (await import("@/models/tagProductModel")).default;
  const TagOrder = (await import("@/models/tagOrderModel")).default;
  const ClockTag = (await import("@/models/clockTagModel")).default;
  const { getTagProducts, getTagOrders, placeTagOrder } = await import(
    "@/server/tagServer/orders"
  );
  const {
    acceptTagOrder,
    fetchUnitKey,
    markUnitFailed,
    recordUnitWritten,
    dispatchShipment,
    markShipmentDelivered,
    recordUnitReturn,
    replaceUnit,
    verifyUnit,
  } = await import("@/server/tagServer/provisioning");

  const db = mongoose.connection.db;
  for (const c of ["tagproducts", "tagorders", "clocktags", "companies"]) {
    await db.collection(c).deleteMany({});
  }
  await TagProduct.syncIndexes();
  await ClockTag.syncIndexes();

  const tenantId = new mongoose.Types.ObjectId();
  await db
    .collection("companies")
    .insertOne({ _id: tenantId, name: "Acme Ltd", slug: "acme" });

  await TagProduct.create({
    sku: "RND-30-424",
    name: "Round disc 30mm",
    formFactor: "round",
    chipType: "ntag424",
    onMetal: false,
    unitPrice: 3.2,
    minQuantity: 2,
  });

  const asCustomer = () =>
    actAs({
      _id: String(new mongoose.Types.ObjectId()),
      role: "superAdmin",
      name: "Cathy",
      tenantId: String(tenantId),
    });
  const asPlatform = () =>
    actAs({
      _id: String(new mongoose.Types.ObjectId()),
      role: "platformAdmin",
      name: "Pat",
    });

  /* ------------------------------------------------------------- the keys */

  check("the environment is configured", () => {
    assert.equal(tagKeysConfigured(), true);
  });

  check("a key round-trips through sealing", () => {
    const key = generateTagKey();
    assert.equal(key.length, 16, "AES-128 is what the chip takes");
    const opened = openTagKey(sealTagKey(key));
    assert.equal(opened.toString("hex"), key.toString("hex"));
  });

  check("the sealed form contains no key material", () => {
    const key = generateTagKey();
    const sealed = sealTagKey(key);
    assert.ok(
      !sealed.includes(key.toString("hex")),
      "the key is sitting in the sealed blob in the clear",
    );
    assert.ok(
      !sealed.includes(key.toString("base64")),
      "the key is sitting in the sealed blob in the clear",
    );
  });

  check("sealing twice gives different blobs", () => {
    // A fresh IV each time. Identical ciphertext for identical input would let
    // anyone with the database tell which tags share a key.
    const key = generateTagKey();
    assert.notEqual(sealTagKey(key), sealTagKey(key));
  });

  check("a tampered blob will not open", () => {
    // GCM authenticates, so a tampered blob fails rather than decrypting to a
    // plausible-looking wrong key that would be written onto a chip.
    const sealed = sealTagKey(generateTagKey());
    const [iv, tag, body] = sealed.split(":");
    const flipped = Buffer.from(body, "base64");
    flipped[0] ^= 0xff;
    assert.throws(() =>
      openTagKey([iv, tag, flipped.toString("base64")].join(":")),
    );
  });

  check("a different master key cannot open it", () => {
    const sealed = sealTagKey(generateTagKey());
    const original = process.env.TAG_KEY_MASTER;
    process.env.TAG_KEY_MASTER = crypto.randomBytes(32).toString("hex");
    assert.throws(() => openTagKey(sealed));
    process.env.TAG_KEY_MASTER = original;
  });

  check("a missing master key is a clear refusal, not a crash", () => {
    const original = process.env.TAG_KEY_MASTER;
    delete process.env.TAG_KEY_MASTER;
    assert.equal(tagKeysConfigured(), false);
    assert.throws(() => sealTagKey(generateTagKey()), /TAG_KEY_MASTER/);
    process.env.TAG_KEY_MASTER = original;
  });

  /* ---------------------------------------------------------- ordering */

  let orderNumber;

  await check("a customer sees the catalogue", async () => {
    asCustomer();
    const res = await runWithTenant(String(tenantId), () => getTagProducts());
    assert.equal(res.success, true);
    assert.equal(JSON.parse(res.data).length, 1);
  });

  await check("a customer places an order", async () => {
    asCustomer();
    const res = await runWithTenant(String(tenantId), () =>
      placeTagOrder({
        items: [{ productSku: "RND-30-424", quantity: 3 }],
        shippingAddress: "1 Elm Street",
      }),
    );
    assert.equal(res.success, true, res.message);
    orderNumber = JSON.parse(res.data).orderNumber;
    assert.match(orderNumber, /^TAG-/);
  });

  await check("the total is priced from the catalogue, not the request", async () => {
    // A total the client computed is a total the client chose.
    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    assert.equal(order.total, 3.2 * 3);
  });

  await check("an order below the minimum quantity is refused", async () => {
    asCustomer();
    const res = await runWithTenant(String(tenantId), () =>
      placeTagOrder({
        items: [{ productSku: "RND-30-424", quantity: 1 }],
        shippingAddress: "1 Elm Street",
      }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /minimum order/i);
  });

  await check("an ordinary admin cannot place an order", async () => {
    actAs({
      _id: String(new mongoose.Types.ObjectId()),
      role: "admin",
      tenantId: String(tenantId),
    });
    const res = await runWithTenant(String(tenantId), () =>
      placeTagOrder({
        items: [{ productSku: "RND-30-424", quantity: 5 }],
        shippingAddress: "x",
      }),
    );
    assert.equal(res.success, false);
  });

  await check("THE CUSTOMER NEVER SEES KEY MATERIAL", async () => {
    // The rule the whole feature exists to protect.
    asCustomer();
    const res = await runWithTenant(String(tenantId), () => getTagOrders());
    assert.equal(res.success, true);
    const raw = res.data;
    assert.ok(!raw.includes("keyRef"), "key references reached a customer screen");
    assert.ok(!/units"\s*:\s*\[/.test(raw), "manufacturing detail was exposed");
  });

  /* ------------------------------------------------------- provisioning */

  await check("only a platform admin can work the queue", async () => {
    asCustomer();
    const res = await acceptTagOrder({ orderNumber });
    assert.equal(res.success, false);
    assert.match(res.message, /not authorized/i);
  });

  await check("accepting an order mints one sealed key per unit", async () => {
    asPlatform();
    const res = await acceptTagOrder({ orderNumber });
    assert.equal(res.success, true, res.message);

    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    assert.equal(order.units.length, 3);
    assert.ok(order.units.every((u) => u.status === "keyed"));
    assert.ok(order.units.every((u) => u.keyRef?.includes(":")));

    // Per tag, never shared: losing one sticker must not mean re-keying the lot.
    assert.equal(new Set(order.units.map((u) => u.keyRef)).size, 3);
  });

  await check("accepting twice is refused", async () => {
    const res = await acceptTagOrder({ orderNumber });
    assert.equal(res.success, false);
  });

  let issuedKey;
  await check("the station can fetch a unit's key", async () => {
    const res = await fetchUnitKey({ orderNumber, index: 0 });
    assert.equal(res.success, true, res.message);
    issuedKey = JSON.parse(res.data).key;
    assert.match(issuedKey, /^[0-9A-F]{32}$/, "not a 16-byte hex key");
  });

  await check("the issued key really is the sealed one", async () => {
    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    const unit = order.units.find((u) => u.index === 0);
    assert.equal(tagKeyToHex(openTagKey(unit.keyRef)), issuedKey);
    assert.ok(unit.keyIssuedAt, "the issue was not recorded");
  });

  await check("writing the chip creates the customer's tag", async () => {
    const res = await recordUnitWritten({
      orderNumber,
      index: 0,
      uid: "04:AA:BB:CC:DD:EE:01",
    });
    assert.equal(res.success, true, res.message);

    const tag = await runWithTenant(String(tenantId), () =>
      ClockTag.findOne({ uid: "04AABBCCDDEE01" }).lean(),
    );
    assert.ok(tag, "no tag was created in the customer's registry");
    // Unassigned, so the box arriving means "tap it at a door", not "type a
    // UID into a form".
    assert.equal(tag.status, "unassigned");
    assert.equal(tag.chipType, "ntag424");
  });

  await check("NO SECOND FETCH once the chip is written", async () => {
    // There is no legitimate reason to hand the same key out twice.
    const res = await fetchUnitKey({ orderNumber, index: 0 });
    assert.equal(res.success, false);
    assert.match(res.message, /already been written/i);
  });

  await check("an unverified unit cannot ship", async () => {
    // Nothing verified yet, so there is nothing to put in a box. The rule now
    // lives on the unit rather than on the order — which is what lets the
    // verified ones go while the rest are still being made.
    const res = await dispatchShipment({ orderNumber, carrier: "dpd" });
    assert.equal(res.success, false);
    assert.match(res.message, /nothing is ready/i);
  });

  await check("naming an unverified unit is refused by index", async () => {
    const res = await dispatchShipment({
      orderNumber,
      carrier: "dpd",
      unitIndexes: [1],
    });
    assert.equal(res.success, false);
    assert.match(res.message, /#1 is .*not verified/i);
  });

  await check("an unknown carrier is refused", async () => {
    const res = await dispatchShipment({
      orderNumber,
      carrier: "pigeon",
    });
    assert.equal(res.success, false);
    assert.match(res.message, /unknown carrier/i);
  });

  await check("verifying needs the UID actually on the chip", async () => {
    const res = await verifyUnit({
      orderNumber,
      index: 0,
      uid: "04FFFFFFFFFF99",
    });
    assert.equal(res.success, false);
    assert.match(res.message, /but this unit was written as/i);
  });

  await check("verifying with the right UID passes", async () => {
    const res = await verifyUnit({
      orderNumber,
      index: 0,
      uid: "04AABBCCDDEE01",
    });
    assert.equal(res.success, true, res.message);
  });

  await check("A FAILED WRITE GETS A NEW KEY", async () => {
    // Never reuse a key that may have been half-written to a chip — it could
    // be sitting on hardware somebody else ends up holding.
    const before = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    const oldRef = before.units.find((u) => u.index === 1).keyRef;

    const res = await markUnitFailed({
      orderNumber,
      index: 1,
      reason: "Chip would not take the key change",
    });
    assert.equal(res.success, true, res.message);

    const after = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    const unit = after.units.find((u) => u.index === 1);
    assert.equal(unit.status, "keyed");
    assert.notEqual(unit.keyRef, oldRef, "the same key was reissued");
    assert.equal(unit.keyIssuedAt, null);
  });

  await check("THE POINT: the verified ones ship without the rest", async () => {
    // §6.9. Unit 0 has verified; 1 and 2 have not. The old all-or-nothing
    // action refused, which is right for the tag and wrong for the customer
    // waiting on the one that works.
    const res = await dispatchShipment({
      orderNumber,
      carrier: "dpd",
      trackingRef: "TRACK-1",
    });
    assert.equal(res.success, true, res.message);
    assert.match(res.message, /still to go/i);

    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    assert.equal(order.status, "partially-shipped");
    assert.equal(order.shipments.length, 1);
    assert.equal(order.shipments[0].reference, `${orderNumber}/1`);
    assert.deepEqual(order.shipments[0].unitIndexes, [0]);

    // Only the unit in the box. The old action set units.$[].status, marking
    // every unit shipped whether or not it was in the parcel.
    assert.equal(order.units.find((u) => u.index === 0).status, "shipped");
    assert.notEqual(order.units.find((u) => u.index === 1).status, "shipped");
  });

  await check("a shipped unit is not shipped twice", async () => {
    const res = await dispatchShipment({
      orderNumber,
      carrier: "dpd",
      unitIndexes: [0],
    });
    assert.equal(res.success, false);
    assert.match(res.message, /already shipped/i);
  });

  await check("the rest follow in a second shipment", async () => {
    for (const index of [1, 2]) {
      await fetchUnitKey({ orderNumber, index });
      await recordUnitWritten({
        orderNumber,
        index,
        uid: `04AABBCCDDEE0${index + 1}`,
      });
      await verifyUnit({
        orderNumber,
        index,
        uid: `04AABBCCDDEE0${index + 1}`,
      });
    }

    const res = await dispatchShipment({
      orderNumber,
      carrier: "royal-mail",
      trackingRef: "TRACK-2",
      parcelCount: 2,
    });
    assert.equal(res.success, true, res.message);

    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    assert.equal(order.status, "shipped", "everything is out, so: shipped");
    assert.equal(order.shipments.length, 2);
    assert.equal(order.shipments[1].reference, `${orderNumber}/2`);
    assert.equal(order.shipments[1].parcelCount, 2);
    assert.ok(order.units.every((u) => u.status === "shipped"));
    assert.ok(order.shippedAt, "first dispatch was not recorded");
  });

  await check("delivered only when every box has landed", async () => {
    const first = await markShipmentDelivered({
      orderNumber,
      reference: `${orderNumber}/1`,
    });
    assert.equal(first.success, true, first.message);

    let order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    assert.equal(
      order.status,
      "shipped",
      "one parcel outstanding, so the order has not landed",
    );

    await markShipmentDelivered({
      orderNumber,
      reference: `${orderNumber}/2`,
    });
    order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    assert.equal(order.status, "delivered");
    assert.ok(order.deliveredAt);
    assert.equal(order.shipments[0].deliveredSource, "platform");
  });

  await check("a delivery date before dispatch is clamped", async () => {
    // Otherwise "how long did that take" is a negative number.
    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    const shipped = new Date(order.shipments[0].dispatchedAt);
    assert.ok(
      new Date(order.shipments[0].deliveredAt) >= shipped,
      "delivered before it was dispatched",
    );
  });

  await check("the customer ends up with three unassigned tags", async () => {
    const tags = await runWithTenant(String(tenantId), () =>
      ClockTag.find({}).lean(),
    );
    assert.equal(tags.length, 3);
    assert.ok(tags.every((t) => t.status === "unassigned"));
    assert.ok(tags.every((t) => t.keyRef?.includes(":")));
  });

  /* --------------------------------------------------------------- stock */

  await check("issuing a key takes a blank off the shelf", async () => {
    // Counted at key issue, not at write: this is the moment an operator has
    // one physical chip in their hand. Counting at write would miss every chip
    // that failed; counting at both would count a written-then-failed chip
    // twice.
    const { getStockLevels } = await import("@/server/tagServer/stock");
    const levels = JSON.parse((await getStockLevels()).data);
    const level = levels.find((l) => l.sku === "RND-30-424");
    assert.ok(level, "the product is missing from stock levels");

    // Three fetches happened above, one per unit. The deliberate failure on
    // unit 1 took no blank: its key had been sealed at accept but never
    // fetched, so nobody had picked a chip up for it — which is exactly the
    // distinction counting at fetch is meant to capture.
    assert.equal(
      level.stockOnHand,
      -3,
      "a blank was not counted for every key issued",
    );
  });

  await check("a shortfall warns and refuses nothing", async () => {
    // A count that says zero while an operator holds a blank is the count
    // being wrong. Blocking here would stop a real person doing a thing they
    // are physically doing.
    const { getStockLevels } = await import("@/server/tagServer/stock");
    const levels = JSON.parse((await getStockLevels()).data);
    const level = levels.find((l) => l.sku === "RND-30-424");
    assert.equal(level.short, true, "a negative balance did not flag short");
  });

  await check("receiving stock puts blanks back", async () => {
    const { getStockLevels, receiveStock } = await import(
      "@/server/tagServer/stock"
    );
    const res = await receiveStock({
      sku: "RND-30-424",
      quantity: 100,
      note: "First batch",
    });
    assert.equal(res.success, true, res.message);

    const levels = JSON.parse((await getStockLevels()).data);
    const level = levels.find((l) => l.sku === "RND-30-424");
    assert.equal(level.stockOnHand, 97, "100 received against -3 is 97");
    assert.equal(level.short, false);
  });

  await check("a stocktake takes the counted total, not a difference", async () => {
    // A person at a shelf knows what they counted. Making them subtract is how
    // a correction becomes a second error.
    const { adjustStock, getStockLevels, getStockHistory } = await import(
      "@/server/tagServer/stock"
    );
    const res = await adjustStock({ sku: "RND-30-424", countedTotal: 90 });
    assert.equal(res.success, true, res.message);

    const levels = JSON.parse((await getStockLevels()).data);
    assert.equal(
      levels.find((l) => l.sku === "RND-30-424").stockOnHand,
      90,
      "the counted total was not taken at face value",
    );

    // The ledger says what happened, which is the point of a ledger.
    const history = JSON.parse(
      (await getStockHistory({ sku: "RND-30-424" })).data,
    );
    assert.equal(history[0].reason, "adjusted");
    assert.equal(history[0].delta, -7, "97 counted down to 90 is -7");
  });

  await check("a stocktake that matches writes nothing", async () => {
    // A ledger line that changes nothing is noise a reader has to skip.
    const { adjustStock, getStockHistory } = await import(
      "@/server/tagServer/stock"
    );
    const before = JSON.parse(
      (await getStockHistory({ sku: "RND-30-424" })).data,
    ).length;

    const res = await adjustStock({ sku: "RND-30-424", countedTotal: 90 });
    assert.equal(res.success, true);

    const after = JSON.parse(
      (await getStockHistory({ sku: "RND-30-424" })).data,
    ).length;
    assert.equal(after, before, "a no-op stocktake added a ledger line");
  });

  await check("the cache is a sum, so it heals if it drifts", async () => {
    // Corrupt the cache the way a crash between two writes would, then make a
    // movement: the recount rebuilds from the ledger rather than incrementing
    // whatever it found.
    const TagProduct = (await import("@/models/tagProductModel")).default;
    const { receiveStock, getStockLevels } = await import(
      "@/server/tagServer/stock"
    );

    await TagProduct.updateOne(
      { sku: "RND-30-424" },
      { $set: { stockOnHand: 9999 } },
    );
    await receiveStock({ sku: "RND-30-424", quantity: 10 });

    const levels = JSON.parse((await getStockLevels()).data);
    assert.equal(
      levels.find((l) => l.sku === "RND-30-424").stockOnHand,
      100,
      "the cache was incremented from a wrong value instead of recounted",
    );
  });

  /* ------------------------------------------------ returns and replacements */

  await check("a returned tag is retired in the customer's registry", async () => {
    // The half that matters. A dead chip left `active` is a tag nobody can
    // account for, still offered on the locations screen as though it were in
    // somebody's pocket.
    const before = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    const unit = before.units.find((u) => u.index === 0);

    const res = await recordUnitReturn({
      orderNumber,
      index: 0,
      reason: "Dead on arrival",
    });
    assert.equal(res.success, true, res.message);

    const tag = await runWithTenant(String(tenantId), () =>
      ClockTag.findById(unit.tagId).lean(),
    );
    assert.equal(tag.status, "retired", "the tag is still live in the registry");
    assert.ok(
      tag.history.some(
        (h) => h.toStatus === "retired" && /returned/i.test(h.reason || ""),
      ),
      "the return is not in the tag's history",
    );

    const after = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    assert.equal(after.units.find((u) => u.index === 0).status, "returned");
  });

  await check("a returned unit cannot be returned twice", async () => {
    const res = await recordUnitReturn({ orderNumber, index: 0 });
    assert.equal(res.success, false);
    assert.match(res.message, /already returned/i);
  });

  await check("a replacement joins the same order, linked both ways", async () => {
    // The customer bought three working tags; a replacement is us finishing
    // that, not them buying again.
    const res = await replaceUnit({ orderNumber, index: 0 });
    assert.equal(res.success, true, res.message);

    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    const dead = order.units.find((u) => u.index === 0);
    const fresh = order.units.find((u) => u.index === 3);

    assert.equal(dead.status, "replaced");
    assert.equal(dead.replacedByIndex, 3);
    assert.equal(fresh.replacesIndex, 0);
    assert.equal(fresh.status, "pending", "a replacement starts from scratch");
    assert.equal(fresh.keyRef, undefined, "the dead unit's key was carried over");
  });

  await check("the order reopens while the replacement is made", async () => {
    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    assert.equal(
      order.status,
      "partially-shipped",
      "a replacement still to make means the order is not complete",
    );
  });

  await check("only a returned unit can be replaced", async () => {
    const res = await replaceUnit({ orderNumber, index: 1 });
    assert.equal(res.success, false);
    assert.match(res.message, /only a returned unit/i);
  });

  await check("a unit is not replaced twice", async () => {
    const res = await replaceUnit({ orderNumber, index: 0 });
    assert.equal(res.success, false);
    assert.match(res.message, /already has replacement/i);
  });

  await check("a UID cannot be registered twice", async () => {
    const res = await recordUnitWritten({
      orderNumber,
      index: 2,
      uid: "04AABBCCDDEE01",
    });
    assert.equal(res.success, false);
  });

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s !== "pass");
  for (const [status, name] of results) {
    if (status !== "pass") console.log(`  ${status}  ${name}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` — ${failed.length} FAILED` : ""),
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
