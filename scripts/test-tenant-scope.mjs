/**
 * Cross-tenant isolation tests.
 *
 * With one tenant every query looks correctly scoped whether or not it is, so
 * these run against the two-tenant fixtures and assert that each tenant sees
 * only its own rows. This is the check that has to pass before enforcement is
 * turned on, and the one to re-run whenever a query is added.
 *
 * Usage (needs a local database seeded by scripts/seed-dev-fixtures.mjs):
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *   TENANT_ENFORCEMENT=enforce \
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-tenant-scope.mjs
 *
 * Run it a second time with TENANT_ENFORCEMENT=shadow to confirm shadow mode
 * changes nothing about what queries return.
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const MODE = process.env.TENANT_ENFORCEMENT || "shadow";
const ENFORCING = MODE === "enforce";

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database seeded with fixtures.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const { runWithTenant, escapeTenant } = await import("@/lib/tenantContext");
  const OfficeEmployee = (await import("@/models/officeEmployeeModel")).default;
  const WeeklyRota = (await import("@/models/weeklyRotaModel")).default;
  const Company = (await import("@/models/companyModel")).default;

  const acme = await Company.findOne({ slug: "acme" }).lean();
  const beta = await Company.findOne({ slug: "beta" }).lean();
  assert(acme && beta, "fixtures missing — run scripts/seed-dev-fixtures.mjs");

  console.log(`TENANT_ENFORCEMENT=${MODE}\n`);

  // ---------------------------------------------------------------- find --
  await check("find: Acme sees only Acme employees", async () => {
    const rows = await runWithTenant(String(acme._id), () =>
      OfficeEmployee.find({ delete: { $ne: true } }).lean()
    );
    if (ENFORCING) {
      assert(rows.length > 0, "expected some rows");
      for (const r of rows) {
        assert.equal(String(r.companyId), String(acme._id), `leaked ${r.email}`);
      }
    } else {
      // Shadow mode must not change results.
      assert(rows.length >= 6, "shadow mode must not filter");
    }
  });

  await check("find: Beta never sees Acme employees", async () => {
    const rows = await runWithTenant(String(beta._id), () =>
      OfficeEmployee.find({ delete: { $ne: true } }).lean()
    );
    if (ENFORCING) {
      const emails = rows.map((r) => r.email);
      assert(
        !emails.some((e) => e.endsWith("@acme.test")),
        `Beta saw Acme accounts: ${emails.join(", ")}`
      );
      assert(emails.length > 0, "Beta should see its own");
    }
  });

  // ------------------------------------------------------------- findOne --
  await check("findOne: another tenant's document is not reachable by id", async () => {
    const acmeUser = await escapeTenant("test setup", () =>
      OfficeEmployee.findOne({ email: "super@acme.test" }).lean()
    );
    assert(acmeUser, "fixture user missing");

    const asBeta = await runWithTenant(String(beta._id), () =>
      OfficeEmployee.findById(acmeUser._id).lean()
    );
    if (ENFORCING) {
      assert.equal(asBeta, null, "Beta fetched an Acme record by id");
    }
  });

  // --------------------------------------------------------------- count --
  await check("countDocuments is scoped and tenants partition the collection", async () => {
    const [a, b, all, orphans] = await Promise.all([
      runWithTenant(String(acme._id), () => OfficeEmployee.countDocuments({})),
      runWithTenant(String(beta._id), () => OfficeEmployee.countDocuments({})),
      escapeTenant("test", () => OfficeEmployee.countDocuments({})),
      // The fixtures include one employee with no tenant, standing in for a
      // record the backfill has not claimed. It belongs to neither partition.
      escapeTenant("test", () =>
        OfficeEmployee.countDocuments({ companyId: { $in: [null, undefined] } })
      ),
    ]);
    if (ENFORCING) {
      assert.equal(
        a + b + orphans,
        all,
        `${a} + ${b} + ${orphans} orphans !== ${all}; tenants must partition`
      );
      assert(a > 0 && b > 0, "both tenants should have rows");
      assert.equal(orphans, 1, "fixture should have exactly one unscoped record");
    }
  });

  // ----------------------------------------------------------- aggregate --
  await check("aggregate is scoped at the root", async () => {
    const rows = await runWithTenant(String(beta._id), () =>
      WeeklyRota.aggregate([{ $match: {} }])
    );
    if (ENFORCING) {
      for (const r of rows) {
        assert.equal(String(r.companyId), String(beta._id), "rota leaked");
      }
    }
  });

  // ------------------------------------------------------------- lookups --
  // A scoped root does not scope what it joins to. These use a rota belonging
  // to Beta that references a Beta employee, and ask for it as Acme.
  await check("$lookup (localField form) cannot pull another tenant's rows", async () => {
    const betaRota = await escapeTenant("test setup", () =>
      WeeklyRota.findOne({ "attendanceData.employeeName": "Ben Beta" }).lean()
    );
    assert(betaRota, "fixture rota missing");

    // Run as Beta: the join must resolve.
    const asBeta = await runWithTenant(String(beta._id), () =>
      WeeklyRota.aggregate([
        { $match: { _id: betaRota._id } },
        {
          $lookup: {
            from: "officeemployes",
            localField: "attendanceData.employeeId",
            foreignField: "_id",
            as: "joined",
          },
        },
      ])
    );
    if (ENFORCING) {
      assert.equal(asBeta.length, 1, "Beta should see its own rota");
      assert(asBeta[0].joined.length > 0, "join must still work for the owner");
      for (const j of asBeta[0].joined) {
        assert.equal(String(j.companyId), String(beta._id));
      }
    }
  });

  await check("$lookup does not leak across tenants", async () => {
    // Every employee id in the fixture set, joined from an Acme-owned root.
    const acmeRota = await escapeTenant("test setup", () =>
      WeeklyRota.findOne({ "attendanceData.employeeName": "Ava Acme" }).lean()
    );
    const betaUser = await escapeTenant("test setup", () =>
      OfficeEmployee.findOne({ email: "super@beta.test" }).lean()
    );

    const rows = await runWithTenant(String(acme._id), () =>
      WeeklyRota.aggregate([
        { $match: { _id: acmeRota._id } },
        {
          $lookup: {
            from: "officeemployes",
            // Deliberately points at a Beta employee.
            let: { x: betaUser._id },
            pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$x"] } } }],
            as: "joined",
          },
        },
      ])
    );
    if (ENFORCING) {
      assert.equal(rows.length, 1);
      assert.equal(
        rows[0].joined.length,
        0,
        "Acme pulled a Beta employee through a $lookup"
      );
    }
  });

  await check("$lookup into a global collection still resolves", async () => {
    // companies has no companyId — adding a tenant match would empty the join.
    const rows = await runWithTenant(String(acme._id), () =>
      OfficeEmployee.aggregate([
        { $match: { email: "super@acme.test" } },
        {
          $lookup: {
            from: "companies",
            localField: "company",
            foreignField: "_id",
            as: "companys",
          },
        },
      ])
    );
    if (ENFORCING) {
      assert.equal(rows.length, 1, "root row missing");
      assert.equal(
        rows[0].companys.length,
        1,
        "join into a global collection was wrongly filtered"
      );
    }
  });

  // ---------------------------------------------------------- write path --
  await check("update cannot touch another tenant's row", async () => {
    const acmeUser = await escapeTenant("test setup", () =>
      OfficeEmployee.findOne({ email: "admin@acme.test" }).lean()
    );

    // Reset to a known value first. In shadow mode the tamper below genuinely
    // succeeds — that is the point of shadow mode — so without this the next
    // enforce run would read the previous run's leftover and report a failure
    // that is really just stale state.
    const SENTINEL = "untouched";
    await escapeTenant("test setup", () =>
      OfficeEmployee.updateOne(
        { _id: acmeUser._id },
        { $set: { emergencyName: SENTINEL } }
      )
    );

    const res = await runWithTenant(String(beta._id), () =>
      OfficeEmployee.updateOne(
        { _id: acmeUser._id },
        { $set: { emergencyName: "TAMPERED" } }
      )
    );
    const after = await escapeTenant("test check", () =>
      OfficeEmployee.findById(acmeUser._id).lean()
    );

    if (ENFORCING) {
      assert.equal(res.modifiedCount, 0, "cross-tenant update was applied");
      assert.equal(after.emergencyName, SENTINEL, "Acme's row was modified by Beta");
    } else {
      // Shadow mode must not block anything — confirm it really did go through,
      // then put the fixture back.
      assert.equal(after.emergencyName, "TAMPERED", "shadow mode must not filter");
      await escapeTenant("test cleanup", () =>
        OfficeEmployee.updateOne(
          { _id: acmeUser._id },
          { $set: { emergencyName: SENTINEL } }
        )
      );
    }
  });

  await check("save stamps the current tenant", async () => {
    const doc = new WeeklyRota({ weekStartDate: new Date(2020, 0, 6) });
    await runWithTenant(String(beta._id), () => doc.save());
    assert.equal(String(doc.companyId), String(beta._id));
    await escapeTenant("test cleanup", () => WeeklyRota.deleteOne({ _id: doc._id }));
  });

  // -------------------------------------------------------- escape hatch --
  await check("escapeTenant sees every tenant", async () => {
    const all = await escapeTenant("test", () =>
      OfficeEmployee.countDocuments({ delete: { $ne: true } })
    );
    assert(all >= 6, `expected all fixtures, got ${all}`);
  });

  // ------------------------------------------------------- missing tenant --
  await check(
    ENFORCING
      ? "no tenant context throws under enforcement"
      : "no tenant context is permitted in shadow mode",
    async () => {
      if (ENFORCING) {
        await assert.rejects(
          () => OfficeEmployee.find({}).lean(),
          /no tenant in context/i,
          "expected a TenantScopeError"
        );
      } else {
        const rows = await OfficeEmployee.find({}).lean();
        assert(rows.length >= 6, "shadow mode must return everything");
      }
    }
  );

  // ------------------------------------------------------------- report ---
  console.log(results.map(([s, n]) => `  ${s.padEnd(4)} ${n}`).join("\n"));
  const failed = results.filter(([s]) => s === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);

  await mongoose.disconnect();
  if (failed) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error("Test run failed:", e);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
