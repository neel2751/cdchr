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

/**
 * Held on globalThis, deliberately.
 *
 * Next bundles the server-action layer separately from the module graph the
 * models live in, so a plain `new AsyncLocalStorage()` here becomes *two*
 * instances: `escapeTenant()` writes to one, the Mongoose hook reads the other,
 * and the scope silently has no effect. That is exactly what happened — the
 * platform console's cross-tenant reads threw "no tenant in context" despite
 * being correctly wrapped.
 *
 * The plain-Node test suite cannot catch this: it loads each module once, so
 * both halves agree. Only the bundled app reproduces it.
 */
const tenantStore = (globalThis.__cdchrTenantStore ??= new AsyncLocalStorage());

/**
 * Sentinel for "deliberately unscoped" — see escapeTenant().
 *
 * Symbol.for, not Symbol(): like the store above, this is compared across
 * bundles, and two `Symbol("x")` calls are never equal.
 */
const UNSCOPED = Symbol.for("cdchr.unscoped-tenant");

/**
 * Resolve the tenant from the request session, at most once per request.
 *
 * Returns null outside a request (scripts, cron, module init) and whenever
 * there is no session — callers treat that as "no tenant known".
 */
const sessionSnapshot = cache(async () => {
  try {
    // Imported lazily: this module is pulled in by model files, which are
    // themselves imported by auth.js. A static import would be circular.
    const { auth } = await import("@/auth");
    const session = await auth();
    return {
      tenantId: session?.user?.tenantId || null,
      // A support visit is read-only. Carried on the session so every query in
      // the request inherits it without a single call site opting in.
      readOnly: session?.user?.impersonation?.readOnly === true,
    };
  } catch {
    return { tenantId: null, readOnly: false };
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
  // The read-only flags are carried forward from the surrounding scope rather
  // than dropped. Changing which tenant is in view must not quietly grant the
  // ability to write to it.
  const parent = tenantStore.getStore() || {};
  // `async () => await fn()` rather than plain `fn` on purpose. A Mongoose
  // Query is lazy: `() => Model.find()` returns before anything executes, so
  // the await — and with it every hook — would land outside this scope and see
  // no tenant. Awaiting inside keeps the context alive for the real work.
  return tenantStore.run(
    { tenantId, readOnly: parent.readOnly, writeAllowed: parent.writeAllowed },
    async () => await fn()
  );
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
  // Inherits the read-only flags for the same reason as runWithTenant — and
  // because dropping `writeAllowed` here silently suppressed audit entries,
  // which wrap their write in allowWrite() and then escapeTenant().
  const parent = tenantStore.getStore() || {};
  // Awaits inside the scope for the same reason as runWithTenant.
  return tenantStore.run(
    {
      tenantId: UNSCOPED,
      reason,
      readOnly: parent.readOnly,
      writeAllowed: parent.writeAllowed,
    },
    async () => await fn()
  );
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
  return (await sessionSnapshot()).tenantId;
}

/**
 * Is the current work forbidden from writing?
 *
 * True during a support visit, so a platform admin looking at a customer's data
 * cannot change it. Enforced in lib/tenantPlugin.js, which sits under every
 * query — the alternative, remembering to check at each of the ~515 call sites,
 * is the thing that does not survive contact with a real codebase.
 */
export async function isReadOnly() {
  const store = tenantStore.getStore();
  if (store?.writeAllowed) return false;
  if (store?.readOnly) return true;
  return (await sessionSnapshot()).readOnly;
}

/**
 * Run `fn` under a read-only scope. Used by tests and by any job that should
 * not be able to write.
 */
export function runReadOnly(fn) {
  const store = tenantStore.getStore() || {};
  return tenantStore.run({ ...store, readOnly: true, writeAllowed: false },
    async () => await fn());
}

/**
 * Permit writes inside a read-only scope, for the few things that must still
 * happen during a support visit — ending the visit itself, and writing the
 * audit entries that record it.
 *
 * @param {string} reason recorded in logs so each use stays justifiable
 */
export function allowWrite(reason, fn) {
  const store = tenantStore.getStore() || {};
  return tenantStore.run({ ...store, writeAllowed: true, writeReason: reason },
    async () => await fn());
}

/** Why the current scope is unscoped, for logging. */
export function unscopedReason() {
  return tenantStore.getStore()?.reason || "";
}
