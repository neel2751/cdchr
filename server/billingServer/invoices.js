"use server";

import { connect } from "@/db/db";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { formatMoney, outstanding, totalLines } from "@/lib/money";
import CompanyModel from "@/models/companyModel";
import InvoiceCounterModel from "@/models/invoiceCounterModel";
import InvoiceModel from "@/models/invoiceModel";
import PlatformSettingModel from "@/models/platformSettingModel";
import TagOrderModel from "@/models/tagOrderModel";
import { getServerSideProps } from "../session/session";

/**
 * Invoicing.
 *
 * CLOCK_LOCATION_PLAN.md said three times that this was deliberately outside
 * the app. The reasons were real — card handling drags in PCI scope, and
 * invoicing drags in accounting rules that software gets wrong quietly — so
 * both are met head on rather than worked around:
 *
 *   · No card number ever reaches this application. Stripe's hosted checkout
 *     collects them on Stripe's own page; we hold identifiers and nothing
 *     else. See ./stripe.js.
 *   · An issued invoice cannot be edited, only credited.
 *   · Numbers are sequential, allocated atomically, and never reused.
 *   · Every amount is whole pence. See lib/money.js.
 *
 * WHAT THIS IS NOT: an accounting system. It issues invoices for tag orders
 * and records what was paid against them. It does not do bookkeeping, VAT
 * returns, or the ledger — those live wherever they live now, and this feeds
 * them rather than replacing them.
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

/**
 * The next invoice number, allocated atomically.
 *
 * One findOneAndUpdate with $inc and upsert. Reading the highest number and
 * adding one would be a race, and two invoices sharing a number is not
 * something that can be fixed afterwards — the copies are already out.
 *
 * Called only at issue. A draft that is abandoned must not consume a number,
 * or the sequence has a gap for something that never existed.
 */
async function allocateNumber() {
  const year = new Date().getUTCFullYear();
  const counter = await escapeTenant("invoicing: allocate a number", () =>
    InvoiceCounterModel.findOneAndUpdate(
      { year },
      { $inc: { lastNumber: 1 } },
      { upsert: true, new: true },
    ).lean(),
  );
  return `INV-${year}-${String(counter.lastNumber).padStart(4, "0")}`;
}

/** Our billing identity as it stands right now, to be frozen onto an invoice. */
async function sellerDetails() {
  const settings = await escapeTenant("invoicing: our details", () =>
    PlatformSettingModel.findOne({ singleton: "only" }).lean(),
  );
  return {
    settings: settings || {},
    seller: {
      name: settings?.billingName || settings?.dispatchFromName || "",
      address: settings?.billingAddress || settings?.dispatchFromAddress || "",
      vatNumber: settings?.vatNumber || "",
      companyNumber: settings?.companyNumber || "",
    },
  };
}

/** Everything a screen needs, with the money already formatted. */
function present(invoice) {
  const owed = outstanding(invoice.grossPence, invoice.payments);
  return {
    ...invoice,
    paidPence: invoice.grossPence - owed,
    outstandingPence: owed,
    netFormatted: formatMoney(invoice.netPence, invoice.currency),
    vatFormatted: formatMoney(invoice.vatPence, invoice.currency),
    grossFormatted: formatMoney(invoice.grossPence, invoice.currency),
    outstandingFormatted: formatMoney(owed, invoice.currency),
    // An invoice past its due date with money still on it. Computed here so
    // every screen agrees about what "overdue" means.
    overdue:
      owed > 0 &&
      invoice.status !== "void" &&
      invoice.status !== "draft" &&
      Boolean(invoice.dueAt) &&
      new Date(invoice.dueAt) < new Date(),
  };
}

/** A company's own invoices. Drafts are ours until issued, so they are hidden. */
export async function getMyInvoices() {
  try {
    const { props } = await getServerSideProps();
    const role = props?.session?.user?.role;
    if (!["superAdmin", "admin"].includes(role)) {
      return { success: false, message: "Not authorized" };
    }

    await connect();
    const rows = await InvoiceModel.find({ status: { $ne: "draft" } })
      .sort({ issuedAt: -1, createdAt: -1 })
      .limit(100)
      .lean();

    return { success: true, data: JSON.stringify(rows.map(present)) };
  } catch (error) {
    console.log("Error loading invoices:", error?.message);
    return { success: false, message: "Could not load invoices" };
  }
}

/** Every invoice, across every company. */
export async function getAllInvoices() {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const rows = await escapeTenant("invoicing: every invoice", () =>
      InvoiceModel.find({}).sort({ createdAt: -1 }).limit(200).lean(),
    );

    const companies = await escapeTenant("invoicing: company names", () =>
      CompanyModel.find({ _id: { $in: rows.map((r) => r.tenantId) } })
        .select("name")
        .lean(),
    );
    const nameOf = new Map(companies.map((c) => [String(c._id), c.name]));

    return {
      success: true,
      data: JSON.stringify(
        rows.map((r) => ({
          ...present(r),
          companyName: nameOf.get(String(r.tenantId)) || "Unknown company",
        })),
      ),
    };
  } catch (error) {
    console.log("Error loading all invoices:", error?.message);
    return { success: false, message: "Could not load invoices" };
  }
}

/**
 * Draft an invoice for a tag order.
 *
 * Priced from the order, which was itself priced from the catalogue — never
 * from anything a screen sent. A draft is editable precisely because it is not
 * an invoice yet; the moment it is issued that stops.
 */
export async function draftInvoiceForOrder({ orderNumber, vatRateBasisPoints = 2000 } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const order = await escapeTenant("invoicing: find the order", () =>
      TagOrderModel.findOne({ orderNumber }).lean(),
    );
    if (!order) return { success: false, message: "Order not found" };

    const already = await escapeTenant("invoicing: existing invoice", () =>
      InvoiceModel.findOne({
        orderNumber,
        status: { $ne: "void" },
        kind: "invoice",
      })
        .select("number status")
        .lean(),
    );
    if (already) {
      return {
        success: false,
        message: `${orderNumber} already has an invoice (${already.number || "draft"}). Void it first.`,
      };
    }

    const lines = (order.items || []).map((item) => ({
      description: `${item.productName || item.productSku} × ${item.quantity}`,
      quantity: item.quantity,
      // The order stores a decimal unit price from the catalogue; pence from
      // here on. Rounded once, at the boundary.
      unitPricePence: Math.round(Number(item.unitPrice || 0) * 100),
      vatRateBasisPoints,
    }));
    if (!lines.length) {
      return { success: false, message: "That order has nothing to bill for" };
    }

    const totals = totalLines(lines);
    const company = await escapeTenant("invoicing: the customer", () =>
      CompanyModel.findById(order.tenantId).select("name").lean(),
    );
    const { seller } = await sellerDetails();

    // Created inside the customer's scope: the invoice belongs to them.
    const created = await runWithTenant(String(order.tenantId), () =>
      InvoiceModel.create({
        kind: "invoice",
        status: "draft",
        orderNumber,
        lines,
        currency: order.currency || "GBP",
        ...totals,
        seller,
        buyer: {
          name: company?.name || "",
          address: order.shippingAddress || "",
        },
      }),
    );

    return {
      success: true,
      message: `Draft invoice created for ${orderNumber}`,
      data: JSON.stringify({ id: String(created._id) }),
    };
  } catch (error) {
    console.log("Error drafting an invoice:", error?.message);
    return { success: false, message: "Could not draft that invoice" };
  }
}

/** Change a draft. Refuses anything else — see rule 1 on the model. */
export async function updateDraftInvoice({ id, lines, currency } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid invoice" };
    }

    await connect();
    const invoice = await escapeTenant("invoicing: find", () =>
      InvoiceModel.findById(createObjectId(id)).lean(),
    );
    if (!invoice) return { success: false, message: "Invoice not found" };
    if (invoice.status !== "draft") {
      return {
        success: false,
        message:
          `${invoice.number} has been issued and cannot be changed. ` +
          "Issue a credit note instead — the customer has a copy of this one.",
      };
    }

    const cleaned = (lines || [])
      .map((l) => ({
        description: String(l?.description || "").trim(),
        quantity: Math.max(0, Math.round(Number(l?.quantity) || 0)),
        unitPricePence: Math.round(Number(l?.unitPricePence) || 0),
        vatRateBasisPoints: Math.max(
          0,
          Math.round(Number(l?.vatRateBasisPoints) || 0),
        ),
      }))
      .filter((l) => l.description && l.quantity > 0);

    if (!cleaned.length) {
      return { success: false, message: "An invoice needs at least one line" };
    }

    await escapeTenant("invoicing: update a draft", () =>
      InvoiceModel.updateOne(
        { _id: invoice._id, status: "draft" },
        {
          $set: {
            lines: cleaned,
            ...(currency ? { currency } : {}),
            ...totalLines(cleaned),
          },
        },
      ),
    );

    return { success: true, message: "Draft updated" };
  } catch (error) {
    console.log("Error updating a draft invoice:", error?.message);
    return { success: false, message: "Could not update that draft" };
  }
}

/**
 * Issue it.
 *
 * The one-way door. A number is allocated, the totals and both addresses are
 * frozen, and from here the only ways to change anything are a payment, a
 * void, or a credit note.
 */
export async function issueInvoice({ id } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid invoice" };
    }

    await connect();
    const invoice = await escapeTenant("invoicing: find", () =>
      InvoiceModel.findById(createObjectId(id)).lean(),
    );
    if (!invoice) return { success: false, message: "Invoice not found" };
    if (invoice.status !== "draft") {
      return { success: false, message: `${invoice.number} is already issued` };
    }

    const { settings, seller } = await sellerDetails();
    if (!seller.name || !seller.address) {
      return {
        success: false,
        message:
          "Set the billing name and address first — a VAT invoice has to " +
          "carry the supplier's details, and they are frozen onto it at issue.",
      };
    }

    const now = new Date();
    const termsDays = Math.max(0, Number(settings?.paymentTermsDays) || 30);
    const dueAt = new Date(now.getTime() + termsDays * 86400000);

    // Recomputed from the lines rather than trusted: this is the last moment
    // the figures can be checked, and after it they are permanent.
    const totals = totalLines(invoice.lines);

    // Claimed first. Guarded on still being a draft, so two people pressing
    // Issue together produce one invoice, not two numbers for one document.
    const claimed = await escapeTenant("invoicing: claim the draft", () =>
      InvoiceModel.updateOne(
        { _id: invoice._id, status: "draft" },
        { $set: { status: "issued" } },
      ),
    );
    if (!claimed.modifiedCount) {
      return { success: false, message: "That invoice was just issued by somebody else" };
    }

    // Only now is a number consumed — after the draft is definitely ours.
    const number = await allocateNumber();

    await escapeTenant("invoicing: issue", () =>
      InvoiceModel.updateOne(
        { _id: invoice._id },
        {
          $set: {
            number,
            issuedAt: now,
            issuedByName: auth.user.name,
            dueAt,
            seller,
            ...totals,
          },
        },
      ),
    );

    await logAuditDirect({
      action: "Invoice.issue",
      module: "Invoice",
      entityId: String(invoice._id),
      tenantId: invoice.tenantId,
      description: `Issued ${number} for ${formatMoney(totals.grossPence, invoice.currency)}`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: `${number} issued — ${formatMoney(totals.grossPence, invoice.currency)}, due ${dueAt
        .toISOString()
        .slice(0, 10)}`,
    };
  } catch (error) {
    console.log("Error issuing an invoice:", error?.message);
    return { success: false, message: "Could not issue that invoice" };
  }
}

/**
 * Record money received.
 *
 * Bookkeeping, not card processing: this says what arrived, however it
 * arrived. Part payments are ordinary, so the status follows the arithmetic
 * rather than the operator's intention.
 */
export async function recordInvoicePayment({
  id,
  amountPence,
  method = "bank-transfer",
  reference,
  receivedAt,
} = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid invoice" };
    }

    const amount = Math.round(Number(amountPence) || 0);
    if (amount <= 0) {
      return { success: false, message: "How much was received?" };
    }

    await connect();
    const invoice = await escapeTenant("invoicing: find", () =>
      InvoiceModel.findById(createObjectId(id)).lean(),
    );
    if (!invoice) return { success: false, message: "Invoice not found" };
    if (invoice.status === "draft") {
      return { success: false, message: "That invoice has not been issued yet" };
    }
    if (invoice.status === "void") {
      return { success: false, message: `${invoice.number} is void` };
    }

    const owed = outstanding(invoice.grossPence, invoice.payments);
    if (amount > owed) {
      // Refused rather than absorbed. An overpayment is a real thing that
      // needs a refund or a credit, and silently recording it as paid-in-full
      // loses the difference.
      return {
        success: false,
        message:
          `That is more than the ${formatMoney(owed, invoice.currency)} ` +
          "outstanding. Record the exact amount, or raise a credit note.",
      };
    }

    const stillOwed = owed - amount;
    await escapeTenant("invoicing: record a payment", () =>
      InvoiceModel.updateOne(
        { _id: invoice._id },
        {
          $push: {
            payments: {
              amountPence: amount,
              method,
              reference: (reference || "").trim(),
              receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
              recordedByName: auth.user.name,
            },
          },
          $set: { status: stillOwed === 0 ? "paid" : "part-paid" },
        },
      ),
    );

    await logAuditDirect({
      action: "Invoice.payment",
      module: "Invoice",
      entityId: String(invoice._id),
      tenantId: invoice.tenantId,
      description:
        `${formatMoney(amount, invoice.currency)} recorded against ${invoice.number}` +
        (stillOwed ? `, ${formatMoney(stillOwed, invoice.currency)} still owed` : " — settled"),
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: stillOwed
        ? `Recorded. ${formatMoney(stillOwed, invoice.currency)} still outstanding.`
        : `Recorded. ${invoice.number} is settled.`,
    };
  } catch (error) {
    console.log("Error recording a payment:", error?.message);
    return { success: false, message: "Could not record that payment" };
  }
}

/**
 * Void one.
 *
 * Never deleted. A missing number in the sequence reads as a removed invoice,
 * which is exactly what it would be — so the number stays and the document
 * says it is void.
 */
export async function voidInvoice({ id, reason } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid invoice" };
    }

    await connect();
    const invoice = await escapeTenant("invoicing: find", () =>
      InvoiceModel.findById(createObjectId(id)).lean(),
    );
    if (!invoice) return { success: false, message: "Invoice not found" };
    if (invoice.status === "void") {
      return { success: true, message: `${invoice.number} is already void` };
    }
    if ((invoice.payments || []).length) {
      return {
        success: false,
        message:
          "Money has been received against this. Raise a credit note rather " +
          "than voiding it — voiding would lose the payment record.",
      };
    }

    await escapeTenant("invoicing: void", () =>
      InvoiceModel.updateOne(
        { _id: invoice._id },
        {
          $set: {
            status: "void",
            voidedAt: new Date(),
            voidReason: (reason || "").trim() || "No reason given",
            voidedByName: auth.user.name,
          },
        },
      ),
    );

    await logAuditDirect({
      action: "Invoice.void",
      module: "Invoice",
      entityId: String(invoice._id),
      tenantId: invoice.tenantId,
      description: `Voided ${invoice.number || "a draft"}: ${(reason || "").trim() || "no reason given"}`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: invoice.number
        ? `${invoice.number} is void. The number stays, so the sequence has no gap.`
        : "Draft discarded — no number was used.",
    };
  } catch (error) {
    console.log("Error voiding an invoice:", error?.message);
    return { success: false, message: "Could not void that invoice" };
  }
}

/**
 * Credit an issued invoice.
 *
 * The correct way to undo one that has been sent. A credit note is its own
 * document with its own number, carrying the same lines negated — so the two
 * sit side by side in the sequence and the history shows what happened rather
 * than hiding it.
 */
export async function createCreditNote({ id, reason } = {}) {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.ok) return { success: false, message: auth.message };
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid invoice" };
    }

    await connect();
    const invoice = await escapeTenant("invoicing: find", () =>
      InvoiceModel.findById(createObjectId(id)).lean(),
    );
    if (!invoice) return { success: false, message: "Invoice not found" };
    if (invoice.kind !== "invoice") {
      return { success: false, message: "That is already a credit note" };
    }
    if (invoice.status === "draft") {
      return {
        success: false,
        message: "A draft has not been sent to anybody — change it instead.",
      };
    }

    const existing = await escapeTenant("invoicing: existing credit", () =>
      InvoiceModel.findOne({ creditsInvoiceId: invoice._id })
        .select("number")
        .lean(),
    );
    if (existing) {
      return {
        success: false,
        message: `${invoice.number} was already credited by ${existing.number}`,
      };
    }

    // Negated quantities rather than negated prices: the unit price is what
    // was charged and should still read as that, while the quantity is what
    // is being taken back.
    const lines = (invoice.lines || []).map((l) => ({
      description: l.description,
      quantity: -Math.abs(l.quantity),
      unitPricePence: l.unitPricePence,
      vatRateBasisPoints: l.vatRateBasisPoints,
    }));
    const totals = totalLines(lines);

    const number = await allocateNumber();
    const created = await runWithTenant(String(invoice.tenantId), () =>
      InvoiceModel.create({
        kind: "credit-note",
        creditsInvoiceId: invoice._id,
        status: "issued",
        number: number.replace("INV-", "CRN-"),
        orderNumber: invoice.orderNumber,
        lines,
        currency: invoice.currency,
        ...totals,
        // The seller as it was on the original: a credit note corrects that
        // document, so it has to agree with it.
        seller: invoice.seller,
        buyer: invoice.buyer,
        issuedAt: new Date(),
        issuedByName: auth.user.name,
        voidReason: (reason || "").trim(),
      }),
    );

    await logAuditDirect({
      action: "Invoice.credit",
      module: "Invoice",
      entityId: String(created._id),
      tenantId: invoice.tenantId,
      description:
        `${created.number} credits ${invoice.number} ` +
        `(${formatMoney(totals.grossPence, invoice.currency)})`,
      actor: auth.user,
    }).catch(() => {});

    return {
      success: true,
      message: `${created.number} raised against ${invoice.number}`,
    };
  } catch (error) {
    console.log("Error raising a credit note:", error?.message);
    return { success: false, message: "Could not raise that credit note" };
  }
}
