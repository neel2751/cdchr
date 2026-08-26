import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

/**
 * Which tenant the current unit of work belongs to.
 *
 * Two ways to establish it, tried in this order:
 *
 *  1. An explicit scope — `runWithTenant(id, fn)`. Used by cron jobs, scripts
 *     and the platform console, none of which have a user session, and by
 *     `escapeTenant()` to opt a query out entirely.
 *
 *  2. The session behind the current request. Resolved lazily and memoised for
 *     the request by React's `cache()`, so the ~515 existing query sites get a
 *     tenant without a single one of them being edited.
 *
 * The tenant always comes from the session, never from the hostname. The
 * hostname decides branding; a signed session decides data. `proxy.js`
 * cross-checks the two.
 *
 * Same AsyncLocalStorage pattern as lib/audit.js, which is already proven here.
 */

const tenantStore = new AsyncLocalStorage();

/** Sentinel for "deliberately unscoped" — see escapeTenant(). */
const UNSCOPED = Symbol("unscoped-tenant");

/**
 * Resolve the tenant from the request session, at most once per request.
 *
 * Returns null outside a request (scripts, cron, module init) and whenever
 * there is no session — callers treat that as "no tenant known".
 */
const tenantFromSession = cache(async () => {
  try {
    // Imported lazily: this module is pulled in by model files, which are
    // themselves imported by auth.js. A static import would be circular.
    const { auth } = await import("@/auth");
    const session = await auth();
    return session?.user?.tenantId || null;
  } catch {
    return null;
  }
});

/**
 * Run `fn` with an explicit tenant. Nested calls override outer ones, which is
 * what lets a platform-level job iterate tenants one at a time.
 *
 * @param {string|null} tenantId
 * @param {Function} fn
 */
export function runWithTenant(tenantId, fn) {
  // `async () => await fn()` rather than plain `fn` on purpose. A Mongoose
  // Query is lazy: `() => Model.find()` returns before anything executes, so
  // the await — and with it every hook — would land outside this scope and see
  // no tenant. Awaiting inside keeps the context alive for the real work.
  return tenantStore.run({ tenantId }, async () => await fn());
}

/**
 * Run `fn` with tenant scoping switched off.
 *
 * Every use is a deliberate cross-tenant read and needs to be justifiable:
 * resolving a hostname, finding an account at login, the platform console,
 * a job that iterates tenants. Named so `grep escapeTenant` lists them all.
 *
 * @param {string} reason recorded in shadow-mode logs to keep uses auditable
 * @param {Function} fn
 */
export function escapeTenant(reason, fn) {
  // Awaits inside the scope for the same reason as runWithTenant.
  return tenantStore.run({ tenantId: UNSCOPED, reason }, async () => await fn());
}

/** True when the current scope has opted out of tenant filtering. */
export function isUnscoped() {
  return tenantStore.getStore()?.tenantId === UNSCOPED;
}

/**
 * The tenant for the current work, or null if none could be determined.
 * Never throws — the plugin decides what to do about a missing tenant based on
 * whether enforcement is on.
 */
export async function currentTenantId() {
  const store = tenantStore.getStore();
  if (store) {
    return store.tenantId === UNSCOPED ? null : store.tenantId || null;
  }
  return tenantFromSession();
}

/** Why the current scope is unscoped, for logging. */
export function unscopedReason() {
  return tenantStore.getStore()?.reason || "";
}
