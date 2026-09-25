"use server";

import { connect } from "@/db/db";
import { escapeTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { formatMoney, toDecimal } from "@/lib/money";
import {
  AGE_BUCKETS,
  VAT_BASES,
  agedDebt,
  balances,
  journalLines,
  vatSummary,
} from "@/lib/ledger";
import CompanyModel from "@/models/companyModel";
import InvoiceModel from "@/models/invoiceModel";
import PlatformSettingModel from "@/models/platformSettingModel";
import { getServerSideProps } from "../session/session";

/**
 * Reports and exports for whoever keeps the books.
 *
 * See the header of lib/ledger.js for what this deliberately is not. Two
 * further things are deliberately absent and are worth naming rather than
 * leaving as gaps somebody discovers:
 *
 *   NO HMRC SUBMISSION. Making Tax Digital needs vendor registration, an OAuth
 *   grant, and fraud-prevention headers HMRC validates. A VAT return is a
 *   legal filing — an unverified implementation of one is not a bug waiting to
 *   happen, it is a penalty waiting to happen. The figures are produced here
 *   and filed by whoever files them.
 *
 *   NO PURCHASES, PAYROLL OR BANK. We see hardware sales. Anything calling
 *   itself a set of accounts while missing those is describing a different
 *   company.
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

/** Every invoice, with the customer's name attached. */
async function allInvoices() {
  const rows = await escapeTenant("ledger: every invoice", () =>
    InvoiceModel.find({ status: { $ne: "draft" } })
      .sort({ issuedAt: 1 })
      .lean(),
  );

  const companies = await escapeTenant("ledger: company names", () =>
    CompanyModel.find({ _id: { $in: rows.map((r) => r.tenantId) } })
      .select("name")
      .lean(),
  );
  const nameOf = new Map(companies.map((c) => [String(c._id), c.name]));

  return rows.map((r) => ({
    ...r,
    companyName: nameOf.get(String(r.tenantId)) || "Unknown company",
  }));
}

/**
 * Who owes us what, aged.
 *
 * The one report this system produces better than anything else, because it
 * holds the invoices and the payments together and knows which are disputed.
 */
export async function getAgedDebtors() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const report = agedDebt(await allInvoices());

    return {
      success: true,
      data: JSON.stringify({
        buckets: AGE_BUCKETS.map((b) => ({
          ...b,
          // Infinity does not survive JSON, and a bucket boundary of `null`
          // on a screen is worse than not sending it.
          min: Number.isFinite(b.min) ? b.min : null,
          max: Number.isFinite(b.max) ? b.max : null,
          totalPence: report.totals[b.key],
          totalFormatted: formatMoney(report.totals[b.key]),
        })),
        rows: report.rows.map((r) => ({
          ...r,
          totalFormatted: formatMoney(r.totalPence),
        })),
        totalPence: report.totalPence,
        totalFormatted: formatMoney(report.totalPence),
      }),
    };
  } catch (error) {
    console.log("Error building the aged debtors report:", error?.message);
    return { success: false, message: "Could not build that report" };
  }
}

/** Output VAT and net sales for a period, on whichever basis is configured. */
export async function getVatSummary({ from, to, basis } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!from || !to) {
      return { success: false, message: "Which period?" };
    }
    if (new Date(from) > new Date(to)) {
      return { success: false, message: "That period ends before it starts" };
    }

    await connect();
    const settings = await escapeTenant("ledger: settings", () =>
      PlatformSettingModel.findOne({ singleton: "only" })
        .select("vatBasis vatNumber ledgerLockedUpTo")
        .lean(),
    );

    const chosen = basis || settings?.vatBasis || "accrual";
    const summary = vatSummary(await allInvoices(), { from, to, basis: chosen });

    return {
      success: true,
      data: JSON.stringify({
        ...summary,
        bases: VAT_BASES,
        vatNumber: settings?.vatNumber || "",
        lockedUpTo: settings?.ledgerLockedUpTo || null,
        box1Formatted: formatMoney(summary.box1VatPence),
        box6Formatted: formatMoney(summary.box6NetPence),
      }),
    };
  } catch (error) {
    console.log("Error building the VAT summary:", error?.message);
    return { success: false, message: "Could not build that summary" };
  }
}

/** Which basis this business is on. A decision made with HMRC, recorded here. */
export async function setVatBasis({ basis } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!VAT_BASES.some((b) => b.value === basis)) {
      return { success: false, message: "Unknown VAT basis" };
    }

    await connect();
    await escapeTenant("ledger: set the VAT basis", () =>
      PlatformSettingModel.updateOne(
        { singleton: "only" },
        { $set: { vatBasis: basis }, $setOnInsert: { singleton: "only" } },
        { upsert: true },
      ),
    );

    await logAuditDirect({
      action: "Ledger.vatBasis",
      module: "Invoice",
      description: `VAT basis set to ${basis}`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message:
        basis === "cash"
          ? "Cash accounting. VAT falls in the period a payment is received."
          : "Accrual. VAT falls in the period an invoice is issued.",
    };
  } catch (error) {
    console.log("Error setting the VAT basis:", error?.message);
    return { success: false, message: "Could not save that" };
  }
}

/**
 * Close everything up to a date.
 *
 * Once a VAT return has been filed, the figures behind it must stop moving.
 * Without this, voiding an old invoice or backdating a payment silently
 * restates a period that has already been submitted — and the next return does
 * not add up against the last one, months later, with nobody able to say why.
 *
 * The lock is enforced in invoices.js rather than here, at each point that
 * would change a past figure.
 */
export async function lockLedgerUpTo({ date } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    const upTo = date ? new Date(date) : null;
    if (date && Number.isNaN(upTo?.getTime())) {
      return { success: false, message: "That is not a date" };
    }
    if (upTo && upTo > new Date()) {
      // A lock in the future would freeze invoices nobody has raised yet.
      return { success: false, message: "A period cannot be locked before it has happened" };
    }

    await connect();
    const settings = await escapeTenant("ledger: settings", () =>
      PlatformSettingModel.findOne({ singleton: "only" })
        .select("ledgerLockedUpTo")
        .lean(),
    );

    // Moving a lock backwards re-opens a filed period, so it needs saying
    // rather than doing quietly.
    const previous = settings?.ledgerLockedUpTo
      ? new Date(settings.ledgerLockedUpTo)
      : null;
    const loosening = previous && (!upTo || upTo < previous);

    await escapeTenant("ledger: lock", () =>
      PlatformSettingModel.updateOne(
        { singleton: "only" },
        { $set: { ledgerLockedUpTo: upTo }, $setOnInsert: { singleton: "only" } },
        { upsert: true },
      ),
    );

    await logAuditDirect({
      action: "Ledger.lock",
      module: "Invoice",
      description: upTo
        ? `Ledger locked up to ${upTo.toISOString().slice(0, 10)}`
        : "Ledger lock removed",
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: upTo
        ? `Nothing dated on or before ${upTo.toISOString().slice(0, 10)} can be changed now.` +
          (loosening ? " That re-opens a period that was closed — check it against what was filed." : "")
        : "Lock removed. Past periods can be changed again, including ones already filed.",
    };
  } catch (error) {
    console.log("Error locking the ledger:", error?.message);
    return { success: false, message: "Could not set that lock" };
  }
}

/** A CSV cell that cannot break the file, whatever is in it. */
function csvCell(value) {
  const text = String(value ?? "");
  // A company name with a comma in it splits a row; one with a quote in it
  // breaks the quoting. Both are ordinary in real names.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  return [
    headers.join(","),
    ...rows.map((r) => r.map(csvCell).join(",")),
  ].join("\r\n");
}

/**
 * Export for whoever keeps the books.
 *
 * Two shapes, because two different people ask:
 *
 *   `invoices` — one row per document, which is what somebody reconciling a
 *                sales ledger wants.
 *   `journal`  — double-entry lines, which is what somebody posting into
 *                accounting software wants.
 *
 * Amounts are decimal in the CSV, not pence. Everything internal is pence
 * (lib/money.js), but no accounting package imports pence, and converting at
 * the boundary is safer than everywhere else having to remember.
 */
export async function exportLedger({ from, to, shape = "invoices" } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!from || !to) return { success: false, message: "Which period?" };

    await connect();
    const invoices = (await allInvoices()).filter((i) => {
      const date = i.issuedAt;
      return (
        date &&
        new Date(date) >= new Date(from) &&
        new Date(date) <= new Date(to)
      );
    });

    if (shape === "journal") {
      const lines = invoices.flatMap((i) => journalLines(i));
      const check = balances(lines);

      const csv = toCsv(
        ["Date", "Reference", "Account", "Description", "Debit", "Credit"],
        lines.map((l) => [
          l.date ? new Date(l.date).toISOString().slice(0, 10) : "",
          l.ref,
          l.account,
          l.description,
          l.debitPence ? toDecimal(l.debitPence).toFixed(2) : "",
          l.creditPence ? toDecimal(l.creditPence).toFixed(2) : "",
        ]),
      );

      return {
        success: true,
        // Checked before it leaves, not after it has been imported. Double
        // entry that does not balance is an import that gets rejected — or
        // worse, accepted.
        message: check.balanced
          ? `${lines.length} journal line(s), balanced`
          : `${lines.length} line(s) but they do NOT balance ` +
            `(${formatMoney(check.debitPence)} debit vs ${formatMoney(check.creditPence)} credit) — do not import this`,
        data: JSON.stringify({
          csv,
          balanced: check.balanced,
          filename: `journal-${from}-to-${to}.csv`,
        }),
      };
    }

    const csv = toCsv(
      [
        "Number",
        "Type",
        "Date",
        "Due",
        "Customer",
        "Net",
        "VAT",
        "Gross",
        "Paid",
        "Outstanding",
        "Status",
      ],
      invoices.map((i) => {
        const paid = (i.payments || []).reduce(
          (t, p) => t + (p.amountPence || 0),
          0,
        );
        return [
          i.number,
          i.kind,
          i.issuedAt ? new Date(i.issuedAt).toISOString().slice(0, 10) : "",
          i.dueAt ? new Date(i.dueAt).toISOString().slice(0, 10) : "",
          i.companyName,
          toDecimal(i.netPence).toFixed(2),
          toDecimal(i.vatPence).toFixed(2),
          toDecimal(i.grossPence).toFixed(2),
          toDecimal(paid).toFixed(2),
          toDecimal(i.grossPence - paid).toFixed(2),
          i.status,
        ];
      }),
    );

    return {
      success: true,
      message: `${invoices.length} invoice(s) exported`,
      data: JSON.stringify({
        csv,
        balanced: true,
        filename: `invoices-${from}-to-${to}.csv`,
      }),
    };
  } catch (error) {
    console.log("Error exporting the ledger:", error?.message);
    return { success: false, message: "Could not build that export" };
  }
}
