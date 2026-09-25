/**
 * Money arithmetic.
 *
 * Pure, and worth being exact about: every one of these failing is a penny
 * that turns up months later as a total nobody can reconcile.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-money.mjs
 */
import assert from "node:assert";

import {
  formatMoney,
  outstanding,
  toDecimal,
  toPence,
  totalLines,
  vatOn,
} from "@/lib/money";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

check("pounds convert to whole pence", () => {
  assert.equal(toPence(12.34), 1234);
  assert.equal(toPence("12.34"), 1234);
  assert.equal(toPence(0), 0);
  assert.equal(toPence(-1.5), -150);
});

check("FLOAT DRIFT IS ROUNDED AWAY, NOT TRUNCATED", () => {
  // 19.99 * 100 is 1998.9999999999998 in IEEE 754. Truncating gives 1998 —
  // a penny lost on an amount somebody typed exactly.
  assert.equal(toPence(19.99), 1999);
  assert.equal(toPence(0.1 + 0.2), 30);
  assert.equal(toPence(1.005), 101);
});

check("rubbish is zero, not NaN", () => {
  // A NaN loose in a total poisons every sum downstream and shows up as
  // "£NaN" on a document somebody has already posted.
  assert.equal(toPence(undefined), 0);
  assert.equal(toPence("abc"), 0);
  assert.equal(toPence(null), 0);
  assert.equal(toPence(Infinity), 0);
});

check("pence convert back for display", () => {
  assert.equal(toDecimal(1234), 12.34);
  assert.equal(toDecimal(0), 0);
  assert.equal(toDecimal(5), 0.05);
});

check("money formats as money", () => {
  assert.match(formatMoney(123456), /1,234\.56/);
  assert.match(formatMoney(0), /0\.00/);
  // An unknown currency must not take a page down.
  assert.match(formatMoney(100, "XYZ"), /XYZ|1\.00/);
});

check("VAT is basis points, so 20% is exact", () => {
  // 0.2 is not representable as a float either; basis points sidestep it.
  assert.equal(vatOn(10000, 2000), 2000);
  assert.equal(vatOn(999, 2000), 200); // 199.8 rounds to 200
  assert.equal(vatOn(10000, 500), 500);
  assert.equal(vatOn(10000, 0), 0);
  assert.equal(vatOn(0, 2000), 0);
});

check("ROUNDING HAPPENS ON THE LINE, NOT THE UNIT", () => {
  // Three at £4.995. Rounding each unit first gives 3 × 500 = 1500; doing it
  // once on the line gives 1498 (well, 1498.5 → the line is computed from
  // whole-pence units, so this checks the order of operations end to end).
  const lines = [{ quantity: 3, unitPricePence: 499, vatRateBasisPoints: 2000 }];
  const t = totalLines(lines);
  assert.equal(t.netPence, 1497);
  // 1497 * 0.2 = 299.4 -> 299. Rounding per unit would give 3 × 100 = 300.
  assert.equal(t.vatPence, 299, "VAT was rounded per unit instead of per line");
  assert.equal(t.grossPence, 1796);
});

check("lines at different VAT rates are summed separately", () => {
  // A single rate applied to the grand total would be wrong the moment one
  // line is zero-rated.
  const t = totalLines([
    { quantity: 1, unitPricePence: 10000, vatRateBasisPoints: 2000 },
    { quantity: 1, unitPricePence: 10000, vatRateBasisPoints: 0 },
  ]);
  assert.equal(t.netPence, 20000);
  assert.equal(t.vatPence, 2000, "the zero-rated line was taxed");
  assert.equal(t.grossPence, 22000);
});

check("a credit note's negative quantities total negative", () => {
  const t = totalLines([
    { quantity: -2, unitPricePence: 500, vatRateBasisPoints: 2000 },
  ]);
  assert.equal(t.netPence, -1000);
  assert.equal(t.vatPence, -200);
  assert.equal(t.grossPence, -1200);
});

check("an empty invoice totals zero rather than NaN", () => {
  assert.deepEqual(totalLines([]), {
    netPence: 0,
    vatPence: 0,
    grossPence: 0,
  });
  assert.deepEqual(totalLines(), { netPence: 0, vatPence: 0, grossPence: 0 });
});

check("a malformed line does not poison the total", () => {
  const t = totalLines([
    { quantity: 2, unitPricePence: 1000, vatRateBasisPoints: 2000 },
    { quantity: "x", unitPricePence: undefined },
  ]);
  assert.equal(t.netPence, 2000);
  assert.ok(Number.isFinite(t.grossPence));
});

check("outstanding subtracts what has been paid", () => {
  assert.equal(outstanding(10000, []), 10000);
  assert.equal(outstanding(10000, [{ amountPence: 4000 }]), 6000);
  assert.equal(
    outstanding(10000, [{ amountPence: 4000 }, { amountPence: 6000 }]),
    0,
  );
});

check("an overpayment does not make the balance negative", () => {
  // A negative outstanding would read as a credit the customer does not have,
  // and would flip an invoice's status by arithmetic accident.
  assert.equal(outstanding(10000, [{ amountPence: 15000 }]), 0);
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
