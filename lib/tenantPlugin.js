import mongoose from "mongoose";
import {
  currentTenantId,
  isUnscoped,
  unscopedReason,
} from "@/lib/tenantContext";

/**
 * Mongoose plugin that scopes a collection to one tenant.
 *
 * Applied to a schema, it adds `tenantId` and filters every read and write by
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

/**
 * The collection names behind GLOBAL_MODELS. A `$lookup` into one of these must
 * NOT get a tenantId match — those documents have no tenantId, so adding one
 * would match nothing and silently empty the join.
 */
const GLOBAL_COLLECTIONS = new Set([
  "companies",
  "platformusers",
  "usersessions",
  "loginattempts",
  "logintokens",
  "passwordresettokens",
  "twofas",
]);

/**
 * Whether a joined collection carries a tenant.
 *
 * Defaults to true: the plugin is on 42 of 49 models, so "scoped" is the norm
 * and an unrecognised collection is safer treated as scoped (an over-filtered
 * join is a visible bug; an under-filtered one is a silent leak). The registered
 * model, when there is one, is authoritative.
 */
function collectionIsScoped(from) {
  if (!from) return false;
  if (GLOBAL_COLLECTIONS.has(from)) return false;
  for (const model of Object.values(mongoose.models)) {
    if (model.collection?.name === from) return !!model.schema.path("tenantId");
  }
  return true;
}

/**
 * Rewrite a `$lookup` so the joined collection is filtered by tenant too.
 *
 * `pre("aggregate")` can only narrow the root collection — a join runs
 * unfiltered unless its own sub-pipeline carries the match. Doing the rewrite
 * here covers all 85 lookup sites at once, including the six that build the
 * stage from a variable, which a source-level edit could not reliably reach.
 *
 * localField/foreignField becomes the equivalent `let` + `$expr`, preserving
 * Mongo's rule that an array localField matches if *any* element matches.
 */
function scopeLookupStage(stage, tenantOid) {
  const lookup = stage?.$lookup;
  if (!lookup?.from || !collectionIsScoped(lookup.from)) return stage;

  const alreadyScoped =
    Array.isArray(lookup.pipeline) &&
    JSON.stringify(lookup.pipeline).includes("tenantId");
  if (alreadyScoped) return stage;

  const tenantMatch = { tenantId: tenantOid };
  const inner = (lookup.pipeline || []).map((s) => scopeLookupStage(s, tenantOid));

  // Already in pipeline form: prepend the tenant match.
  if (!lookup.localField) {
    return {
      $lookup: { ...lookup, pipeline: [{ $match: tenantMatch }, ...inner] },
    };
  }

  // localField/foreignField form: express the join condition instead.
  const varName = "tenantJoinValue";
  const foreign = `$${lookup.foreignField || "_id"}`;
  const local = `$$${varName}`;
  const joinExpr = {
    $expr: {
      $cond: [
        { $isArray: local },
        { $in: [foreign, { $ifNull: [local, []] }] },
        { $eq: [foreign, local] },
      ],
    },
  };

  const { localField, foreignField, ...rest } = lookup;
  return {
    $lookup: {
      ...rest,
      let: { ...(lookup.let || {}), [varName]: `$${localField}` },
      pipeline: [{ $match: { $and: [joinExpr, tenantMatch] } }, ...inner],
    },
  };
}

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

/**
 * Report joins that would be rewritten under enforcement. In shadow mode this
 * is the audit trail; under enforcement scopeLookupStage() handles them, so
 * anything still reported here is a join the rewrite deliberately left alone.
 */
function reportUnscopedLookups(modelName, pipeline) {
  for (const stage of pipeline || []) {
    const lookup = stage?.$lookup;
    if (!lookup) continue;
    if (!collectionIsScoped(lookup.from)) continue; // global target: correct as-is
    const scoped =
      Array.isArray(lookup.pipeline) &&
      JSON.stringify(lookup.pipeline).includes("tenantId");
    if (!scoped) {
      console.warn(
        `[tenant-shadow] ${modelName}: $lookup into "${lookup.from}" is not tenant-scoped` +
          (Array.isArray(lookup.pipeline)
            ? ""
            : " (localField/foreignField form)")
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
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Companie",
      // Stays optional until the backfill has run and enforcement is on;
      // required: true today would reject writes for existing records.
      required: false,
      index: true,
    },
  });

  // Every compound index leads with tenantId: each tenant's slice of the
  // collection then sits together, and queries never scan another tenant's.
  schema.index({ tenantId: 1, createdAt: -1 });

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

    if (ENFORCE) this.where({ tenantId: tenantId });
  }

  schema.pre(READ_OPS, async function () {
    await scopeQuery.call(this, this.op || "find");
  });

  schema.pre(WRITE_OPS, async function () {
    await scopeQuery.call(this, this.op || "update");
  });

  // Stamp new documents so they belong to the tenant that created them.
  schema.pre("save", async function () {
    if (this.tenantId || isUnscoped()) return;
    const tenantId = await currentTenantId();
    if (tenantId) {
      this.tenantId = tenantId;
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
      if (!doc.tenantId) doc.tenantId = tenantId;
    }
    next();
  });

  schema.pre("aggregate", async function () {
    if (isUnscoped()) {
      return;
    }

    const pipeline = this.pipeline();
    // Shadow mode only. Under enforcement scopeLookupStage() rewrites these, so
    // warning about them would be noise describing work already done.
    if (!ENFORCE) reportUnscopedLookups(modelName, pipeline);

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
      const tenantOid = new mongoose.Types.ObjectId(String(tenantId));
      // Rewrite joins in place so the root match below is not the only filter.
      for (let i = 0; i < pipeline.length; i++) {
        if (pipeline[i]?.$lookup) {
          pipeline[i] = scopeLookupStage(pipeline[i], tenantOid);
        }
      }
      pipeline.unshift({ $match: { tenantId: tenantOid } });
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
