import mongoose from "mongoose";
import {
  currentTenantId,
  isReadOnly,
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
  // A self-serve signup, written and read before the tenant it describes has
  // been created at all.
  "PendingSignup",
  "TwoFA", // consulted during sign-in
  // Spans tenants by definition and is read at login, before one is known.
  "TenantMembership",
  // The tag catalogue: one shop every company orders from, maintained by us.
  // Scoping it would give each company an empty catalogue.
  "TagProduct",
  // Blanks on our shelf, before any customer's order touches them. Scoping it
  // would give every company their own empty warehouse.
  "TagStockMovement",
  // Our own dispatch details, printed on a label. One set, not one per tenant.
  "PlatformSetting",
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
  "pendingsignups",
  "twofas",
  "tenantmemberships",
  "tagproducts",
  "tagstockmovements",
  "platformsettings",
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
 * Rewrite a `$unionWith` so the appended collection is filtered by tenant too.
 *
 * A union is a second collection scan bolted onto the pipeline, and the root
 * `$match` does not reach it — so an unscoped union returns every company's
 * rows. Media Management builds its file list by unioning documents and expense
 * receipts onto the media library, which is exactly this shape.
 *
 * Accepts both forms: `$unionWith: "coll"` and `$unionWith: { coll, pipeline }`.
 */
function scopeUnionStage(stage, tenantOid) {
  const union = stage?.$unionWith;
  if (!union) return stage;

  const coll = typeof union === "string" ? union : union.coll;
  if (!coll || !collectionIsScoped(coll)) return stage;

  const inner = (typeof union === "string" ? [] : union.pipeline || []).map((s) =>
    scopeStage(s, tenantOid)
  );

  if (JSON.stringify(inner).includes("tenantId")) return stage;

  return {
    $unionWith: {
      coll,
      // Prepended, so the union is narrowed before its own stages run.
      pipeline: [{ $match: { tenantId: tenantOid } }, ...inner],
    },
  };
}

/** Apply whichever rewrite a stage needs. */
function scopeStage(stage, tenantOid) {
  if (stage?.$lookup) return scopeLookupStage(stage, tenantOid);
  if (stage?.$unionWith) return scopeUnionStage(stage, tenantOid);
  return stage;
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
  const inner = (lookup.pipeline || []).map((s) => scopeStage(s, tenantOid));

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

/**
 * Thrown when a read-only scope attempts a write.
 *
 * A support visit lets a platform admin look at a customer's data. Without this
 * they could also approve leave, change bank details or delete records — and
 * the audit trail would read as though the customer did it.
 */
class ReadOnlySessionError extends Error {
  constructor(modelName, op) {
    super(
      `${modelName}.${op} blocked: this is a read-only support session. ` +
        `End the session to make changes.`
    );
    this.name = "ReadOnlySessionError";
    // Same marker as TenantScopeError so withTransaction rethrows it rather
    // than folding it into a { success: false } business result.
    this.isTenantScopeError = true;
    this.isReadOnlyError = true;
  }
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
    const union = stage?.$unionWith;
    if (union) {
      const coll = typeof union === "string" ? union : union.coll;
      const scoped =
        typeof union !== "string" &&
        JSON.stringify(union.pipeline || []).includes("tenantId");
      if (collectionIsScoped(coll) && !scoped) {
        console.warn(
          `[tenant-shadow] ${modelName}: $unionWith "${coll}" is not tenant-scoped`
        );
      }
      continue;
    }

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
    if (await isReadOnly()) {
      throw new ReadOnlySessionError(modelName, this.op || "update");
    }
    await scopeQuery.call(this, this.op || "update");
  });

  // Stamp new documents so they belong to the tenant that created them.
  schema.pre("save", async function () {
    if (await isReadOnly()) throw new ReadOnlySessionError(modelName, "save");
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
    if (await isReadOnly()) {
      return next(new ReadOnlySessionError(modelName, "insertMany"));
    }
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
      // Rewrite joins and unions in place: the root match below reaches
      // neither, so on its own it is not enough.
      for (let i = 0; i < pipeline.length; i++) {
        pipeline[i] = scopeStage(pipeline[i], tenantOid);
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

export { TenantScopeError, ReadOnlySessionError, ENFORCE as TENANT_ENFORCEMENT_ON };
