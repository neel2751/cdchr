import mongoose from "mongoose";
import {
  currentTenantId,
  isUnscoped,
  unscopedReason,
} from "@/lib/tenantContext";

/**
 * Mongoose plugin that scopes a collection to one tenant.
 *
 * Applied to a schema, it adds `companyId` and filters every read and write by
 * it. Doing this in one place rather than at ~515 call sites is the whole
 * point: a filter that is added automatically cannot be forgotten, and a
 * forgotten filter is a cross-tenant data leak.
 *
 * ROLLOUT
 *   TENANT_ENFORCEMENT=shadow (default) — nothing is filtered. Queries that
 *   would fail under enforcement are logged with a stack trace so the call site
 *   can be found. Run this in production until the log goes quiet.
 *
 *   TENANT_ENFORCEMENT=enforce — filters are injected and a query with no
 *   tenant throws.
 *
 * LIMITS — read before trusting this
 *   `$lookup` sub-pipelines are NOT scoped by the aggregate hook. It can only
 *   filter the root collection; a lookup into another collection runs
 *   unfiltered unless its own pipeline carries a tenant match. Shadow mode
 *   reports these so they can be converted (see reportUnscopedLookups).
 *
 *   Nor does it cover `bulkWrite`, `insertMany` with `rawResult`, or anything
 *   issued through the native driver rather than a model.
 */

const ENFORCE = process.env.TENANT_ENFORCEMENT === "enforce";

// Query methods whose filter must be narrowed to the tenant.
const READ_OPS =
  /^(find|findOne|findOneAnd|count|countDocuments|estimatedDocumentCount|distinct|exists)/;
const WRITE_OPS = /^(update|replace|delete|remove|findOneAndUpdate|findOneAndDelete|findOneAndReplace)/;

/** Collections that legitimately have no tenant, so the plugin skips them. */
export const GLOBAL_MODELS = new Set([
  "Companie", // the tenant itself
  "PlatformUser", // provider staff, above every tenant
  "UserSession", // written during login, before a tenant is known
  "LoginAttempt", // rate limiting is keyed by email/IP, pre-authentication
  "LoginToken",
  "PasswordResetToken",
  "TwoFA", // consulted during sign-in
]);

class TenantScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "TenantScopeError";
    // Marked so lib/mongodb.js withTransaction can rethrow rather than
    // swallowing it into a { success: false } result.
    this.isTenantScopeError = true;
  }
}

/** Shadow-mode reporting. Deliberately noisy — it exists to be read. */
function reportMissingTenant(modelName, op) {
  const stack = new Error().stack?.split("\n").slice(3, 8).join("\n") || "";
  console.warn(
    `[tenant-shadow] ${modelName}.${op} ran with no tenant context\n${stack}`
  );
}

function reportUnscopedLookups(modelName, pipeline) {
  for (const stage of pipeline || []) {
    const lookup = stage?.$lookup;
    if (!lookup) continue;
    // The localField/foreignField form cannot carry a tenant match at all; the
    // pipeline form can, so only flag it when the match is actually absent.
    const usesPipeline = Array.isArray(lookup.pipeline);
    const scoped =
      usesPipeline &&
      JSON.stringify(lookup.pipeline).includes("companyId");
    if (!scoped) {
      console.warn(
        `[tenant-shadow] ${modelName}: $lookup into "${lookup.from}" is not tenant-scoped` +
          (usesPipeline ? "" : " (uses localField/foreignField; convert to pipeline form)")
      );
    }
  }
}

/**
 * @param {import("mongoose").Schema} schema
 * @param {{ modelName: string }} options
 */
export function tenantPlugin(schema, { modelName } = {}) {
  schema.add({
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Companie",
      // Stays optional until the backfill has run and enforcement is on;
      // required: true today would reject writes for existing records.
      required: false,
      index: true,
    },
  });

  // Every compound index leads with companyId: each tenant's slice of the
  // collection then sits together, and queries never scan another tenant's.
  schema.index({ companyId: 1, createdAt: -1 });

  async function scopeQuery(op) {
    if (isUnscoped()) return;

    const tenantId = await currentTenantId();

    if (!tenantId) {
      if (ENFORCE) {
        throw new TenantScopeError(
          `${modelName}.${op} attempted with no tenant in context. ` +
            `Wrap the caller in runWithTenant(), or escapeTenant() if it is ` +
            `genuinely cross-tenant.`
        );
      }
      reportMissingTenant(modelName, op);
      return;
    }

    if (ENFORCE) this.where({ companyId: tenantId });
  }

  schema.pre(READ_OPS, async function () {
    await scopeQuery.call(this, this.op || "find");
  });

  schema.pre(WRITE_OPS, async function () {
    await scopeQuery.call(this, this.op || "update");
  });

  // Stamp new documents so they belong to the tenant that created them.
  schema.pre("save", async function () {
    if (this.companyId || isUnscoped()) return;
    const tenantId = await currentTenantId();
    if (tenantId) {
      this.companyId = tenantId;
    } else if (ENFORCE) {
      throw new TenantScopeError(
        `${modelName}.save attempted with no tenant in context.`
      );
    } else {
      reportMissingTenant(modelName, "save");
    }
  });

  schema.pre("insertMany", async function (next, docs) {
    if (isUnscoped()) return next();
    const tenantId = await currentTenantId();
    if (!tenantId) {
      if (ENFORCE) {
        return next(
          new TenantScopeError(
            `${modelName}.insertMany attempted with no tenant in context.`
          )
        );
      }
      reportMissingTenant(modelName, "insertMany");
      return next();
    }
    for (const doc of docs || []) {
      if (!doc.companyId) doc.companyId = tenantId;
    }
    next();
  });

  schema.pre("aggregate", async function () {
    if (isUnscoped()) {
      return;
    }

    const pipeline = this.pipeline();
    // Always worth surfacing: a scoped root does not scope what it joins to.
    reportUnscopedLookups(modelName, pipeline);

    const tenantId = await currentTenantId();
    if (!tenantId) {
      if (ENFORCE) {
        throw new TenantScopeError(
          `${modelName}.aggregate attempted with no tenant in context.`
        );
      }
      reportMissingTenant(modelName, "aggregate");
      return;
    }

    if (ENFORCE) {
      pipeline.unshift({
        $match: { companyId: new mongoose.Types.ObjectId(String(tenantId)) },
      });
    }
  });
}

/**
 * Apply the plugin unless the model is global. Model files call this rather
 * than the plugin directly, so the exclusion list is honoured in one place.
 */
export function applyTenantScope(schema, modelName) {
  if (GLOBAL_MODELS.has(modelName)) return schema;
  schema.plugin(tenantPlugin, { modelName });
  return schema;
}

export { TenantScopeError, ENFORCE as TENANT_ENFORCEMENT_ON };
