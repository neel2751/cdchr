import DocumentModel from "@/models/document/documentModel";
import MediaModel from "@/models/document/mediaModel";
import ExpenseModel from "@/models/expense/expenseModel";
import { currentTenantId } from "@/lib/tenantContext";

/**
 * Deciding whether the caller may touch an object in the bucket.
 *
 * MongoDB isolation comes free from the tenant plugin. S3 has no equivalent —
 * every request runs with the server's own credentials, so nothing about the
 * caller's company applies unless it is checked here. Object keys are not
 * secret either: they are built from ObjectIds the app already exposes, and the
 * browser is handed them in file listings.
 *
 * Deliberately NOT a "use server" module. Exporting these as server actions
 * would put the very check being performed within reach of the caller.
 */

const ROOT = "tenants";

/**
 * Where a company's objects live: `tenants/{tenantId}/{category}/{...parts}`.
 *
 * The category keeps documents, receipts, QR images and branding apart, so a
 * lifecycle rule or a storage total can address one kind of asset.
 */
export function tenantAssetKey({ tenantId, category = "misc", parts = [] }) {
  const safe = [category, ...parts]
    .filter(Boolean)
    .map((p) =>
      String(p)
        // A key is a plain string to S3, so "../" does not traverse — but it
        // does produce keys that no longer sort under the tenant prefix, which
        // is what the isolation relies on.
        .replace(/\.\.+/g, ".")
        .replace(/^\/+|\/+$/g, "")
    )
    .filter(Boolean);
  return `${ROOT}/${tenantId}/${safe.join("/")}`;
}

/** Does this key sit under the given company's prefix? */
export function isKeyInTenant(key, tenantId) {
  if (!key || !tenantId) return false;
  return String(key).startsWith(`${ROOT}/${tenantId}/`);
}

/**
 * Is this key referenced by a record the caller's company owns?
 *
 * The fallback for objects written before keys were prefixed. Those live at
 * `{employeeId}/{file}` and cannot be judged by their name, but the row that
 * points at them is tenant-scoped, so the plugin answers the question: if a
 * scoped query finds a record holding this key, it belongs to this company.
 */
async function isKeyReferencedByTenant(key) {
  const [doc, media, expense] = await Promise.all([
    DocumentModel.exists({ "documentsFiles.key": key }),
    MediaModel.exists({ key }),
    ExpenseModel.exists({ "receipt.key": key }),
  ]);
  return Boolean(doc || media || expense);
}

/**
 * Throw unless the current session may act on this object.
 *
 * Two ways to qualify, in order of cost:
 *   1. the key is under this company's prefix
 *   2. a record this company owns references it (legacy, un-prefixed keys)
 *
 * @param {string} key
 * @returns {Promise<string>} the key, so call sites can inline it
 */
export async function assertKeyOwnedByTenant(key) {
  const trimmed = String(key || "").trim();
  if (!trimmed) throw new AssetAccessError("No object key given");

  const tenantId = await currentTenantId();
  if (!tenantId) {
    throw new AssetAccessError("No company in context for this request");
  }

  if (isKeyInTenant(trimmed, tenantId)) return trimmed;

  // Belongs to another company's prefix — no record lookup can make that right.
  if (trimmed.startsWith(`${ROOT}/`)) {
    throw new AssetAccessError("That file belongs to another company");
  }

  if (await isKeyReferencedByTenant(trimmed)) return trimmed;

  throw new AssetAccessError("That file belongs to another company");
}

export class AssetAccessError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssetAccessError";
    this.isAssetAccessError = true;
  }
}
