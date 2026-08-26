/**
 * Phase 2 backfill: give every existing document a `tenantId`.
 *
 * Until this has run, tenant enforcement cannot be switched on — an unscoped
 * document is invisible once queries start filtering by tenant.
 *
 * Attribution, in order:
 *   1. A document that already has `tenantId` is left alone.
 *   2. Office employees inherit their existing `company` field where set.
 *   3. Documents that reference an employee (employeeId / approvedBy / …)
 *      inherit that employee's tenant.
 *   4. Everything left over goes to the default tenant (--tenant, or the only
 *      tenant if there is exactly one).
 *
 * --single skips steps 2 and 3 and puts everything in one tenant. Use it when
 * the existing `company` field is a reporting label rather than a customer
 * boundary — which is the usual case for a business that has been running
 * single-tenant. Without it, employees split by their `company` value and their
 * leave, clocks and rotas follow, which makes each group invisible to the other
 * once enforcement is on.
 *
 * Idempotent: every update is conditional on tenantId being absent, so it can
 * be re-run safely and resumed after an interruption.
 *
 * Usage:
 *   node scripts/backfill-tenant.mjs --dry-run
 *   node scripts/backfill-tenant.mjs --tenant <tenantId>
 *   node scripts/backfill-tenant.mjs --tenant <tenantId> --collection weeklyrotas
 *   node scripts/backfill-tenant.mjs --tenant <tenantId> --single
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
// Everything to one tenant: ignore the per-employee attribution entirely.
const SINGLE = args.includes("--single");

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i === args.length - 1) return fallback;
  const v = args[i + 1];
  return v.startsWith("--") ? fallback : v;
}

// Collections that legitimately have no tenant. Must match GLOBAL_MODELS in
// lib/tenantPlugin.js — if the two drift, either documents get a tenantId the
// application never filters on, or enforcement rejects rows this never touched.
const GLOBAL_COLLECTIONS = new Set([
  "companies",
  "platformusers",
  "usersessions",
  "loginattempts",
  "logintokens",
  "passwordresettokens",
  "twofas",
  "tenantmemberships",
]);

// Where a collection's owning employee can be found, so rows can be attributed
// precisely instead of all landing on the default tenant.
const EMPLOYEE_REFS = {
  officeemployes: null, // special-cased: uses its own `company` field
  weeklyrotas: "attendanceData.employeeId",
  weeklyrotaversions: "attendanceData.employeeId",
  leaverequests: "employeeId",
  attendances: "employeeId",
  clockrecords: "employeeId",
  clocks: "employeeId",
  siteclocks: "employeeId",
  auditlogs: "actorId",
  rolebaseds: "employeeId",
  documents: "employeeId",
  devices: "employeeId",
  expenses: "employeeId",
};

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri) {
    console.error("MONGO_DB_URL is not set.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}Database: ${db.databaseName}`
  );
  console.log(
    SINGLE
      ? "Mode: --single (every document to one tenant; `company` stays a label)\n"
      : "Mode: attributed (employees split by their `company` field)\n"
  );

  // ------------------------------------------------------- default tenant --
  const companies = db.collection("companies");
  let defaultTenantId = flag("tenant");

  if (defaultTenantId) {
    if (!mongoose.isValidObjectId(defaultTenantId)) {
      console.error(`--tenant "${defaultTenantId}" is not a valid ObjectId.`);
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    }
    const exists = await companies.findOne({
      _id: new mongoose.Types.ObjectId(defaultTenantId),
    });
    if (!exists) {
      console.error(`No tenant with _id ${defaultTenantId}.`);
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    }
    console.log(`Default tenant: ${exists.name} (${defaultTenantId})`);
  } else {
    const all = await companies
      .find({ delete: { $ne: true } })
      .limit(2)
      .toArray();
    if (all.length !== 1) {
      console.error(
        all.length === 0
          ? "No tenants found. Run scripts/seed-tenant.mjs first."
          : `${all.length}+ tenants exist — pass --tenant <id> to choose the default.`
      );
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    }
    defaultTenantId = String(all[0]._id);
    console.log(`Default tenant: ${all[0].name} (${defaultTenantId})`);
  }
  const defaultOid = new mongoose.Types.ObjectId(defaultTenantId);

  // ------------------------------------------- employee -> tenant lookup ---
  const officeEmployees = db.collection("officeemployes");
  const employeeTenant = new Map();
  for (const e of await officeEmployees
    .find({}, { projection: { company: 1 } })
    .toArray()) {
    if (e.company) employeeTenant.set(String(e._id), e.company);
  }
  console.log(`Employees with a company: ${employeeTenant.size}\n`);

  const only = flag("collection");
  const collections = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."))
    .filter((n) => !GLOBAL_COLLECTIONS.has(n))
    .filter((n) => !only || n === only)
    .sort();

  let totals = { already: 0, byEmployee: 0, byOwnField: 0, byDefault: 0 };

  for (const name of collections) {
    const col = db.collection(name);
    const missing = { tenantId: { $exists: false } };

    const total = await col.countDocuments({});
    const todo = await col.countDocuments(missing);
    const already = total - todo;
    totals.already += already;

    if (todo === 0) {
      console.log(`${name.padEnd(26)} ${String(total).padStart(6)} docs  — already done`);
      continue;
    }

    let byEmployee = 0;
    let byOwnField = 0;

    // 2. Office employees carry their own company reference.
    if (!SINGLE && name === "officeemployes") {
      const q = { ...missing, company: { $exists: true, $ne: null } };
      byOwnField = await col.countDocuments(q);
      if (!DRY_RUN && byOwnField) {
        // $set from another field needs an aggregation-pipeline update.
        await col.updateMany(q, [{ $set: { tenantId: "$company" } }]);
      }
    }

    // 3. Inherit from the employee the row belongs to.
    const refField = SINGLE ? null : EMPLOYEE_REFS[name];
    if (refField) {
      const byTenant = new Map();
      const cursor = col.find(
        { ...missing },
        { projection: { [refField.split(".")[0]]: 1 } }
      );
      for await (const doc of cursor) {
        const empId = extractRef(doc, refField);
        const tenant = empId && employeeTenant.get(String(empId));
        if (!tenant) continue;
        const key = String(tenant);
        if (!byTenant.has(key)) byTenant.set(key, []);
        byTenant.get(key).push(doc._id);
      }
      for (const [tenant, ids] of byTenant) {
        byEmployee += ids.length;
        if (!DRY_RUN) {
          await col.updateMany(
            { _id: { $in: ids }, ...missing },
            { $set: { tenantId: new mongoose.Types.ObjectId(tenant) } }
          );
        }
      }
    }

    // 4. Whatever is left goes to the default tenant.
    const remaining = DRY_RUN
      ? todo - byOwnField - byEmployee
      : await col.countDocuments(missing);
    if (!DRY_RUN && remaining) {
      await col.updateMany(missing, { $set: { tenantId: defaultOid } });
    }

    totals.byOwnField += byOwnField;
    totals.byEmployee += byEmployee;
    totals.byDefault += Math.max(0, remaining);

    console.log(
      `${name.padEnd(26)} ${String(total).padStart(6)} docs  ` +
        `already=${already} own=${byOwnField} viaEmployee=${byEmployee} default=${Math.max(0, remaining)}`
    );
  }

  console.log(
    `\nTotals: already=${totals.already} ownField=${totals.byOwnField} ` +
      `viaEmployee=${totals.byEmployee} default=${totals.byDefault}`
  );

  if (!DRY_RUN) {
    const stragglers = [];
    for (const name of collections) {
      const n = await db
        .collection(name)
        .countDocuments({ tenantId: { $exists: false } });
      if (n) stragglers.push(`${name}=${n}`);
    }
    console.log(
      stragglers.length
        ? `\nWARNING: still unscoped: ${stragglers.join(", ")}`
        : "\nEvery document now has a tenantId."
    );
  }

  console.log(DRY_RUN ? "\nDry run — nothing written." : "\nDone.");
  await mongoose.disconnect();
}

/** Read a possibly-nested / array-nested reference such as "a.b". */
function extractRef(doc, pathExpr) {
  const [head, ...rest] = pathExpr.split(".");
  const value = doc?.[head];
  if (value == null) return null;
  if (!rest.length) return value;
  const nested = Array.isArray(value) ? value[0] : value;
  return rest.reduce((acc, key) => acc?.[key], nested) ?? null;
}

main().catch(async (error) => {
  console.error("Backfill failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
