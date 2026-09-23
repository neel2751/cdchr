/**
 * Order status and tracking links, without a database.
 *
 * Both are pure, and both are the kind of thing that is wrong in a way nobody
 * notices: a status that reads "shipped" with half the order on the bench, or
 * a tracking link built for a carrier we have no URL for, which 404s and reads
 * to the customer as "your parcel does not exist".
 *
 * No database and no session — these are functions, not actions.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-tag-delivery.mjs
 */
import assert from "node:assert";

import {
  ORDER_STATUS_LABEL,
  outstandingUnits,
  recomputeOrderStatus,
} from "@/lib/tagOrderStatus";
import {
  CARRIERS,
  carrierName,
  findCarrier,
  trackingUrl,
} from "@/data/carriers";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

/* ------------------------------------------------------------ the status */

const units = (...statuses) =>
  statuses.map((status, index) => ({ index, status }));

check("an order with no shipments keeps its provisioning state", () => {
  assert.equal(
    recomputeOrderStatus({ status: "provisioning", units: units("keyed") }),
    "provisioning",
  );
  assert.equal(
    recomputeOrderStatus({ status: "placed", units: [] }),
    "placed",
  );
});

check("a stale shipped is not kept when nothing has gone out", () => {
  // Otherwise removing every shipment leaves an order claiming to be shipped.
  assert.equal(
    recomputeOrderStatus({ status: "shipped", units: units("verified") }),
    "accepted",
  );
  assert.equal(
    recomputeOrderStatus({ status: "delivered", units: units("verified") }),
    "accepted",
  );
});

check("THE POINT: some out, some not, is partially-shipped", () => {
  // The state that did not exist before shipments did. The old flag was set by
  // the ship action, so an order could read "shipped" with units still on the
  // bench — it recorded that somebody pressed a button.
  assert.equal(
    recomputeOrderStatus({
      status: "provisioning",
      units: units("shipped", "verified", "keyed"),
      shipments: [{ reference: "A/1", unitIndexes: [0], dispatchedAt: new Date() }],
    }),
    "partially-shipped",
  );
});

check("everything out but not landed is shipped", () => {
  assert.equal(
    recomputeOrderStatus({
      status: "partially-shipped",
      units: units("shipped", "shipped"),
      shipments: [
        { reference: "A/1", unitIndexes: [0], dispatchedAt: new Date() },
        { reference: "A/2", unitIndexes: [1], dispatchedAt: new Date() },
      ],
    }),
    "shipped",
  );
});

check("one parcel outstanding means the order has not landed", () => {
  assert.equal(
    recomputeOrderStatus({
      status: "shipped",
      units: units("shipped", "shipped"),
      shipments: [
        { reference: "A/1", deliveredAt: new Date() },
        { reference: "A/2" },
      ],
    }),
    "shipped",
  );
});

check("every parcel landed is delivered", () => {
  assert.equal(
    recomputeOrderStatus({
      status: "shipped",
      units: units("shipped", "shipped"),
      shipments: [
        { reference: "A/1", deliveredAt: new Date() },
        { reference: "A/2", deliveredAt: new Date() },
      ],
    }),
    "delivered",
  );
});

check("a replaced unit is not owed; a returned one still is", () => {
  // A returned unit is owed until a replacement exists — adding one is what
  // marks it `replaced`. Treating a bare return as settled would close an
  // order the customer is still a tag short on.
  const shipments = [{ reference: "A/1", deliveredAt: new Date() }];

  assert.equal(
    recomputeOrderStatus({
      status: "delivered",
      units: units("replaced", "shipped"),
      shipments,
    }),
    "delivered",
  );
  assert.equal(
    recomputeOrderStatus({
      status: "delivered",
      units: units("returned", "shipped"),
      shipments,
    }),
    "partially-shipped",
  );
});

check("a failed unit is still owed", () => {
  // It gets retried, so the order is not finished.
  assert.equal(
    recomputeOrderStatus({
      status: "shipped",
      units: units("shipped", "failed"),
      shipments: [{ reference: "A/1", deliveredAt: new Date() }],
    }),
    "partially-shipped",
  );
});

check("cancelled beats everything", () => {
  assert.equal(
    recomputeOrderStatus({
      status: "cancelled",
      units: units("shipped"),
      shipments: [{ reference: "A/1", deliveredAt: new Date() }],
    }),
    "cancelled",
  );
});

check("outstandingUnits counts what the customer is still waiting on", () => {
  assert.equal(
    outstandingUnits({ units: units("shipped", "replaced", "keyed", "failed") }),
    2,
  );
  assert.equal(outstandingUnits({}), 0);
});

check("every status has a label a customer can read", () => {
  for (const status of [
    "placed",
    "accepted",
    "provisioning",
    "partially-shipped",
    "shipped",
    "delivered",
    "cancelled",
  ]) {
    assert.ok(ORDER_STATUS_LABEL[status], `no label for ${status}`);
    assert.ok(
      !ORDER_STATUS_LABEL[status].includes("-"),
      `${status} still reads like a slug`,
    );
  }
});

/* ---------------------------------------------------------- the carriers */

check("a known carrier builds a link", () => {
  const url = trackingUrl("royal-mail", "AB123456789GB");
  assert.ok(url.startsWith("https://"), url);
  assert.ok(url.includes("AB123456789GB"));
});

check("no link is built where there is nothing safe to link to", () => {
  // A wrong link reads as "your parcel does not exist"; no link reads as
  // "copy this reference", which is always useful.
  assert.equal(trackingUrl("other", "ABC"), null, "carrier has no page");
  assert.equal(trackingUrl("royal-mail", ""), null, "no reference");
  assert.equal(trackingUrl("royal-mail", "   "), null, "blank reference");
  assert.equal(trackingUrl("pigeon-post", "ABC"), null, "unknown carrier");
  assert.equal(trackingUrl(null, "ABC"), null);
});

check("a reference is escaped into the URL", () => {
  // A reference with a space or an ampersand must not break the query string
  // or smuggle another parameter into it.
  const url = trackingUrl("ups", "AB 12&x=1");
  assert.ok(!url.includes(" "), url);
  assert.ok(!/&x=1/.test(url), `an extra parameter got through: ${url}`);
});

check("every carrier is well formed", () => {
  const keys = new Set();
  for (const c of CARRIERS) {
    assert.ok(c.key && c.name, `carrier missing key or name: ${JSON.stringify(c)}`);
    assert.ok(!keys.has(c.key), `duplicate carrier key ${c.key}`);
    keys.add(c.key);
    if (c.track) {
      assert.ok(c.track.startsWith("https://"), `${c.key} is not https`);
      assert.ok(c.track.includes("{ref}"), `${c.key} has no {ref} placeholder`);
    }
  }
  assert.ok(keys.has("other"), "there must be a carrier with no tracking page");
});

check("an unknown carrier still has something to show", () => {
  assert.equal(carrierName("royal-mail"), "Royal Mail");
  // Falls back to whatever was stored rather than rendering nothing.
  assert.equal(carrierName("some-old-value"), "some-old-value");
  assert.equal(carrierName(""), "");
  assert.equal(findCarrier("nope"), null);
});

const failed = results.filter(([s]) => s !== "pass");
for (const [status, name] of results) {
  if (status !== "pass") console.log(`  ${status}  ${name}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — ${failed.length} FAILED` : ""),
);
process.exitCode = failed.length ? 1 : 0;
