/**
 * Bookkeeping figures.
 *
 * Pure, and worth being exact about for a different reason from the rest of
 * the suite: these numbers go on a VAT return. Being wrong here is not a bug
 * report, it is a filing.
 *
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-ledger.mjs
 */
import assert from "node:assert";

import {
  AGE_BUCKETS,
  VAT_BASES,
  agedDebt,
  balances,
  journalLines,
  vatSummary,
} from "@/lib/ledger";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const Q1 = { from: D(2026, 1, 1), to: D(2026, 3, 31) };
const Q2 = { from: D(2026, 4, 1), to: D(2026, 6, 30) };

/** £100 net, £20 VAT, £120 gross, issued in Q1. */
const invoice = (over = {}) => ({
  kind: "invoice",
  status: "issued",
  number: "INV-2026-0001",
  tenantId: "t1",
  companyName: "Acme",
  netPence: 10000,
  vatPence: 2000,
  grossPence: 12000,
  issuedAt: D(2026, 2, 10),
  dueAt: D(2026, 3, 12),
  payments: [],
  ...over,
});

/* ----------------------------------------------------------------- VAT */

check("accrual puts the VAT in the period the invoice was issued", () => {
  const out = vatSummary([invoice()], { ...Q1, basis: "accrual" });
  assert.equal(out.box1VatPence, 2000);
  assert.equal(out.box6NetPence, 10000);
  assert.equal(out.count, 1);
});

check("an invoice outside the period is not in it", () => {
  const out = vatSummary([invoice()], { ...Q2, basis: "accrual" });
  assert.equal(out.box1VatPence, 0);
  assert.equal(out.count, 0);
});

check("VOID AND DRAFT ARE NEVER IN A RETURN", () => {
  // A void invoice never happened; a draft has not happened yet. Either one
  // in a return is tax declared on a sale that does not exist.
  for (const status of ["void", "draft"]) {
    const out = vatSummary([invoice({ status })], { ...Q1, basis: "accrual" });
    assert.equal(out.box1VatPence, 0, status);
  }
});

check("A CREDIT NOTE REDUCES THE PERIOD IT WAS ISSUED IN", () => {
  // Not the one it corrects. You do not restate a filed return — you adjust
  // the current one, which is why the credit sits in Q2 here.
  const credit = invoice({
    kind: "credit-note",
    number: "CRN-2026-0002",
    netPence: -10000,
    vatPence: -2000,
    grossPence: -12000,
    issuedAt: D(2026, 5, 5),
  });

  const q1 = vatSummary([invoice(), credit], { ...Q1, basis: "accrual" });
  assert.equal(q1.box1VatPence, 2000, "Q1 was restated by a later credit");

  const q2 = vatSummary([invoice(), credit], { ...Q2, basis: "accrual" });
  assert.equal(q2.box1VatPence, -2000);
  assert.equal(q2.box6NetPence, -10000);
});

check("cash accounting puts the VAT on the payment date", () => {
  // Issued in Q1, paid in Q2. The two bases genuinely disagree, which is why
  // picking one silently would be a wrong return.
  const paid = invoice({
    status: "paid",
    payments: [{ amountPence: 12000, receivedAt: D(2026, 4, 20) }],
  });

  assert.equal(vatSummary([paid], { ...Q1, basis: "cash" }).box1VatPence, 0);
  assert.equal(vatSummary([paid], { ...Q2, basis: "cash" }).box1VatPence, 2000);
  // And accrual says the opposite, on the same invoice.
  assert.equal(vatSummary([paid], { ...Q1, basis: "accrual" }).box1VatPence, 2000);
});

check("A PART PAYMENT DECLARES PART OF THE VAT", () => {
  // Under cash accounting, declaring the whole invoice's VAT on a half
  // payment is tax paid on money not yet received.
  const half = invoice({
    status: "part-paid",
    payments: [{ amountPence: 6000, receivedAt: D(2026, 4, 20) }],
  });
  const out = vatSummary([half], { ...Q2, basis: "cash" });
  assert.equal(out.box1VatPence, 1000, "the whole VAT was declared on half the money");
  assert.equal(out.box6NetPence, 5000);
});

check("one invoice can straddle two periods on a cash basis", () => {
  const split = invoice({
    status: "paid",
    payments: [
      { amountPence: 6000, receivedAt: D(2026, 3, 20) },
      { amountPence: 6000, receivedAt: D(2026, 4, 20) },
    ],
  });
  assert.equal(vatSummary([split], { ...Q1, basis: "cash" }).box1VatPence, 1000);
  assert.equal(vatSummary([split], { ...Q2, basis: "cash" }).box1VatPence, 1000);
});

check("both bases are offered rather than assumed", () => {
  assert.equal(VAT_BASES.length, 2);
  assert.ok(VAT_BASES.some((b) => b.value === "accrual"));
  assert.ok(VAT_BASES.some((b) => b.value === "cash"));
});

/* --------------------------------------------------------- aged debtors */

check("debt is aged from the DUE date, not the issue date", () => {
  // Ageing from issue would make a punctual customer on 30-day terms look a
  // month late on the day they receive the invoice.
  const now = D(2026, 3, 20).getTime(); // 8 days after due
  const report = agedDebt([invoice()], now);
  assert.equal(report.totalPence, 12000);
  assert.equal(report.rows[0]["1-30"], 12000);
  assert.equal(report.rows[0].current, 0);
});

check("something not yet due sits in current", () => {
  const now = D(2026, 3, 1).getTime();
  const report = agedDebt([invoice()], now);
  assert.equal(report.rows[0].current, 12000);
});

check("the buckets cover every age with no gaps", () => {
  for (const days of [-100, 0, 1, 30, 31, 60, 61, 90, 91, 5000]) {
    const hit = AGE_BUCKETS.filter((b) => days >= b.min && days <= b.max);
    assert.equal(hit.length, 1, `${days} days matched ${hit.length} buckets`);
  }
});

check("only what is owed is aged", () => {
  const now = D(2026, 4, 1).getTime();
  const cases = [
    invoice({ status: "paid" }),
    invoice({ status: "void" }),
    invoice({ kind: "credit-note" }),
    invoice({ payments: [{ amountPence: 12000 }] }),
  ];
  for (const inv of cases) {
    assert.equal(agedDebt([inv], now).totalPence, 0, inv.status + inv.kind);
  }
});

check("a part payment ages only the remainder", () => {
  const now = D(2026, 4, 1).getTime();
  const report = agedDebt(
    [invoice({ status: "part-paid", payments: [{ amountPence: 5000 }] })],
    now,
  );
  assert.equal(report.totalPence, 7000);
});

check("debt is grouped by company, worst first", () => {
  const now = D(2026, 4, 1).getTime();
  const report = agedDebt(
    [
      invoice({ tenantId: "small", companyName: "Small", grossPence: 1000 }),
      invoice({ tenantId: "big", companyName: "Big", grossPence: 90000 }),
    ],
    now,
  );
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0].companyName, "Big");
  assert.equal(report.totalPence, 91000);
});

/* -------------------------------------------------------- journal lines */

check("AN INVOICE'S JOURNAL LINES BALANCE", () => {
  // Double entry that does not balance is an import that gets rejected, or
  // worse, accepted.
  const lines = journalLines(invoice());
  const out = balances(lines);
  assert.equal(out.balanced, true, `${out.debitPence} vs ${out.creditPence}`);
  assert.equal(out.debitPence, 12000);
});

check("a payment balances too, and moves debtors to bank", () => {
  const lines = journalLines(
    invoice({ status: "paid", payments: [{ amountPence: 12000, receivedAt: D(2026, 4, 1) }] }),
  );
  assert.equal(balances(lines).balanced, true);
  // Gross in, gross out: nothing owed once it is settled.
  const debtors = lines.filter((l) => l.account === "1100");
  const net = debtors.reduce((t, l) => t + l.debitPence - l.creditPence, 0);
  assert.equal(net, 0, "the debtor balance did not clear");
});

check("a credit note's lines balance with the signs reversed", () => {
  const lines = journalLines(
    invoice({
      kind: "credit-note",
      netPence: -10000,
      vatPence: -2000,
      grossPence: -12000,
    }),
  );
  assert.equal(balances(lines).balanced, true);
  assert.equal(balances(lines).debitPence, -12000);
});

check("a void invoice posts nothing", () => {
  assert.deepEqual(journalLines(invoice({ status: "void" })), []);
});

check("a zero-rated invoice posts no VAT line", () => {
  // A zero-value line in an import is noise at best and a rejected row at
  // worst.
  const lines = journalLines(
    invoice({ vatPence: 0, grossPence: 10000 }),
  );
  assert.equal(lines.filter((l) => l.account === "2200").length, 0);
  assert.equal(balances(lines).balanced, true);
});

check("a whole period's lines balance together", () => {
  const lines = [
    invoice(),
    invoice({ number: "INV-2", status: "paid", payments: [{ amountPence: 12000 }] }),
    invoice({
      number: "CRN-1",
      kind: "credit-note",
      netPence: -10000,
      vatPence: -2000,
      grossPence: -12000,
    }),
    invoice({ number: "INV-3", status: "void" }),
  ].flatMap((i) => journalLines(i));

  assert.equal(balances(lines).balanced, true);
});

check("nothing throws on a half-built invoice", () => {
  for (const bad of [{}, { payments: null }, { status: "issued" }]) {
    assert.ok(Array.isArray(journalLines(bad)));
    assert.ok(balances(journalLines(bad)));
  }
  assert.equal(agedDebt([]).totalPence, 0);
  assert.equal(vatSummary([], Q1).box1VatPence, 0);
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
