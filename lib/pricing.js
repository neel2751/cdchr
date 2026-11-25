/**
 * What a company pays: packages with allowances, and a price per person over.
 *
 *   monthly fee for the package (Essentials, Workforce, Enterprise)
 *   + each office staff member over the package's allowance
 *   + each worker — student, site employee — over its allowance (cheaper)
 *   + each GB of storage over its allowance
 *   + modules bought on top of the package (add-ons)
 *
 * Counted per company, so each company's usage and allowances stand on their
 * own. A customer's second company (a branch) pays a discounted package fee —
 * the people in it are still counted there.
 *
 * Then a deal discount, if one was agreed; yearly billing is twelve months
 * less the yearly discount; VAT on top.
 *
 * Pure and in pence, so the console's calculator, the price stamped on a
 * company when a plan is applied, and (Step 5) the monthly invoice all come
 * out of the same arithmetic.
 */

import { FEATURES } from "@/data/features";

/** People and storage a package includes, and what one more of each costs. */
export const ALLOWANCES = [
  { key: "officeStaff", label: "Office staff", unit: "person", extraKey: "officeStaff" },
  { key: "workers", label: "Students / site workers", unit: "person", extraKey: "worker" },
  { key: "storageGb", label: "Storage", unit: "GB", extraKey: "storageGb" },
];

/**
 * The packages a fresh console starts with. SUGGESTIONS — the console says so
 * until a person has looked at them and saved — and every figure, name and
 * module is editable there.
 */
export const DEFAULT_PLANS = [
  {
    key: "essentials",
    name: "Essentials",
    description: "Attendance, leave and documents for a small team.",
    sortOrder: 1,
    isActive: true,
    monthlyPence: 4900,
    included: { officeStaff: 10, workers: 25, storageGb: 5 },
    extraPence: { officeStaff: 400, worker: 150, storageGb: 50 },
    features: [
      "siteEmployees",
      "leave",
      "attendanceReports",
      "documents",
      "announcements",
      "policies",
    ],
  },
  {
    key: "workforce",
    name: "Workforce",
    description: "Sites, rotas, expenses and the front desk for a growing workforce.",
    sortOrder: 2,
    isActive: true,
    monthlyPence: 12900,
    included: { officeStaff: 25, workers: 100, storageGb: 25 },
    extraPence: { officeStaff: 350, worker: 125, storageGb: 40 },
    features: [
      "siteEmployees",
      "siteProjects",
      "weeklyRota",
      "leave",
      "attendanceReports",
      "documents",
      "announcements",
      "policies",
      "expenses",
      "visitors",
      "reception",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "Everything, for large and multi-site organisations.",
    sortOrder: 3,
    isActive: true,
    monthlyPence: 34900,
    included: { officeStaff: 75, workers: 400, storageGb: 100 },
    extraPence: { officeStaff: 300, worker: 100, storageGb: 30 },
    features: FEATURES.map((f) => f.key),
  },
];

/** The price list around the packages. Also editable in the console. */
export const DEFAULT_PRICING_SETTINGS = {
  currency: "GBP",
  // Twelve months for the price of about ten.
  yearlyDiscountPercent: 15,
  // Off the package fee of a customer's second and later company.
  extraCompanyDiscountPercent: 25,
  vatRateBasisPoints: 2000,
  // A module bought on top of a package that does not include it, a month.
  // Absent or 0: not sold on its own.
  addOnPence: {
    crm: 2000,
    expenses: 1500,
    visitors: 1000,
    reception: 1500,
    siteProjects: 2000,
    weeklyRota: 1000,
    devices: 1500,
    ai: 2500,
  },
  // A free trial without an offer code. Codes (TrialOffer) can give longer.
  trialDays: 14,
  // The monthly billing run. Off until switched on — see pricingSettingModel.
  billingEnabled: false,
  invoiceTermsDays: 14,
  unpaidReadOnlyDays: 7,
  unpaidLockDays: 14,
};

const int = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))) : 0);
const pct = (n) => Math.min(100, Math.max(0, Number(n) || 0));
const percentOf = (pence, percent) => Math.round((pence * pct(percent)) / 100);

/** Modules a company on `plan` could add, with their monthly price. */
export function addOnsFor(plan, settings) {
  const included = new Set(plan?.features || []);
  return FEATURES.filter(
    (f) => !included.has(f.key) && int(settings?.addOnPence?.[f.key]) > 0
  ).map((f) => ({
    key: f.key,
    label: f.label,
    pence: int(settings.addOnPence[f.key]),
  }));
}

/**
 * One company's monthly lines, before any deal discount.
 *
 * @param {object} company { label, planKey, officeStaff, workers, storageGb,
 *                           addOns: string[], extraCompany: boolean }
 */
export function companyLines(company, plans, settings) {
  const plan = plans.find((p) => p.key === company.planKey);
  if (!plan) return { plan: null, lines: [], monthlyPence: 0 };

  const lines = [];
  const base = int(plan.monthlyPence);
  const off = company.extraCompany ? percentOf(base, settings.extraCompanyDiscountPercent) : 0;
  lines.push({
    key: "base",
    label: company.extraCompany
      ? `${plan.name} package (extra company, ${pct(settings.extraCompanyDiscountPercent)}% off)`
      : `${plan.name} package`,
    quantity: 1,
    unitPence: base - off,
    totalPence: base - off,
  });

  for (const a of ALLOWANCES) {
    const used =
      a.key === "storageGb" ? Math.ceil(Math.max(0, Number(company[a.key]) || 0)) : int(company[a.key]);
    const over = Math.max(0, used - int(plan.included?.[a.key]));
    if (!over) continue;
    const unit = int(plan.extraPence?.[a.extraKey]);
    lines.push({
      key: `extra-${a.key}`,
      label: `${a.label} over the ${int(plan.included?.[a.key])} included`,
      quantity: over,
      unitPence: unit,
      totalPence: over * unit,
      unit: a.unit,
    });
  }

  const sellable = new Map(addOnsFor(plan, settings).map((a) => [a.key, a]));
  for (const key of company.addOns || []) {
    const addOn = sellable.get(key);
    if (!addOn) continue;
    lines.push({
      key: `addon-${key}`,
      label: `${addOn.label} (add-on)`,
      quantity: 1,
      unitPence: addOn.pence,
      totalPence: addOn.pence,
    });
  }

  return {
    plan,
    lines,
    monthlyPence: lines.reduce((sum, l) => sum + l.totalPence, 0),
  };
}

/**
 * A full quote: one or more companies, a billing cycle, a deal discount.
 *
 * The first company pays the full package fee and the rest are discounted
 * unless a company says otherwise (`extraCompany` set explicitly) — which is
 * how a single company already belonging to a customer is quoted.
 *
 * @param {{
 *   companies: object[],
 *   cycle?: "monthly"|"yearly",
 *   discountPercent?: number,
 *   plans: object[],
 *   settings: object,
 * }} input
 */
export function quote({ companies = [], cycle = "monthly", discountPercent = 0, plans, settings }) {
  const s = { ...DEFAULT_PRICING_SETTINGS, ...(settings || {}) };
  const priced = companies.map((c, i) =>
    companyLines(
      { ...c, extraCompany: c.extraCompany ?? i > 0 },
      plans || [],
      s
    )
  );

  const subtotal = priced.reduce((sum, c) => sum + c.monthlyPence, 0);
  const deal = percentOf(subtotal, discountPercent);
  const monthlyNet = subtotal - deal;

  const yearly = cycle === "yearly";
  const yearlyFull = monthlyNet * 12;
  const yearlyOff = yearly ? percentOf(yearlyFull, s.yearlyDiscountPercent) : 0;
  const periodNet = yearly ? yearlyFull - yearlyOff : monthlyNet;
  const vat = Math.round((periodNet * int(s.vatRateBasisPoints)) / 10000);

  return {
    currency: s.currency,
    cycle: yearly ? "yearly" : "monthly",
    companies: priced.map((c, i) => ({
      label: companies[i]?.label || `Company ${i + 1}`,
      planKey: c.plan?.key || null,
      planName: c.plan?.name || null,
      lines: c.lines,
      monthlyPence: c.monthlyPence,
    })),
    monthlySubtotalPence: subtotal,
    discountPercent: pct(discountPercent),
    discountPence: deal,
    monthlyNetPence: monthlyNet,
    yearlyDiscountPercent: yearly ? pct(s.yearlyDiscountPercent) : 0,
    yearlyDiscountPence: yearlyOff,
    periodNetPence: periodNet,
    vatRateBasisPoints: int(s.vatRateBasisPoints),
    vatPence: vat,
    periodGrossPence: periodNet + vat,
  };
}

/**
 * Tidy a plan from the console: numbers to whole pence, unknown modules
 * dropped. Returns `{ plan }` or `{ error }`.
 */
export function cleanPlan(input = {}) {
  const key = String(input.key || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(key)) return { error: "The plan needs a short key" };
  const name = String(input.name || "").trim();
  if (!name) return { error: "The plan needs a name" };
  const known = new Set(FEATURES.map((f) => f.key));
  return {
    plan: {
      key,
      name: name.slice(0, 60),
      description: String(input.description || "").trim().slice(0, 300),
      sortOrder: int(input.sortOrder),
      isActive: input.isActive !== false,
      monthlyPence: int(input.monthlyPence),
      included: {
        officeStaff: int(input.included?.officeStaff),
        workers: int(input.included?.workers),
        storageGb: int(input.included?.storageGb),
      },
      extraPence: {
        officeStaff: int(input.extraPence?.officeStaff),
        worker: int(input.extraPence?.worker),
        storageGb: int(input.extraPence?.storageGb),
      },
      features: [...new Set((input.features || []).filter((k) => known.has(k)))],
    },
  };
}

/** Tidy the price list settings from the console. */
export function cleanPricingSettings(input = {}) {
  const known = new Set(FEATURES.map((f) => f.key));
  const addOnPence = {};
  for (const [key, value] of Object.entries(input.addOnPence || {})) {
    if (known.has(key)) addOnPence[key] = int(value);
  }
  const trialDays = int(input.trialDays);
  return {
    currency: "GBP",
    yearlyDiscountPercent: pct(input.yearlyDiscountPercent),
    extraCompanyDiscountPercent: pct(input.extraCompanyDiscountPercent),
    vatRateBasisPoints: Math.min(10000, int(input.vatRateBasisPoints)),
    addOnPence,
    // A trial of 1 to 365 days. Zero would lock a company the moment it
    // signed up.
    trialDays: Math.min(365, Math.max(1, trialDays || DEFAULT_PRICING_SETTINGS.trialDays)),
    billingEnabled: input.billingEnabled === true,
    invoiceTermsDays: Math.min(90, int(input.invoiceTermsDays ?? DEFAULT_PRICING_SETTINGS.invoiceTermsDays)),
    unpaidReadOnlyDays: Math.min(365, int(input.unpaidReadOnlyDays ?? DEFAULT_PRICING_SETTINGS.unpaidReadOnlyDays)),
    unpaidLockDays: Math.min(365, int(input.unpaidLockDays ?? DEFAULT_PRICING_SETTINGS.unpaidLockDays)),
  };
}

/**
 * An offer code as typed: trimmed, upper case, letters, digits and dashes.
 * Null when it cannot be one.
 */
export function normaliseOfferCode(raw) {
  const code = String(raw || "").trim().toUpperCase();
  return /^[A-Z0-9-]{3,30}$/.test(code) ? code : null;
}

/** Can this offer be used right now? */
export function offerUsable(offer, now = new Date()) {
  if (!offer || offer.isActive === false) return false;
  if (offer.validFrom && new Date(offer.validFrom) > now) return false;
  if (offer.validUntil && new Date(offer.validUntil) < now) return false;
  if (offer.maxUses && (offer.uses || 0) >= offer.maxUses) return false;
  return true;
}

/* ------------------------------------------------------------- limits */

/**
 * What a company does when it goes over its package's allowance.
 *
 *   "charge" — carry on; each extra person is on the next bill (the default)
 *   "block"  — stop at the allowance: no more people, or files, until the
 *              package changes. For a customer who wants no surprise on the
 *              bill.
 *
 * Separate from the platform admin's hard caps (limits.maxEmployees,
 * maxWorkers, maxStorageBytes), which stop a company whatever it chose.
 */
export const OVERAGE_MODES = ["charge", "block"];

/** The share of an allowance at which the owner is warned. */
export const NEAR_LIMIT = 0.8;

const GB = 1024 ** 3;

/**
 * Room for `adding` more, against the hard cap and — when the company chose
 * to stop there — the package allowance. The tighter one wins.
 *
 * @param {object} o
 * @param {number} o.used        current count (or bytes, for storage)
 * @param {number} [o.adding]
 * @param {number|null} o.cap    platform hard cap; null or 0 means none
 * @param {number|null} o.included the package allowance; null without a package
 * @param {string} [o.overageMode]
 * @param {string} o.label       "office staff", "students", "storage"
 * @param {string} [o.planName]
 * @param {(n: number) => string} [o.format] how to show an amount
 * @returns {{ allowed: boolean, max: number|null, reason?: "cap"|"package", message?: string }}
 */
export function headroom({
  used,
  adding = 1,
  cap,
  included,
  overageMode,
  label,
  planName = "your",
  format = (n) => String(n),
}) {
  const stops = [];
  if (Number.isFinite(cap) && cap > 0) stops.push({ max: cap, reason: "cap" });
  if (overageMode === "block" && Number.isFinite(included)) {
    stops.push({ max: included, reason: "package" });
  }
  if (!stops.length) return { allowed: true, max: null };

  const tightest = stops.sort((a, b) => a.max - b.max)[0];
  if (used + adding <= tightest.max) return { allowed: true, max: tightest.max };

  return {
    allowed: false,
    max: tightest.max,
    reason: tightest.reason,
    message:
      tightest.reason === "cap"
        ? `This company is licensed for ${format(tightest.max)} ${label} and already has ${format(used)}. Contact us to add more.`
        : `The ${planName} package includes ${format(tightest.max)} ${label}, and this company is set to stop there rather than pay for extras. A super admin can change that, or the package, in Plan & billing.`,
  };
}

/**
 * The usage bars on Plan & billing: each allowance, how much of it is used,
 * and what going over costs.
 *
 * @param {object} o
 * @param {object|null} o.plan
 * @param {{ officeStaff: number, workers: number, storageGb: number|null }} o.usage
 * @param {object} [o.limits]   the company's hard caps
 * @param {string} [o.overageMode]
 * @param {string} [o.workersLabel] the company's word — "Students", "Site employees"
 */
export function usageRows({ plan, usage, limits = {}, overageMode = "charge", workersLabel = "Students / workers" }) {
  const rows = [
    {
      key: "officeStaff",
      label: "Office staff",
      used: usage.officeStaff,
      included: plan?.included?.officeStaff ?? null,
      extraPence: plan?.extraPence?.officeStaff ?? 0,
      cap: limits.maxEmployees || null,
      unit: "",
    },
    {
      key: "workers",
      label: workersLabel,
      used: usage.workers,
      included: plan?.included?.workers ?? null,
      extraPence: plan?.extraPence?.worker ?? 0,
      cap: limits.maxWorkers || null,
      unit: "",
    },
    {
      key: "storageGb",
      label: "Storage",
      used: usage.storageGb,
      included: plan?.included?.storageGb ?? null,
      extraPence: plan?.extraPence?.storageGb ?? 0,
      cap: limits.maxStorageBytes ? Math.round((limits.maxStorageBytes / GB) * 100) / 100 : null,
      unit: "GB",
    },
  ];

  return rows.map((row) => {
    if (row.used == null) return { ...row, state: "unknown", percent: null, over: 0 };
    // What the bar is measured against: the package allowance, or a cap
    // when there is no package.
    const against = row.included ?? row.cap;
    const used = row.unit === "GB" ? Math.ceil(row.used) : row.used;
    const over = row.included != null ? Math.max(0, used - row.included) : 0;
    const atCap = row.cap != null && row.used >= row.cap;
    const stopsAtAllowance = overageMode === "block" && row.included != null;
    const percent = against ? Math.round((row.used / against) * 100) : null;
    let state = "ok";
    if (atCap || (stopsAtAllowance && row.used >= row.included)) state = "full";
    else if (over > 0) state = "over";
    else if (percent != null && percent >= NEAR_LIMIT * 100) state = "near";
    return {
      ...row,
      percent,
      over,
      overPence: over * row.extraPence,
      state,
    };
  });
}
