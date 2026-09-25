/**
 * The figures an accountant actually asks for.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT, AND WILL NOT BECOME: a general ledger.
 *
 * This application sees exactly one revenue stream — hardware sold to
 * customers — and knows nothing about the bank, payroll, purchases, rent, or
 * anything else the business does. A "trial balance" built from that would
 * balance perfectly and describe a company that does not exist, and somebody
 * reconciling against it would be reconciling against a subset presented as a
 * whole. That is worse than having nothing here, because it looks right.
 *
 * So this computes the things we are genuinely the authority on — who owes us
 * money, and what VAT we charged — and exports them in a shape real accounting
 * software can import. The ledger stays wherever it already is.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything here is whole pence, and every total is a SUM OF STORED FIGURES
 * rather than a recomputation. An invoice's VAT was frozen when it was issued
 * (models/invoiceModel.js, rule 3); recalculating it now at today's rate would
 * quietly restate last year's return.
 */

const DAY_MS = 86400000;

/**
 * VAT basis: which date a sale belongs to.
 *
 * Not a detail — the two bases produce different returns from the same
 * invoices, and picking one silently is how a business files the wrong one.
 *
 *   accrual  the tax point is the INVOICE date. The standard basis: VAT is
 *            owed when the invoice is raised, whether or not it has been paid.
 *   cash     the tax point is the PAYMENT date. Only available below a
 *            turnover threshold, and it has to be chosen with HMRC — it is
 *            not something software decides on a business's behalf.
 */
export const VAT_BASES = [
  { value: "accrual", label: "Accrual — VAT on the invoice date (standard)" },
  { value: "cash", label: "Cash accounting — VAT on the payment date" },
];

/** Inclusive at both ends, on whole days. */
function within(date, from, to) {
  if (!date) return false;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return false;
  return t >= new Date(from).getTime() && t <= new Date(to).getTime();
}

/**
 * Output VAT and net sales for a period.
 *
 * Returns the two figures a UK VAT return actually wants from a sales ledger —
 * box 1 (VAT due on sales) and box 6 (net sales) — plus the invoices behind
 * them, because a number an accountant cannot drill into is a number they will
 * not use.
 *
 * Credit notes are included and are negative, which is what makes them reduce
 * the period they were ISSUED in rather than the one they correct. That is
 * deliberate and it is how credit notes work: you do not restate a filed
 * return, you adjust the current one.
 */
export function vatSummary(invoices = [], { from, to, basis = "accrual" } = {}) {
  let netPence = 0;
  let vatPence = 0;
  const included = [];

  for (const invoice of invoices) {
    // A void invoice never happened. A draft has not happened yet.
    if (invoice.status === "void" || invoice.status === "draft") continue;

    if (basis === "cash") {
      // Each payment is its own tax point, so one invoice can straddle two
      // periods. The VAT is apportioned by how much of the invoice that
      // payment settled — not by the whole invoice's VAT, which would
      // declare tax on money not yet received.
      for (const payment of invoice.payments || []) {
        if (!within(payment.receivedAt, from, to)) continue;
        if (!invoice.grossPence) continue;

        const share = payment.amountPence / invoice.grossPence;
        const net = Math.round(invoice.netPence * share);
        const vat = Math.round(invoice.vatPence * share);
        netPence += net;
        vatPence += vat;
        included.push({
          number: invoice.number,
          date: payment.receivedAt,
          netPence: net,
          vatPence: vat,
          note: "payment",
        });
      }
      continue;
    }

    if (!within(invoice.issuedAt, from, to)) continue;
    netPence += invoice.netPence;
    vatPence += invoice.vatPence;
    included.push({
      number: invoice.number,
      date: invoice.issuedAt,
      netPence: invoice.netPence,
      vatPence: invoice.vatPence,
      note: invoice.kind === "credit-note" ? "credit note" : "invoice",
    });
  }

  return {
    basis,
    from,
    to,
    // Box 1 on a UK VAT return: VAT due on sales.
    box1VatPence: vatPence,
    // Box 6: total value of sales, excluding VAT.
    box6NetPence: netPence,
    count: included.length,
    included,
  };
}

export const AGE_BUCKETS = [
  { key: "current", label: "Not yet due", min: -Infinity, max: 0 },
  { key: "1-30", label: "1–30 days", min: 1, max: 30 },
  { key: "31-60", label: "31–60 days", min: 31, max: 60 },
  { key: "61-90", label: "61–90 days", min: 61, max: 90 },
  { key: "90+", label: "Over 90 days", min: 91, max: Infinity },
];

/**
 * Who owes what, and for how long.
 *
 * The one report this system can produce better than anything else, because it
 * holds the invoices and the payments together. Bucketed by how far past its
 * DUE date each invoice is — not its issue date, which would age everything by
 * the payment terms and make a punctual customer look late.
 */
export function agedDebt(invoices = [], now = Date.now()) {
  const byCompany = new Map();
  const totals = Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, 0]));
  let totalPence = 0;

  for (const invoice of invoices) {
    if (invoice.kind === "credit-note") continue;
    if (!["issued", "part-paid"].includes(invoice.status)) continue;

    const paid = (invoice.payments || []).reduce(
      (t, p) => t + (p.amountPence || 0),
      0,
    );
    const owed = Math.max(0, (invoice.grossPence || 0) - paid);
    if (owed <= 0) continue;

    const days = invoice.dueAt
      ? Math.floor((now - new Date(invoice.dueAt).getTime()) / DAY_MS)
      : 0;
    const bucket =
      AGE_BUCKETS.find((b) => days >= b.min && days <= b.max) || AGE_BUCKETS[0];

    const key = String(invoice.tenantId || "unknown");
    if (!byCompany.has(key)) {
      byCompany.set(key, {
        tenantId: key,
        companyName: invoice.companyName || invoice.buyer?.name || "Unknown",
        totalPence: 0,
        ...Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, 0])),
        invoices: [],
      });
    }
    const row = byCompany.get(key);
    row[bucket.key] += owed;
    row.totalPence += owed;
    row.invoices.push({
      number: invoice.number,
      dueAt: invoice.dueAt,
      owedPence: owed,
      daysPastDue: days,
      bucket: bucket.key,
    });

    totals[bucket.key] += owed;
    totalPence += owed;
  }

  return {
    rows: [...byCompany.values()].sort((a, b) => b.totalPence - a.totalPence),
    totals,
    totalPence,
  };
}

/**
 * One invoice as double-entry journal lines.
 *
 * For EXPORT, not for holding. These are the lines an accountant would post
 * into whatever system actually keeps the books — debtors up, sales up, VAT
 * control up — and producing them here saves somebody retyping.
 *
 * A sale is: debit Debtors (they owe us) with the gross, credit Sales with the
 * net, credit VAT with the tax. A credit note is the same with the signs
 * reversed, which falls out of the negative totals rather than needing its own
 * branch.
 */
export function journalLines(invoice, accounts = {}) {
  const {
    debtors = "1100",
    sales = "4000",
    vat = "2200",
    bank = "1200",
  } = accounts;

  const lines = [];
  const date = invoice.issuedAt;
  const ref = invoice.number;

  if (invoice.status !== "void" && invoice.status !== "draft") {
    lines.push({
      date,
      ref,
      account: debtors,
      description: `${invoice.buyer?.name || ""} — ${ref}`,
      debitPence: invoice.grossPence,
      creditPence: 0,
    });
    lines.push({
      date,
      ref,
      account: sales,
      description: `Tag hardware — ${ref}`,
      debitPence: 0,
      creditPence: invoice.netPence,
    });
    if (invoice.vatPence) {
      lines.push({
        date,
        ref,
        account: vat,
        description: `Output VAT — ${ref}`,
        debitPence: 0,
        creditPence: invoice.vatPence,
      });
    }
  }

  // Each payment moves money from debtors to the bank. Separate lines rather
  // than a netted-off invoice, because the dates differ and the bank
  // reconciliation is done against the payment date.
  for (const payment of invoice.payments || []) {
    lines.push({
      date: payment.receivedAt,
      ref,
      account: bank,
      description: `Payment — ${ref}${payment.reference ? ` (${payment.reference})` : ""}`,
      debitPence: payment.amountPence,
      creditPence: 0,
    });
    lines.push({
      date: payment.receivedAt,
      ref,
      account: debtors,
      description: `Payment — ${ref}`,
      debitPence: 0,
      creditPence: payment.amountPence,
    });
  }

  return lines;
}

/**
 * Do these lines balance?
 *
 * Exported so the export itself can be checked before anybody imports it.
 * Double entry that does not balance is not a rounding annoyance — it is an
 * import that will be rejected, or worse, accepted.
 */
export function balances(lines = []) {
  const debit = lines.reduce((t, l) => t + (l.debitPence || 0), 0);
  const credit = lines.reduce((t, l) => t + (l.creditPence || 0), 0);
  return { debitPence: debit, creditPence: credit, balanced: debit === credit };
}
