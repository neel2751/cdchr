import CompanyModel from "@/models/companyModel";
import PricingPlanModel from "@/models/pricingPlanModel";
import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { escapeTenant } from "@/lib/tenantContext";
import { checkStorage } from "@/lib/tenantPlan";
import { tenantStorageUsage } from "./branding";

/**
 * Enforcing a company's storage allowance.
 *
 * The usage figure comes from listing every object under the company's prefix,
 * which is far too expensive to repeat on each upload — a company with
 * thousands of files would pay a full bucket walk per file. So it is measured
 * once, cached, and then adjusted by the size of each write rather than
 * re-measured.
 *
 * Not a "use server" module: it takes a tenant id and trusts it, like the rest
 * of server/aws. Callers have already established whose upload this is.
 */

// Long enough to make bursts cheap, short enough that a deletion elsewhere is
// reflected soon. The running delta keeps the figure honest in between.
const USAGE_TTL_MS = 5 * 60 * 1000;

// On globalThis for the same reason as the tenant context: Next bundles the
// server-action layer separately, and two copies would each hold half the
// picture.
const usageCache = (globalThis.__cdchrStorageUsage ??= new Map());

/**
 * Measured usage for a company, remeasured at most every few minutes.
 *
 * `measure` is injectable so the caching and running-total behaviour can be
 * tested without a bucket. It defaults to the real reader and no caller in the
 * application passes it.
 */
async function readUsage(tenantId, measure = tenantStorageUsage) {
  const hit = usageCache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.bytes;

  const { bytes } = await measure(tenantId);
  usageCache.set(tenantId, { bytes, expiresAt: Date.now() + USAGE_TTL_MS });
  return bytes;
}

/**
 * Record that a company's usage moved, without a fresh measurement.
 *
 * Called after an upload or a delete. Keeps consecutive uploads from all being
 * waved through against the same stale total, which is how a cached limit gets
 * quietly overrun.
 *
 * @param {string} tenantId
 * @param {number} deltaBytes positive for an upload, negative for a delete
 */
export function noteStorageDelta(tenantId, deltaBytes) {
  const hit = usageCache.get(tenantId);
  if (!hit) return;
  hit.bytes = Math.max(0, hit.bytes + (Number(deltaBytes) || 0));
}

/** Forget the cached figure, so the next check measures again. */
export function invalidateStorageUsage(tenantId) {
  if (tenantId) usageCache.delete(tenantId);
  else usageCache.clear();
}

/**
 * May this company store `addingBytes` more?
 *
 * Fails OPEN when the allowance or the usage cannot be read, matching how seat
 * limits behave: a company must not be unable to work because a limit lookup
 * failed. The trade is that an unreadable bucket means an unenforced limit,
 * which is the safer of the two failures here.
 *
 * @returns {Promise<{ allowed: boolean, message?: string }>}
 */
export async function assertStorageAllows(tenantId, addingBytes = 0, measure) {
  if (!tenantId || !isValidObjectId(tenantId)) return { allowed: true };

  try {
    await connect();
    const tenant = await escapeTenant("storage: company allowance", () =>
      CompanyModel.findById(createObjectId(tenantId))
        .select("limits billing.plan billing.overageMode")
        .lean()
    );

    const cap = tenant?.limits?.maxStorageBytes ?? null;
    // The package's storage, when the company chose to stop at its package
    // rather than pay for extra GB (lib/pricing.js OVERAGE_MODES).
    let packageLimit = null;
    let planName = "";
    if (tenant?.billing?.overageMode === "block" && tenant.billing.plan) {
      const plan = await PricingPlanModel.findOne({ key: tenant.billing.plan })
        .select("name included.storageGb")
        .lean();
      if (plan?.included?.storageGb != null) {
        packageLimit = plan.included.storageGb * 1024 ** 3;
        planName = plan.name;
      }
    }
    // No allowance set means unlimited, which is how every existing company is
    // configured — so this can be switched on without capping anyone.
    if (!cap && packageLimit == null) return { allowed: true };

    const used = await readUsage(tenantId, measure);
    const byPackage = packageLimit != null && (!cap || packageLimit < cap);
    const verdict = checkStorage({
      limit: byPackage ? packageLimit : cap,
      used,
      addingBytes,
    });
    if (!verdict.allowed && byPackage) {
      return {
        allowed: false,
        message: `The ${planName} package includes ${packageLimit / 1024 ** 3} GB of storage, and this company is set to stop there rather than pay for extra. A super admin can change that in Plan & billing, or remove some files.`,
      };
    }
    return { allowed: verdict.allowed, message: verdict.message };
  } catch (error) {
    console.log("Storage check failed:", error?.message);
    return { allowed: true };
  }
}
