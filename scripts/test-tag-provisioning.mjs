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
        shipTo: {
          line1: "1 Elm Street",
          city: "London",
          postcode: "SW1A 1AA",
          countryCode: "GB",
        },
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
        shipTo: {
          line1: "1 Elm Street",
          city: "London",
          postcode: "SW1A 1AA",
          countryCode: "GB",
        },
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
        shipTo: {
          line1: "x",
          city: "London",
          postcode: "SW1A 1AA",
          countryCode: "GB",
        },
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

  /* --------------------------------------------------------------- postage */

  await check("postage is refused without a structured address", async () => {
    // The free-text address is not parsed into parts. Guessing which typed
    // line is the city delivers the parcel somewhere else, silently.
    const { buyShipmentLabel } = await import(
      "@/server/tagServer/carrierLabels"
    );
    // Saved through the action rather than written straight into the
    // collection, so the sealing and the hint are the ones the app actually
    // produces.
    const { saveCarrierAccount } = await import(
      "@/server/tagServer/carrierLabels"
    );
    const saved = await saveCarrierAccount({
      provider: "royal-mail",
      credentials: { apiKey: "test-key" },
      isEnabled: true,
    });
    assert.equal(saved.success, true, saved.message);

    // The fixture order has one, so take it away: this is the case where a
    // customer ordered before structured addresses were collected.
    await runWithTenant(String(tenantId), () =>
      TagOrder.updateOne({ orderNumber }, { $unset: { shipTo: "" } }),
    );

    const res = await buyShipmentLabel({
      orderNumber,
      reference: `${orderNumber}/1`,
      provider: "royal-mail",
    });
    assert.equal(res.success, false);
    assert.match(res.message, /structured address/i);
  });

  await check("postage is refused on an invalid postcode", async () => {
    // Checked again at purchase, not only at order time: an order placed
    // before this rule existed would otherwise reach a carrier with a
    // postcode they refuse, or worse, deliver somewhere else.
    const { buyShipmentLabel } = await import(
      "@/server/tagServer/carrierLabels"
    );
    await runWithTenant(String(tenantId), () =>
      TagOrder.updateOne(
        { orderNumber },
        {
          $set: {
            shipTo: {
              line1: "1 Elm Street",
              city: "London",
              postcode: "NOT A POSTCODE",
              countryCode: "GB",
            },
          },
        },
      ),
    );

    const res = await buyShipmentLabel({
      orderNumber,
      reference: `${orderNumber}/1`,
      provider: "royal-mail",
    });
    assert.equal(res.success, false);
    assert.match(res.message, /not a valid UK postcode/i);
  });

  await check("postage is refused without a weight", async () => {
    // Every postage API prices on weight. A guessed one is a surcharge,
    // charged later and to us.
    const { buyShipmentLabel } = await import(
      "@/server/tagServer/carrierLabels"
    );
    await runWithTenant(String(tenantId), () =>
      TagOrder.updateOne(
        { orderNumber },
        {
          $set: {
            shipTo: {
          line1: "1 Elm Street",
          city: "London",
          postcode: "SW1A 1AA",
          countryCode: "GB",
        },
          },
        },
      ),
    );

    const res = await buyShipmentLabel({
      orderNumber,
      reference: `${orderNumber}/1`,
      provider: "royal-mail",
    });
    assert.equal(res.success, false);
    assert.match(res.message, /no weight/i);
  });

  await check("a disabled account cannot buy", async () => {
    // Stored but untested is not the same as ready. An adapter here has never
    // been run against a live account.
    const { buyShipmentLabel } = await import(
      "@/server/tagServer/carrierLabels"
    );
    const CarrierAccount = (await import("@/models/carrierAccountModel")).default;
    const TagProduct = (await import("@/models/tagProductModel")).default;

    await TagProduct.updateOne({ sku: "RND-30-424" }, { $set: { weightGrams: 5 } });
    await CarrierAccount.updateOne(
      { provider: "royal-mail" },
      { $set: { isEnabled: false } },
    );

    const res = await buyShipmentLabel({
      orderNumber,
      reference: `${orderNumber}/1`,
      provider: "royal-mail",
    });
    assert.equal(res.success, false);
    assert.match(res.message, /switched off/i);

    await CarrierAccount.updateOne(
      { provider: "royal-mail" },
      { $set: { isEnabled: true } },
    );
  });

  await check("A LABEL IS BOUGHT AT MOST ONCE", async () => {
    // The rule that protects real money: a second purchase is a second
    // postage charge, and the first label is still on the box.
    const { buyShipmentLabel } = await import(
      "@/server/tagServer/carrierLabels"
    );

    await runWithTenant(String(tenantId), () =>
      TagOrder.updateOne(
        { orderNumber },
        {
          $set: {
            "shipments.$[s].labelData": "JVBERi0xLjQK",
            "shipments.$[s].labelFormat": "pdf",
            "shipments.$[s].labelAllocatedAt": new Date(),
            // A real purchase records who sold it and their reference; the
            // cancel path needs both, so the fixture has to carry them.
            "shipments.$[s].labelProvider": "royal-mail",
            "shipments.$[s].labelProviderRef": "99",
          },
        },
        { arrayFilters: [{ "s.reference": `${orderNumber}/1` }] },
      ),
    );

    const res = await buyShipmentLabel({
      orderNumber,
      reference: `${orderNumber}/1`,
      provider: "royal-mail",
    });
    assert.equal(res.success, false, "it bought a second label");
    assert.match(res.message, /already has a label/i);
  });

  await check("A FAILED CANCEL LEAVES THE LABEL ALONE", async () => {
    // The rule that protects money. The postage is still live and still
    // chargeable until the carrier says otherwise; clearing our copy would
    // only mean nobody can find it again to cancel it properly.
    const { cancelShipmentLabel } = await import(
      "@/server/tagServer/carrierLabels"
    );

    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ message: "Order already despatched" }),
    });

    let res;
    try {
      res = await cancelShipmentLabel({
        orderNumber,
        reference: `${orderNumber}/1`,
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.equal(res.success, false);
    assert.match(res.message, /already despatched/i);

    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    const shipment = order.shipments.find(
      (sh) => sh.reference === `${orderNumber}/1`,
    );
    assert.ok(shipment.labelData, "a failed cancel cleared the label anyway");
    assert.ok(shipment.trackingRef, "a failed cancel cleared the tracking");
    assert.match(shipment.labelError, /Cancel failed/);
  });

  await check("a successful cancel voids the label and the tracking", async () => {
    const { cancelShipmentLabel } = await import(
      "@/server/tagServer/carrierLabels"
    );

    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deletedOrders: [{ orderIdentifier: 1 }], errors: [] }),
    });

    let res;
    try {
      res = await cancelShipmentLabel({
        orderNumber,
        reference: `${orderNumber}/1`,
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.equal(res.success, true, res.message);
    assert.match(res.message, /destroy any printed copy/i);

    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    const shipment = order.shipments.find(
      (sh) => sh.reference === `${orderNumber}/1`,
    );
    assert.ok(!shipment.labelData, "the label survived a cancel");
    assert.ok(
      !shipment.trackingRef,
      "a void tracking number was left for the customer to click",
    );
    assert.match(shipment.labelError, /cancelled at/i);
  });

  await check("a new label can be bought after a cancel", async () => {
    // The parcel still has to get there. The at-most-once guard keys on the
    // stored label, so clearing it is what re-opens the purchase.
    const { buyShipmentLabel } = await import(
      "@/server/tagServer/carrierLabels"
    );
    const res = await buyShipmentLabel({
      orderNumber,
      reference: `${orderNumber}/1`,
      provider: "royal-mail",
    });
    // It gets past the at-most-once guard and fails at the carrier instead,
    // which is the proof: the refusal is no longer "already has a label".
    assert.ok(
      !/already has a label/i.test(res.message),
      `still blocked by the at-most-once guard: ${res.message}`,
    );
  });

  await check("discarding says it does not cancel with the carrier", async () => {
    // Saying "voided" about a label that is still live and still charged
    // would be a lie that costs money.
    const { discardShipmentLabel } = await import(
      "@/server/tagServer/carrierLabels"
    );
    // Put a label back: the cancel above cleared the one this test discards.
    await runWithTenant(String(tenantId), () =>
      TagOrder.updateOne(
        { orderNumber },
        {
          $set: {
            "shipments.$[s].labelData": "JVBERi0xLjQK",
            "shipments.$[s].labelProvider": "royal-mail",
            "shipments.$[s].trackingRef": "AB123456789GB",
          },
        },
        { arrayFilters: [{ "s.reference": `${orderNumber}/1` }] },
      ),
    );
    const res = await discardShipmentLabel({
      orderNumber,
      reference: `${orderNumber}/1`,
    });
    assert.equal(res.success, true, res.message);
    assert.match(res.message, /did not do|does not/i);

    const order = await runWithTenant(String(tenantId), () =>
      TagOrder.findOne({ orderNumber }).lean(),
    );
    const shipment = order.shipments.find(
      (sh) => sh.reference === `${orderNumber}/1`,
    );
    assert.ok(!shipment.labelData, "the stored label survived");
    assert.ok(
      shipment.trackingRef,
      "the tracking number was cleared too — it is still the live one",
    );
  });

  await check("credentials never come back out of the account list", async () => {
    const { getCarrierAccounts } = await import(
      "@/server/tagServer/carrierLabels"
    );
    const payload = JSON.parse((await getCarrierAccounts()).data);
    const serialised = JSON.stringify(payload);

    assert.ok(
      !serialised.includes("test-key"),
      "a plaintext credential reached the screen",
    );
    // Not even the sealed blob: there is no reason for a browser to hold it.
    assert.ok(
      !/[A-Za-z0-9+/]{16,}={0,2}:[A-Za-z0-9+/]{16,}/.test(serialised),
      "a sealed credential reached the screen",
    );
    const rm = payload.providers.find((p) => p.key === "royal-mail");
    assert.equal(rm.hints.apiKey, "····-key", "no hint to identify the key");
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

  /* ------------------------------------------------------------ invoicing */

  await check("an invoice is drafted from the order, priced from it", async () => {
    const { draftInvoiceForOrder } = await import(
      "@/server/billingServer/invoices"
    );
    const res = await draftInvoiceForOrder({ orderNumber });
    assert.equal(res.success, true, res.message);

    const Invoice = (await import("@/models/invoiceModel")).default;
    const draft = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber }).lean(),
    );
    assert.equal(draft.status, "draft");
    assert.equal(draft.number, null, "a draft consumed an invoice number");
    assert.ok(draft.lines.length);
    assert.ok(draft.grossPence > draft.netPence, "no VAT was added");
  });

  await check("issuing needs our billing details on file", async () => {
    // A UK VAT invoice has to carry the supplier's name and address, and they
    // are frozen onto it — so there has to be something to freeze.
    const { issueInvoice } = await import("@/server/billingServer/invoices");
    const Invoice = (await import("@/models/invoiceModel")).default;
    const draft = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber }).lean(),
    );

    const res = await issueInvoice({ id: String(draft._id) });
    assert.equal(res.success, false);
    assert.match(res.message, /billing name and address/i);
  });

  await check("NUMBERS ARE SEQUENTIAL AND ALLOCATED AT ISSUE", async () => {
    const { issueInvoice, draftInvoiceForOrder } = await import(
      "@/server/billingServer/invoices"
    );
    const { saveDispatchSettings } = await import("@/server/tagServer/labels");
    const PlatformSetting = (await import("@/models/platformSettingModel")).default;
    const Invoice = (await import("@/models/invoiceModel")).default;

    await saveDispatchSettings({
      dispatchFromName: "Us Ltd",
      dispatchFromAddress: "Unit 4\nManchester\nM1 1AA",
    });
    await PlatformSetting.updateOne(
      { singleton: "only" },
      { $set: { billingName: "Us Ltd", billingAddress: "Unit 4, Manchester" } },
    );

    const first = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber }).lean(),
    );
    const res = await issueInvoice({ id: String(first._id) });
    assert.equal(res.success, true, res.message);

    const issued = await runWithTenant(String(tenantId), () =>
      Invoice.findById(first._id).lean(),
    );
    const year = new Date().getUTCFullYear();
    assert.equal(issued.number, `INV-${year}-0001`);
    assert.equal(issued.status, "issued");
    assert.ok(issued.issuedAt && issued.dueAt, "no dates were frozen");
    assert.equal(issued.seller.name, "Us Ltd", "the seller was not frozen on");

    // A second invoice takes the next number, not the same one.
    await TagOrder.collection.insertOne({
      tenantId,
      orderNumber: `${orderNumber}-B`,
      status: "placed",
      items: [{ productSku: "RND-30-424", productName: "Disc", quantity: 1, unitPrice: 4.5 }],
      units: [],
      currency: "GBP",
    });
    await draftInvoiceForOrder({ orderNumber: `${orderNumber}-B` });
    const second = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber: `${orderNumber}-B` }).lean(),
    );
    await issueInvoice({ id: String(second._id) });
    const secondIssued = await runWithTenant(String(tenantId), () =>
      Invoice.findById(second._id).lean(),
    );
    assert.equal(secondIssued.number, `INV-${year}-0002`);
  });

  await check("AN ISSUED INVOICE CANNOT BE EDITED", async () => {
    // The customer has a copy. Changing ours makes two documents with one
    // number saying different things.
    const { updateDraftInvoice } = await import(
      "@/server/billingServer/invoices"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;
    const issued = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber, status: "issued" }).lean(),
    );

    const res = await updateDraftInvoice({
      id: String(issued._id),
      lines: [{ description: "Something else", quantity: 1, unitPricePence: 1 }],
    });
    assert.equal(res.success, false);
    assert.match(res.message, /credit note/i);

    const after = await runWithTenant(String(tenantId), () =>
      Invoice.findById(issued._id).lean(),
    );
    assert.equal(after.lines[0].description, issued.lines[0].description);
  });

  await check("a part payment leaves it part-paid", async () => {
    const { recordInvoicePayment } = await import(
      "@/server/billingServer/invoices"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;
    const issued = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber, status: "issued" }).lean(),
    );

    const res = await recordInvoicePayment({
      id: String(issued._id),
      amountPence: 100,
      reference: "FT123",
    });
    assert.equal(res.success, true, res.message);

    const after = await runWithTenant(String(tenantId), () =>
      Invoice.findById(issued._id).lean(),
    );
    assert.equal(after.status, "part-paid");
    assert.equal(after.payments.length, 1);
  });

  await check("AN OVERPAYMENT IS REFUSED, NOT ABSORBED", async () => {
    // Silently recording it as settled loses the difference, which is real
    // money somebody is owed back.
    const { recordInvoicePayment } = await import(
      "@/server/billingServer/invoices"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;
    const issued = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber }).lean(),
    );

    const res = await recordInvoicePayment({
      id: String(issued._id),
      amountPence: issued.grossPence * 10,
    });
    assert.equal(res.success, false);
    assert.match(res.message, /more than the/i);
  });

  await check("paying the rest settles it", async () => {
    const { recordInvoicePayment } = await import(
      "@/server/billingServer/invoices"
    );
    const { outstanding } = await import("@/lib/money");
    const Invoice = (await import("@/models/invoiceModel")).default;
    const issued = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber }).lean(),
    );

    const owed = outstanding(issued.grossPence, issued.payments);
    const res = await recordInvoicePayment({
      id: String(issued._id),
      amountPence: owed,
    });
    assert.equal(res.success, true, res.message);

    const after = await runWithTenant(String(tenantId), () =>
      Invoice.findById(issued._id).lean(),
    );
    assert.equal(after.status, "paid");
  });

  await check("a paid invoice cannot be voided", async () => {
    // Voiding would lose the payment record. That is what credit notes are.
    const { voidInvoice } = await import("@/server/billingServer/invoices");
    const Invoice = (await import("@/models/invoiceModel")).default;
    const paid = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber, status: "paid" }).lean(),
    );

    const res = await voidInvoice({ id: String(paid._id), reason: "oops" });
    assert.equal(res.success, false);
    assert.match(res.message, /credit note/i);
  });

  await check("a credit note negates the original and keeps the trail", async () => {
    const { createCreditNote } = await import(
      "@/server/billingServer/invoices"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;
    const original = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber, kind: "invoice" }).lean(),
    );

    const res = await createCreditNote({
      id: String(original._id),
      reason: "Wrong quantity",
    });
    assert.equal(res.success, true, res.message);

    const credit = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ creditsInvoiceId: original._id }).lean(),
    );
    assert.ok(credit, "no credit note was created");
    assert.match(credit.number, /^CRN-/);
    assert.equal(credit.grossPence, -original.grossPence, "it did not negate");
    assert.ok(credit.lines.every((l) => l.quantity < 0));

    // The original is untouched — the pair tells the story.
    const after = await runWithTenant(String(tenantId), () =>
      Invoice.findById(original._id).lean(),
    );
    assert.equal(after.status, "paid");
    assert.equal(after.grossPence, original.grossPence);
  });

  await check("an invoice is not credited twice", async () => {
    const { createCreditNote } = await import(
      "@/server/billingServer/invoices"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;
    const original = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber, kind: "invoice" }).lean(),
    );
    const res = await createCreditNote({ id: String(original._id) });
    assert.equal(res.success, false);
    assert.match(res.message, /already credited/i);
  });

  await check("a customer never sees a draft", async () => {
    // Drafts are ours until issued.
    const { getMyInvoices, draftInvoiceForOrder } = await import(
      "@/server/billingServer/invoices"
    );
    await TagOrder.collection.insertOne({
      tenantId,
      orderNumber: `${orderNumber}-C`,
      status: "placed",
      items: [{ productSku: "RND-30-424", productName: "Disc", quantity: 1, unitPrice: 4.5 }],
      units: [],
      currency: "GBP",
    });
    await draftInvoiceForOrder({ orderNumber: `${orderNumber}-C` });

    asCustomer();
    const mine = JSON.parse(
      (await runWithTenant(String(tenantId), () => getMyInvoices())).data,
    );
    assert.ok(
      mine.every((i) => i.status !== "draft"),
      "a draft was shown to the customer",
    );
    assert.ok(mine.length, "the issued ones are missing too");

    asPlatform();
  });

  /* ----------------------------------------------------- the Stripe webhook */

  await check("a card payment arrives by webhook and settles the invoice", async () => {
    const { handleStripeEvent } = await import(
      "@/server/billingServer/stripeWebhook"
    );
    const { draftInvoiceForOrder, issueInvoice } = await import(
      "@/server/billingServer/invoices"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;

    await TagOrder.collection.insertOne({
      tenantId,
      orderNumber: `${orderNumber}-W`,
      status: "placed",
      items: [
        { productSku: "RND-30-424", productName: "Disc", quantity: 2, unitPrice: 5 },
      ],
      units: [],
      currency: "GBP",
    });
    await draftInvoiceForOrder({ orderNumber: `${orderNumber}-W` });
    const draft = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber: `${orderNumber}-W` }).lean(),
    );
    await issueInvoice({ id: String(draft._id) });
    const issued = await runWithTenant(String(tenantId), () =>
      Invoice.findById(draft._id).lean(),
    );

    const res = await handleStripeEvent({
      id: "evt_paid_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          payment_status: "paid",
          amount_total: issued.grossPence,
          payment_intent: "pi_1",
          metadata: { invoiceId: String(issued._id) },
        },
      },
    });
    assert.equal(res.ok, true);
    assert.match(res.outcome, /recorded/);

    const after = await runWithTenant(String(tenantId), () =>
      Invoice.findById(issued._id).lean(),
    );
    assert.equal(after.status, "paid");
    assert.equal(after.payments.length, 1);
    assert.equal(after.payments[0].method, "card");
    assert.equal(after.payments[0].reference, "pi_1");
  });

  await check("A RETRY OF THE SAME EVENT IS NOT A SECOND PAYMENT", async () => {
    // Stripe retries for up to three days until it gets a 2xx. Without the
    // event-id guard, one retry is one duplicate payment — and the second
    // looks exactly as real as the first.
    const { handleStripeEvent } = await import(
      "@/server/billingServer/stripeWebhook"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;

    const res = await handleStripeEvent({
      id: "evt_paid_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          payment_status: "paid",
          amount_total: 99999,
          payment_intent: "pi_1",
          metadata: {},
        },
      },
    });
    assert.equal(res.ok, true, "a duplicate must still get a 2xx");
    assert.match(res.outcome, /duplicate/i);

    const after = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber: `${orderNumber}-W` }).lean(),
    );
    assert.equal(after.payments.length, 1, "the retry was recorded again");
  });

  await check("a DIFFERENT event for the same payment is not double counted", async () => {
    // Stripe sends payment_intent.succeeded alongside
    // checkout.session.completed for one payment. The event ids differ, so
    // only the reference guard stops this being counted twice.
    const { handleStripeEvent } = await import(
      "@/server/billingServer/stripeWebhook"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;
    const invoice = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber: `${orderNumber}-W` }).lean(),
    );

    const res = await handleStripeEvent({
      id: "evt_paid_2",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_1",
          amount_received: invoice.grossPence,
          metadata: { invoiceId: String(invoice._id) },
        },
      },
    });
    assert.equal(res.ok, true);

    const after = await runWithTenant(String(tenantId), () =>
      Invoice.findById(invoice._id).lean(),
    );
    assert.equal(after.payments.length, 1, "one payment became two");
  });

  await check("a completed but unpaid session records nothing", async () => {
    // A delayed payment method completes the session and settles days later.
    // Treating that as money received is a parcel shipped against nothing.
    const { handleStripeEvent } = await import(
      "@/server/billingServer/stripeWebhook"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;
    const invoice = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber: `${orderNumber}-W` }).lean(),
    );

    const res = await handleStripeEvent({
      id: "evt_unpaid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_2",
          payment_status: "unpaid",
          amount_total: 1000,
          metadata: { invoiceId: String(invoice._id) },
        },
      },
    });
    assert.match(res.outcome, /payment_status/);

    const after = await runWithTenant(String(tenantId), () =>
      Invoice.findById(invoice._id).lean(),
    );
    assert.equal(after.payments.length, 1);
  });

  await check("an event for an unknown invoice is shrugged off", async () => {
    // It must not throw: a 500 makes Stripe retry an event that will fail
    // identically for three days.
    const { handleStripeEvent } = await import(
      "@/server/billingServer/stripeWebhook"
    );
    const res = await handleStripeEvent({
      id: "evt_orphan",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_3",
          payment_status: "paid",
          amount_total: 500,
          payment_intent: "pi_orphan",
          metadata: { invoiceId: String(new mongoose.Types.ObjectId()) },
        },
      },
    });
    assert.equal(res.ok, true);
    assert.match(res.outcome, /not found/i);
  });

  await check("an event type we do not handle is accepted quietly", async () => {
    const { handleStripeEvent } = await import(
      "@/server/billingServer/stripeWebhook"
    );
    const res = await handleStripeEvent({
      id: "evt_other",
      type: "customer.created",
      data: { object: {} },
    });
    assert.equal(res.ok, true);
    assert.match(res.outcome, /no handler/);
  });

  await check("a webhook never overpays an invoice", async () => {
    // If a bank transfer landed between checkout and callback, the card
    // amount would otherwise take the invoice past its total.
    const { handleStripeEvent } = await import(
      "@/server/billingServer/stripeWebhook"
    );
    const { draftInvoiceForOrder, issueInvoice, recordInvoicePayment } =
      await import("@/server/billingServer/invoices");
    const Invoice = (await import("@/models/invoiceModel")).default;

    await TagOrder.collection.insertOne({
      tenantId,
      orderNumber: `${orderNumber}-X`,
      status: "placed",
      items: [
        { productSku: "RND-30-424", productName: "Disc", quantity: 2, unitPrice: 5 },
      ],
      units: [],
      currency: "GBP",
    });
    await draftInvoiceForOrder({ orderNumber: `${orderNumber}-X` });
    const draft = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber: `${orderNumber}-X` }).lean(),
    );
    await issueInvoice({ id: String(draft._id) });
    const issued = await runWithTenant(String(tenantId), () =>
      Invoice.findById(draft._id).lean(),
    );

    // Half paid by transfer first.
    await recordInvoicePayment({
      id: String(issued._id),
      amountPence: Math.floor(issued.grossPence / 2),
      reference: "BANK-1",
    });

    await handleStripeEvent({
      id: "evt_over",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_4",
          payment_status: "paid",
          amount_total: issued.grossPence,
          payment_intent: "pi_over",
          metadata: { invoiceId: String(issued._id) },
        },
      },
    });

    const after = await runWithTenant(String(tenantId), () =>
      Invoice.findById(issued._id).lean(),
    );
    const paid = after.payments.reduce((t, p) => t + p.amountPence, 0);
    assert.equal(paid, issued.grossPence, `paid ${paid} of ${issued.grossPence}`);
    assert.equal(after.status, "paid");
  });

  /* ------------------------------------------------------- the period lock */

  await check("THE BOOKS CLOSE, AND STAY CLOSED", async () => {
    // Once a VAT return is filed the figures behind it must stop moving.
    // Voiding an old invoice would silently restate a submitted period.
    const { lockLedgerUpTo } = await import("@/server/billingServer/ledger");
    const { voidInvoice, draftInvoiceForOrder, issueInvoice } = await import(
      "@/server/billingServer/invoices"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;

    await TagOrder.collection.insertOne({
      tenantId,
      orderNumber: `${orderNumber}-L`,
      status: "placed",
      items: [
        { productSku: "RND-30-424", productName: "Disc", quantity: 1, unitPrice: 5 },
      ],
      units: [],
      currency: "GBP",
    });
    await draftInvoiceForOrder({ orderNumber: `${orderNumber}-L` });
    const draft = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber: `${orderNumber}-L` }).lean(),
    );
    await issueInvoice({ id: String(draft._id) });

    // Close the books as of today, which includes the invoice just issued.
    const locked = await lockLedgerUpTo({ date: new Date() });
    assert.equal(locked.success, true, locked.message);

    const res = await voidInvoice({ id: String(draft._id), reason: "oops" });
    assert.equal(res.success, false, "a closed period was changed");
    assert.match(res.message, /books are closed/i);
  });

  await check("a backdated payment cannot sneak into a closed period", async () => {
    // The move the lock exists to stop: the change is dated in the past even
    // though it is being made now.
    const { recordInvoicePayment } = await import(
      "@/server/billingServer/invoices"
    );
    const Invoice = (await import("@/models/invoiceModel")).default;
    const invoice = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber: `${orderNumber}-L` }).lean(),
    );

    const res = await recordInvoicePayment({
      id: String(invoice._id),
      amountPence: 100,
      receivedAt: new Date(Date.now() - 30 * 86400000),
    });
    assert.equal(res.success, false);
    assert.match(res.message, /books are closed/i);
  });

  await check("a payment dated today is still fine", async () => {
    // The lock closes the past, not the business.
    const { recordInvoicePayment } = await import(
      "@/server/billingServer/invoices"
    );
    const { lockLedgerUpTo } = await import("@/server/billingServer/ledger");
    const Invoice = (await import("@/models/invoiceModel")).default;

    // Lock to yesterday so today is open.
    await lockLedgerUpTo({ date: new Date(Date.now() - 86400000) });

    const invoice = await runWithTenant(String(tenantId), () =>
      Invoice.findOne({ orderNumber: `${orderNumber}-L` }).lean(),
    );
    const res = await recordInvoicePayment({
      id: String(invoice._id),
      amountPence: 100,
    });
    assert.equal(res.success, true, res.message);
  });

  await check("a lock cannot be set in the future", async () => {
    // It would freeze invoices nobody has raised yet.
    const { lockLedgerUpTo } = await import("@/server/billingServer/ledger");
    const res = await lockLedgerUpTo({
      date: new Date(Date.now() + 30 * 86400000),
    });
    assert.equal(res.success, false);
    assert.match(res.message, /before it has happened/i);
  });

  await check("re-opening a closed period says so out loud", async () => {
    // Moving a lock backwards re-opens something already filed, which is a
    // thing to be told rather than a thing to do quietly.
    const { lockLedgerUpTo } = await import("@/server/billingServer/ledger");
    const res = await lockLedgerUpTo({
      date: new Date(Date.now() - 400 * 86400000),
    });
    assert.equal(res.success, true);
    assert.match(res.message, /re-opens/i);

    const off = await lockLedgerUpTo({ date: null });
    assert.match(off.message, /already filed/i);
  });

  await check("the aged debtors report sees what is owed", async () => {
    const { getAgedDebtors } = await import("@/server/billingServer/ledger");
    const report = JSON.parse((await getAgedDebtors()).data);
    assert.ok(report.totalPence > 0, "nothing was owed by anybody");
    assert.ok(report.rows.length, "no companies in the report");
    assert.ok(report.buckets.every((b) => typeof b.totalPence === "number"));
  });

  await check("a CSV export escapes a name with a comma in it", async () => {
    // Ordinary in real company names, and it splits a row.
    const { exportLedger } = await import("@/server/billingServer/ledger");
    const Company = (await import("@/models/companyModel")).default;
    await Company.updateOne(
      { _id: tenantId },
      { $set: { name: 'Acme, "The" Ltd' } },
    );

    const res = await exportLedger({
      from: new Date(Date.now() - 86400000 * 365),
      to: new Date(),
      shape: "invoices",
    });
    assert.equal(res.success, true, res.message);
    const { csv } = JSON.parse(res.data);
    assert.ok(csv.includes('"Acme, ""The"" Ltd"'), "the name was not escaped");
    // Every row has the same number of cells as the header.
    const rows = csv.split("\r\n").filter(Boolean);
    const cells = (line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).length;
    for (const row of rows.slice(1)) {
      assert.equal(cells(row), cells(rows[0]), `ragged row: ${row}`);
    }
  });

  await check("A JOURNAL EXPORT BALANCES BEFORE IT LEAVES", async () => {
    // Checked here rather than discovered by whoever imports it.
    const { exportLedger } = await import("@/server/billingServer/ledger");
    const res = await exportLedger({
      from: new Date(Date.now() - 86400000 * 365),
      to: new Date(),
      shape: "journal",
    });
    assert.equal(res.success, true, res.message);
    const { balanced } = JSON.parse(res.data);
    assert.equal(balanced, true, res.message);
    assert.match(res.message, /balanced/);
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
