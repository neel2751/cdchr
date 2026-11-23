/**
 * What the site employee form asks for, per company.
 *
 * data/fieldBlocks.js splits the form into blocks — pay, CIS, employment,
 * right to work, guardian, medical, school — and a company's industry decides
 * which are on. What has to hold:
 *
 *   - a construction company's form is the form it always had;
 *   - a tuition centre can save a student with no pay rate, CIS or visa, and
 *     must give a parent's name and phone;
 *   - a field from a block that is off is not stored, whatever is sent;
 *   - a block switched on is enforced by the server, now that the schema no
 *     longer requires the worker-only fields.
 *
 * Needs a LOCAL replica-set database for the save checks — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_blocks?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-field-blocks.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();
// Saving a site employee emails them an invite. Never from a test.
process.env.EMAIL_HOST = "";
process.env.EMAIL_USERNAME = "";
process.env.EMAIL_PASSWORD = "";

const results = [];
let withTenant = (fn) => fn();

function check(name, fn) {
  return Promise.resolve()
    .then(() => withTenant(fn))
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

const NEW_FIELDS = [
  "guardianName",
  "guardianRelation",
  "guardianPhone",
  "guardianEmail",
  "schoolName",
  "yearGroup",
  "medicalNotes",
];

async function main() {
  const {
    FIELD_BLOCKS,
    FIELD_BLOCK_KEYS,
    filterFieldsByBlocks,
    requiredFieldsFor,
    resolveCompanyBlocks,
    resolveFieldBlocks,
  } = await import("@/data/fieldBlocks");
  const { INDUSTRY_TEMPLATES } = await import("@/data/terminology");
  const { EMPLOYEFIELD } = await import("@/data/fields/fields");

  const names = (fields) => fields.map((f) => f.name);
  const construction = resolveCompanyBlocks({ industry: "construction" });
  const tuition = resolveCompanyBlocks({ industry: "tuition" });

  /* --------------------------------------------------------------- blocks */

  await check("every template's blocks exist", () => {
    for (const t of INDUSTRY_TEMPLATES) {
      for (const key of t.blocks) {
        assert.ok(FIELD_BLOCK_KEYS.includes(key), `${t.key}: ${key}`);
      }
    }
  });

  await check("every block field is a field on the form", () => {
    const onForm = names(EMPLOYEFIELD);
    for (const block of FIELD_BLOCKS) {
      for (const f of block.fields) {
        assert.ok(onForm.includes(f), `${block.key}: ${f}`);
      }
    }
  });

  await check("THE POINT: construction's form is the form it always had", () => {
    const before = names(EMPLOYEFIELD).filter((n) => !NEW_FIELDS.includes(n));
    assert.deepEqual(names(filterFieldsByBlocks(EMPLOYEFIELD, construction)), before);
  });

  await check("a company with no industry is construction", () => {
    assert.deepEqual(resolveCompanyBlocks({}), construction);
    assert.deepEqual(resolveCompanyBlocks(null), construction);
  });

  await check("tuition asks about guardians, not pay, CIS or visas", () => {
    const form = names(filterFieldsByBlocks(EMPLOYEFIELD, tuition));
    for (const f of ["guardianName", "guardianPhone", "medicalNotes", "schoolName"]) {
      assert.ok(form.includes(f), `missing ${f}`);
    }
    for (const f of ["payRate", "cisDeduction", "utr", "immigrationType", "eVisaExp", "accountNumber"]) {
      assert.ok(!form.includes(f), `still asks ${f}`);
    }
    for (const f of ["firstName", "email", "address", "startDate", "emergencyName"]) {
      assert.ok(form.includes(f), `lost ${f}`);
    }
  });

  await check("a company's own switch wins over its template's", () => {
    const b = resolveFieldBlocks(["guardian"], { medical: true, guardian: false });
    assert.equal(b.medical, true);
    assert.equal(b.guardian, false);
  });

  await check("CIS cannot be on without pay", () => {
    const b = resolveFieldBlocks(["constructionTax"], {});
    assert.equal(b.constructionTax, false);
  });

  await check("only the blocks that are on are required", () => {
    assert.deepEqual(requiredFieldsFor(tuition).sort(), ["guardianName", "guardianPhone"]);
    assert.ok(requiredFieldsFor(construction).includes("immigrationType"));
    assert.ok(requiredFieldsFor(construction).includes("payRate"));
  });

  /* ---------------------------------------------------- against a database */

  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    results.push(["SKIP", "save checks — set MONGO_DB_URL to a LOCAL database"]);
  } else {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    await mongoose.connection.db.dropDatabase();
    const db = mongoose.connection.db;
    const { runWithTenant } = await import("@/lib/tenantContext");
    const { handleEmploye } = await import("@/server/employeServer/employeServer");
    const { applyFieldBlocks } = await import("@/server/tenantServer/tenantOps");

    const company = (industry) => ({
      _id: new mongoose.Types.ObjectId(),
      name: `${industry} test`,
      industry,
      isActive: true,
      delete: false,
      status: "active",
    });
    const school = company("tuition");
    const builder = company("construction");
    await db.collection("companies").insertMany([school, builder]);

    const asSuper = (tenant) => {
      withTenant = (fn) => runWithTenant(String(tenant._id), fn);
      actAs({
        _id: String(new mongoose.Types.ObjectId()),
        role: "superAdmin",
        tenantId: String(tenant._id),
      });
    };

    const person = (email, extra = {}) => ({
      firstName: "Ada",
      lastName: "Lovelace",
      email,
      phone: 7700900000,
      address: "1 Test Street",
      postCode: "AB1 2CD",
      startDate: new Date(Date.UTC(2026, 8, 1)),
      emergencyName: "Byron",
      ...extra,
    });

    asSuper(school);
    await check("THE POINT: a student saves with no pay, CIS or visa", async () => {
      const res = await handleEmploye(
        person("ada@school.test", {
          guardianName: "Anne Milbanke",
          guardianPhone: "07700900111",
          yearGroup: "Year 9",
          medicalNotes: "Nut allergy",
        }),
        false,
        null,
      );
      assert.equal(res.success, true, res.message);
      const saved = await db.collection("employes").findOne({ email: "ada@school.test" });
      assert.equal(saved.guardianPhone, "07700900111");
      assert.equal(saved.yearGroup, "Year 9");
      assert.equal(saved.employeType, undefined, "a student is not CIS or Payroll");
    });

    asSuper(school);
    await check("a student needs a parent's name and phone", async () => {
      const res = await handleEmploye(person("no.guardian@school.test"), false, null);
      assert.equal(res.success, false);
      assert.match(res.message, /guardianName/);
      assert.match(res.message, /guardianPhone/);
    });

    asSuper(school);
    await check("a field from a block that is off is not stored", async () => {
      const res = await handleEmploye(
        person("sneaky@school.test", {
          guardianName: "G",
          guardianPhone: "07700900222",
          payRate: 999,
          immigrationType: "Immigrant",
          utr: "1234567890",
        }),
        false,
        null,
      );
      assert.equal(res.success, true, res.message);
      const saved = await db.collection("employes").findOne({ email: "sneaky@school.test" });
      assert.equal(saved.payRate, undefined);
      assert.equal(saved.immigrationType, undefined);
      assert.equal(saved.utr, undefined);
    });

    asSuper(builder);
    await check("REGRESSION: a builder's worker still needs pay and right to work", async () => {
      // The schema used to require these. It no longer does, so the server
      // must — for a company whose form has those blocks.
      const res = await handleEmploye(person("worker@builder.test"), false, null);
      assert.equal(res.success, false);
      for (const f of ["immigrationType", "payRate", "cisDeduction", "employeRole"]) {
        assert.match(res.message, new RegExp(f));
      }
    });

    asSuper(builder);
    await check("a builder's worker with everything saves, labelled CIS", async () => {
      const res = await handleEmploye(
        person("full@builder.test", {
          immigrationType: "British",
          paymentType: "Weekly",
          payType: "Daily",
          payRate: 150,
          cisDeduction: 20,
          employeRole: "Labourer",
        }),
        false,
        null,
      );
      assert.equal(res.success, true, res.message);
      const saved = await db.collection("employes").findOne({ email: "full@builder.test" });
      assert.equal(saved.employeType, "CIS");
    });

    await check("saving a form keeps only switches that differ from the template", async () => {
      const res = await applyFieldBlocks(String(school._id), {
        fieldBlocks: { guardian: true, medical: false, pay: false, bogus: true },
      });
      assert.equal(res.success, true, res.message);
      const saved = await db.collection("companies").findOne({ _id: school._id });
      assert.deepEqual(saved.fieldBlocks, { medical: false });
    });

    await db.dropDatabase();
    await mongoose.disconnect();
  }

  const failed = results.filter(([s]) => s === "FAIL");
  for (const [status, name] of results) {
    console.log(`  ${status === "pass" ? "ok  " : status}  ${name}`);
  }
  const ran = results.filter(([s]) => s !== "SKIP").length;
  console.log(
    `\n${ran - failed.length}/${ran} passed` +
      (failed.length ? ` — ${failed.length} FAILED` : ""),
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
