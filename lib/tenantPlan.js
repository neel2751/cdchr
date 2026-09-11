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

import { FEATURES, PATH_TO_FEATURE } from "@/data/features";

/**
 * Menu paths that belong to an optional module. Anything absent is core.
 *
 * Derived from `data/features.js`, which is where a module's paths are declared
 * alongside its label and its schema key — one edit rather than three.
 */
export const FEATURE_BY_PATH = PATH_TO_FEATURE;

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
 * Switch off anything whose prerequisites are not met.
 *
 * Site Assignments without Project Sites is a screen that cannot work; Project
 * Sites without Site Employees is a site nobody can be put on. Nothing stopped
 * a platform admin saving those combinations, and the result looked like a bug
 * in the product rather than a plan that does not add up.
 *
 * Off wins, always. If a prerequisite is off the dependent goes off too — the
 * opposite rule would have switching one module on silently switch on another
 * the customer is not paying for.
 *
 * Runs to a fixed point so a chain (c needs b, b needs a) resolves in one call,
 * and is capped at FEATURES.length passes: a `requires` cycle introduced by a
 * bad edit would otherwise spin here forever. A cycle cannot be satisfied
 * anyway, so stopping and returning what we have is the honest answer.
 *
 * Pure, and returns a new object — the caller decides whether to keep it.
 *
 * @param {Object} features a full or partial flag map
 * @returns {Object} the same map with unmet dependents switched off
 */
export function resolveFeatureDependencies(features) {
  const resolved = { ...(features || {}) };

  for (let pass = 0; pass < FEATURES.length; pass++) {
    let changed = false;
    for (const feature of FEATURES) {
      if (!isFeatureEnabled(resolved, feature.key)) continue;
      const unmet = feature.requires?.some(
        (key) => !isFeatureEnabled(resolved, key)
      );
      if (unmet) {
        resolved[feature.key] = false;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return resolved;
}

/**
 * The modules a change would switch off as a knock-on, so the console can say
 * so before saving rather than after.
 *
 * @returns {string[]} keys that `resolveFeatureDependencies` would turn off
 */
export function dependentsToDisable(features) {
  const resolved = resolveFeatureDependencies(features);
  return FEATURES.filter(
    (f) => isFeatureEnabled(features, f.key) && !isFeatureEnabled(resolved, f.key)
  ).map((f) => f.key);
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
