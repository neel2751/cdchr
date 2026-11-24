import { connect } from "@/db/db";
import { isValidObjectId } from "@/lib/mongodb";
import { runWithTenant } from "@/lib/tenantContext";
import { usageRows } from "@/lib/pricing";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import { companyLimits } from "./headroom";

/**
 * The super admin's warning across the top of the app when a limit that
 * actually STOPS them is close (80%) or reached: a hard cap, or the package
 * allowance when they chose to stop there. Going over an allowance they pay
 * extra for is not a warning — it is on the Plan & billing page.
 *
 * People only. Storage needs a walk of the bucket, too slow for every page;
 * the upload itself says when storage is full.
 *
 * Remembered a minute per company — it is read on every page the owner opens.
 * NOT "use server": it takes a tenant id.
 */

const TTL_MS = 60_000;
const store = (globalThis.__cdchrPlanNotice ??= new Map());

const CURRENT = { delete: { $ne: true }, isActive: { $ne: false } };

export function forgetPlanNotice(tenantId) {
  if (tenantId) store.delete(String(tenantId));
  else store.clear();
}

async function work(tenantId) {
  await connect();
  const found = await companyLimits(tenantId);
  if (!found) return null;
  const { company, plan, terms } = found;
  const overageMode = company.billing?.overageMode || "charge";
  const limits = company.limits || {};
  const stops = (key, capKey) =>
    limits[capKey] > 0 || (overageMode === "block" && plan?.included?.[key] != null);
  if (!stops("officeStaff", "maxEmployees") && !stops("workers", "maxWorkers")) {
    return null;
  }

  const [officeStaff, workers] = await runWithTenant(String(tenantId), () =>
    Promise.all([
      OfficeEmployeeModel.countDocuments(CURRENT),
      EmployeModel.countDocuments(CURRENT),
    ])
  );
  const rows = usageRows({
    plan,
    usage: { officeStaff, workers, storageGb: null },
    limits,
    overageMode,
    workersLabel: terms.siteEmployees,
  }).filter((r) => r.key !== "storageGb");

  // A row only matters here if it can stop them.
  const blocking = rows
    .map((r) => {
      const capped = r.cap != null;
      const packaged = overageMode === "block" && r.included != null;
      if (!capped && !packaged) return null;
      const max = Math.min(capped ? r.cap : Infinity, packaged ? r.included : Infinity);
      return { ...r, max, share: r.used / max };
    })
    .filter((r) => r && r.share >= 0.8)
    .sort((a, b) => b.share - a.share);

  const worst = blocking[0];
  if (!worst) return null;
  const what = worst.label.toLowerCase();
  const full = worst.used >= worst.max;
  return {
    level: "full",
    reason: "usage",
    owner: true,
    tone: full ? "danger" : "warning",
    text: full
      ? `You have ${worst.used} of ${worst.max} ${what} — the most you can have now, so no more can be added.`
      : `You are using ${worst.used} of ${worst.max} ${what}. At ${worst.max} no more can be added.`,
    action: { label: "Plan & billing", href: "/admin/plan" },
  };
}

/** The warning for this company's super admin, or null. Fails quiet. */
export async function planNotice(tenantId) {
  if (!tenantId || !isValidObjectId(String(tenantId))) return null;
  const key = String(tenantId);
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.notice;
  try {
    const notice = await work(key);
    store.set(key, { notice, expiresAt: Date.now() + TTL_MS });
    return notice;
  } catch (error) {
    console.log("planNotice failed:", error?.message);
    return null;
  }
}
