import { connect } from "@/db/db";
import { isValidObjectId } from "@/lib/mongodb";
import { companyAccess } from "@/lib/tenantAccess";
import CompanyModel from "@/models/companyModel";

/**
 * A company's access level (lib/tenantAccess.js), read from the database and
 * remembered briefly.
 *
 * Asked on every request that touches data — the read-only check sits under
 * every write — so it is cached in-process. Thirty seconds is the longest a
 * lock or an unlock takes to land; the platform console clears the entry when
 * it changes one, so in practice it is immediate on this server.
 *
 * NOT a "use server" file: it answers for any tenant id it is given, which is
 * right for the code that calls it and wrong for a browser.
 *
 * Fails open. A database hiccup must never read as "locked" and turn everyone
 * away; the worst a failure here does is let a locked company in for a moment.
 */

const TTL_MS = 30_000;
const store = (globalThis.__cdchrTenantAccessCache ??= new Map());

const FIELDS = "name status delete billing.trialEndsAt billing.lock billing.demo";

export async function getCompanyAccess(tenantId, { fresh = false } = {}) {
  const key = tenantId ? String(tenantId) : "";
  if (!key || !isValidObjectId(key)) return companyAccess(null);

  if (!fresh) {
    const hit = store.get(key);
    if (hit && hit.expiresAt > Date.now()) return companyAccess(hit.company);
  }

  try {
    await connect();
    // The company collection is global (lib/tenantPlugin.js GLOBAL_MODELS):
    // no tenant scope to escape, and none that could be wrong.
    const company = await CompanyModel.findById(key).select(FIELDS).lean();
    store.set(key, { company, expiresAt: Date.now() + TTL_MS });
    // Worked out on every call rather than cached: a trial ends at a moment,
    // and a cached verdict would carry yesterday's answer past it.
    return companyAccess(company);
  } catch (error) {
    console.log("getCompanyAccess failed:", error?.message);
    return companyAccess(null);
  }
}

/** Forget a company's cached access, after it changes. All, with no id. */
export function invalidateCompanyAccess(tenantId) {
  if (tenantId) store.delete(String(tenantId));
  else store.clear();
}
