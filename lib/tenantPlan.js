/**
 * Plan enforcement: which modules a company may use, and how many people.
 *
 * The platform console has been able to set `features` and `limits` since the
 * console was built, but nothing read them — every company saw every module and
 * seat counts were decorative. These are the readers.
 *
 * Pure functions over a tenant document, so they can be used from a server
 * action, a layout, or a test without a database.
 */

/** Menu paths that belong to an optional module. Anything absent is core. */
export const FEATURE_BY_PATH = {
  "/admin/leads": "crm",
  "/admin/expense": "expenses",
  "/admin/visitors": "visitors",
  "/admin/siteProject": "siteProjects",
  "/admin/siteAssign": "siteProjects",
  "/admin/siteAssignEmployee": "siteProjects",
  "/admin/document": "documents",
  "/admin/device": "devices",
  "/admin/device-info": "devices",
  "/admin/ai": "ai",
};

/**
 * Is a module switched on for this company?
 *
 * Absent means enabled: flags default to true on the schema, and a company
 * created before a flag existed must not silently lose the module.
 */
export function isFeatureEnabled(features, key) {
  if (!key) return true;
  return features?.[key] !== false;
}

/** Is a menu path allowed under this company's plan? */
export function isPathAllowed(features, path) {
  if (!path) return true;
  // Longest match first, so /admin/device-info is judged on its own entry
  // rather than /admin/device's.
  const match = Object.keys(FEATURE_BY_PATH)
    .filter((p) => path === p || path.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  return isFeatureEnabled(features, FEATURE_BY_PATH[match]);
}

/** Drop menu entries the company's plan does not include. */
export function filterMenuByFeatures(menu, features) {
  if (!Array.isArray(menu)) return [];
  return menu.filter((item) => isPathAllowed(features, item?.path));
}

/**
 * Would storing `addingBytes` more exceed the company's storage allowance?
 *
 * Same shape and same defaults as checkSeats: a null or missing limit means
 * unlimited, so switching this on caps nobody who has not been given a number.
 */
export function checkStorage({ limit, used, addingBytes = 0 }) {
  const max = Number.isFinite(limit) && limit > 0 ? limit : null;
  if (max === null) return { allowed: true, limit: null, used };
  if (used + addingBytes <= max) return { allowed: true, limit: max, used };
  const mb = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return {
    allowed: false,
    limit: max,
    used,
    message:
      `This company's storage allowance is ${mb(max)} and ${mb(used)} is in ` +
      `use. Remove some files or contact us to increase it.`,
  };
}

/**
 * Would adding `adding` people exceed the company's seat count?
 *
 * A null or missing limit means unlimited, which is how every existing company
 * is configured — so this can be switched on without capping anyone who has not
 * been given a number.
 *
 * @returns {{ allowed: boolean, limit: number|null, used: number, message?: string }}
 */
export function checkSeats({ limit, used, adding = 1 }) {
  const max = Number.isFinite(limit) && limit > 0 ? limit : null;
  if (max === null) return { allowed: true, limit: null, used };
  if (used + adding <= max) return { allowed: true, limit: max, used };
  return {
    allowed: false,
    limit: max,
    used,
    message:
      `This company is licensed for ${max} employee${max === 1 ? "" : "s"} and ` +
      `already has ${used}. Contact us to add more seats.`,
  };
}
