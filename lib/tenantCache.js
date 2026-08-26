/**
 * In-process cache of hostname → tenant.
 *
 * Its own module so that code which only needs to *invalidate* the cache does
 * not have to import the resolver — `tenantServer.js` pulls in `next/headers`,
 * which cannot load outside a Next request, and that dependency was reaching
 * `tenantOps.js` and everything that tests it.
 *
 * Held on globalThis for the same reason as the tenant context: Next bundles
 * the server-action layer separately, and two copies of this map would mean a
 * write through one leaves the other serving stale tenants.
 */

const CACHE_TTL_MS = 60_000;
// Misses are cached too, for less time — otherwise an unknown host hits the
// database on every single request.
const MISS_TTL_MS = 10_000;

const store = (globalThis.__cdchrTenantHostCache ??= new Map());

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet(key, value) {
  store.set(key, {
    value,
    expiresAt: Date.now() + (value ? CACHE_TTL_MS : MISS_TTL_MS),
  });
}

/**
 * Drop cached lookups. Call after any write that changes a tenant's domains,
 * slug or status, or the change takes up to a minute to take effect.
 */
export function cacheInvalidate(key) {
  if (key) store.delete(key);
  else store.clear();
}
