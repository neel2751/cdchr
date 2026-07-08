import { AsyncLocalStorage } from "node:async_hooks";
import { headers } from "next/headers";
import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import AuditLogModel from "@/models/auditLogModel";
import { getServerSideProps } from "@/server/session/session";

// Roles whose actions we record. Everyone else is skipped.
const AUDITED_ROLES = new Set(["admin", "superAdmin"]);

// Holds the per-request audit details that an instrumented handler reports
// through recordAudit(). Scoped to a single server-action invocation.
const auditContext = new AsyncLocalStorage();

const SENSITIVE_KEY = /pass(word)?|token|secret|otp|pin|authorization|cookie/i;
const DIFF_IGNORE = new Set(["_id", "__v", "createdAt", "updatedAt"]);

/**
 * Wrap a server action so that, when performed by an admin / super admin, a
 * single AuditLog document is written. Non-privileged callers run untouched.
 *
 * The wrapped function stays an async function, satisfying the "use server"
 * export rule. Logging is best-effort and never changes the action's result.
 *
 * @param {string} action  - stable action name, e.g. "Clock.update"
 * @param {Function} handler - the original server action
 * @param {{ module?: string }} [opts]
 */
export function withAudit(action, handler, { module: defaultModule } = {}) {
  return async function (...args) {
    let user;
    try {
      await connect();
      const res = await getServerSideProps();
      user = res?.props?.session?.user;
    } catch {
      // If we cannot resolve the session, fall through and just run the action.
    }

    const role = user?.role;
    if (!AUDITED_ROLES.has(role)) {
      return handler(...args);
    }

    const store = {
      module: defaultModule,
      entityId: undefined,
      before: undefined,
      after: undefined,
      description: undefined,
    };

    let result;
    let thrownError;
    try {
      result = await auditContext.run(store, () => handler(...args));
    } catch (err) {
      thrownError = err;
    }

    let status = "success";
    let errorMessage;
    if (thrownError) {
      status = "failure";
      errorMessage = thrownError?.message || String(thrownError);
    } else if (result && typeof result === "object" && result.success === false) {
      status = "failure";
      errorMessage = result.message;
    }

    try {
      await writeAuditLog({ action, store, user, role, status, errorMessage, args });
    } catch (e) {
      console.log("Audit log write failed:", e?.message);
    }

    if (thrownError) throw thrownError;
    return result;
  };
}

/**
 * Called inside an instrumented handler to attach details to the current audit
 * entry. No-op when there is no active audit context (e.g. non-privileged user).
 */
export function recordAudit({ entityId, before, after, description, module } = {}) {
  const store = auditContext.getStore();
  if (!store) return;
  if (entityId !== undefined) store.entityId = entityId;
  if (before !== undefined) store.before = before;
  if (after !== undefined) store.after = after;
  if (description !== undefined) store.description = description;
  if (module !== undefined) store.module = module;
}

/** Shallow field-level diff between two snapshots. */
export function computeDiff(before, after) {
  const b = before || {};
  const a = after || {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changes = {};
  for (const key of keys) {
    if (DIFF_IGNORE.has(key)) continue;
    const from = b[key];
    const to = a[key];
    if (!isEqual(from, to)) {
      changes[key] = { from, to };
    }
  }
  return Object.keys(changes).length ? changes : undefined;
}

/**
 * Write an audit entry directly, without relying on the request session or
 * headers. Use this from contexts that have no HTTP request — e.g. the visa
 * reminder cron in server.mjs — or to record a focused event (like a visa-date
 * change) with an explicitly supplied actor.
 *
 * @param {Object} entry
 * @param {{ _id?: string, name?: string, email?: string, role?: string, system?: boolean }} [entry.actor]
 */
export async function logAuditDirect({
  actor,
  action,
  module,
  entityId,
  description,
  before,
  after,
  status = "success",
  errorMessage,
  metadata,
} = {}) {
  try {
    await connect();
    const sb = sanitize(before);
    const sa = sanitize(after);
    const changes = sb || sa ? computeDiff(sb, sa) : undefined;
    const isSystem = !actor || actor.system === true;

    await AuditLogModel.create({
      actorId:
        !isSystem && actor?._id && isValidObjectId(actor._id)
          ? createObjectId(actor._id)
          : undefined,
      actorType: isSystem ? "System" : "OfficeEmploye",
      actorName: isSystem ? "System" : actor?.name,
      actorEmail: isSystem ? undefined : actor?.email,
      actorRole: isSystem ? "system" : actor?.role,
      action,
      module,
      entityId:
        entityId && isValidObjectId(entityId)
          ? createObjectId(entityId)
          : undefined,
      description,
      before: sb,
      after: sa,
      changes,
      status,
      errorMessage,
      metadata,
    });
    return { success: true };
  } catch (e) {
    console.log("logAuditDirect failed:", e?.message);
    return { success: false };
  }
}

async function writeAuditLog({ action, store, user, role, status, errorMessage, args }) {
  const { ipAddress, userAgent } = await getRequestContext();
  const before = sanitize(store.before);
  const after = sanitize(store.after);
  const changes = before || after ? computeDiff(before, after) : undefined;

  await AuditLogModel.create({
    actorId: user?._id && isValidObjectId(user._id) ? createObjectId(user._id) : undefined,
    actorType: "OfficeEmploye",
    actorName: user?.name,
    actorEmail: user?.email,
    actorRole: role,
    action,
    module: store.module,
    entityId:
      store.entityId && isValidObjectId(store.entityId)
        ? createObjectId(store.entityId)
        : undefined,
    description: store.description,
    before,
    after,
    changes,
    status,
    errorMessage,
    ipAddress,
    metadata: { args: sanitize(args), userAgent },
  });
}

async function getRequestContext() {
  try {
    const h = await headers();
    return {
      ipAddress: h.get("x-forwarded-for") || h.get("x-real-ip") || undefined,
      userAgent: h.get("user-agent") || undefined,
    };
  } catch {
    return { ipAddress: undefined, userAgent: undefined };
  }
}

// Recursively copy a value into plain JSON-safe data, redacting sensitive keys
// and normalizing ObjectId / Date / Buffer so snapshots store cleanly.
function sanitize(value, depth = 0) {
  if (value == null || depth > 5) return value;
  if (typeof value !== "object") return value;
  if (typeof value.toHexString === "function") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return "[Buffer]";
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : sanitize(v, depth + 1);
  }
  return out;
}

function isEqual(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(sanitize(a)) === JSON.stringify(sanitize(b));
  } catch {
    return false;
  }
}
