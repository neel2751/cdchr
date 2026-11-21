/**
 * A company's words for sites, site employees and the rest.
 *
 * data/terminology.js turns "{Site} Name" into "Class Name" for a tuition
 * centre and leaves it "Site Name" for a builder. What has to hold:
 *
 *   - construction says exactly what the screens said before, so no existing
 *     company sees a change;
 *   - every template gives every word, and no form field is left showing a
 *     raw {token};
 *   - a company's own words are cleaned before they are stored or shown;
 *   - the menu, and the refusals a manager sees, come out in the company's
 *     words.
 *
 * Needs a LOCAL replica-set database for the last part — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_terms?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-terminology.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();

const results = [];
let withTenant = (fn) => fn();

function check(name, fn) {
  return Promise.resolve()
    .then(() => withTenant(fn))
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

async function main() {
  const {
    INDUSTRY_TEMPLATES,
    TERM_KEYS,
    TERM_MAX_LENGTH,
    cleanTerms,
    fillTerms,
    fillTermsDeep,
    menuLabel,
    resolveTerms,
  } = await import("@/data/terminology");
  const { FEATURE_PRESETS } = await import("@/data/features");
  const { MENU } = await import("@/data/menu");
  const fields = await import("@/data/fields/fields");

  const tuition = resolveTerms({ industry: "tuition" });

  /* ------------------------------------------------------------ templates */

  await check("every template gives every word", () => {
    for (const t of INDUSTRY_TEMPLATES) {
      for (const key of TERM_KEYS) {
        assert.ok(t.terms[key], `${t.key} has no ${key}`);
      }
    }
  });

  await check("every template's modules preset exists", () => {
    for (const t of INDUSTRY_TEMPLATES) {
      assert.ok(
        FEATURE_PRESETS.some((p) => p.key === t.featurePreset),
        `${t.key} -> ${t.featurePreset}`,
      );
    }
  });

  await check("THE POINT: construction names the menu exactly as before", () => {
    // `name` on each entry is the text the menu always showed.
    for (const item of MENU.filter((m) => m.termKey)) {
      assert.equal(menuLabel(item, resolveTerms(null)), item.name);
    }
  });

  await check("a company with no industry is construction", () => {
    assert.deepEqual(resolveTerms({}), resolveTerms({ industry: "construction" }));
    assert.deepEqual(resolveTerms(null), resolveTerms({ industry: "nonsense" }));
  });

  await check("tuition calls them classes and students", () => {
    assert.equal(tuition.siteList, "Classes");
    assert.equal(tuition.siteEmployees, "Students");
    assert.equal(tuition.siteManagers, "Class Teachers");
    assert.equal(tuition.siteAssignments, "Enrolments");
  });

  /* -------------------------------------------------------- a company's own */

  await check("a company's own word wins over its template's", () => {
    const t = resolveTerms({ industry: "tuition", terms: { site: "Batch" } });
    assert.equal(t.site, "Batch");
    assert.equal(t.siteEmployees, "Students");
  });

  await check("unknown, empty and over-long words are dropped", () => {
    const cleaned = cleanTerms({
      site: "  Batch   Group ",
      sites: "",
      siteList: "x".repeat(TERM_MAX_LENGTH + 1),
      isAdmin: "true",
      siteManager: 42,
    });
    assert.deepEqual(cleaned, { site: "Batch Group" });
  });

  /* -------------------------------------------------------------- filling */

  await check("a capital token keeps the word, a small one lowers it", () => {
    assert.equal(fillTerms("{Site} Name", tuition), "Class Name");
    assert.equal(fillTerms("Add a new {site}", tuition), "Add a new class");
    assert.equal(fillTerms("{SiteManager}", tuition), "Class Teacher");
    assert.equal(fillTerms("Select {siteEmployees}", tuition), "Select students");
  });

  await check("an unknown token stays visible rather than vanishing", () => {
    assert.equal(fillTerms("{Nope} here", tuition), "{Nope} here");
  });

  await check("filling a field set leaves patterns and values alone", () => {
    const pattern = /^[a-z]+$/;
    const out = fillTermsDeep(
      [{ labelText: "{Site}", pattern: { value: pattern }, options: [{ value: "Active" }] }],
      tuition,
    );
    assert.equal(out[0].labelText, "Class");
    assert.equal(out[0].pattern.value, pattern);
    assert.equal(out[0].options[0].value, "Active");
  });

  await check("no form field shows a raw token in any industry", () => {
    for (const name of ["SITEFIELD", "ASSIGNSITEMANAGERFIELD", "EMPLOYEFIELD"]) {
      for (const t of INDUSTRY_TEMPLATES) {
        const text = JSON.stringify(fillTermsDeep(fields[name], t.terms));
        assert.ok(!/\{[A-Za-z]+\}/.test(text), `${name} in ${t.key}: ${text.match(/\{[A-Za-z]+\}/)}`);
      }
    }
  });

  await check("construction form labels read as they did", () => {
    const site = fillTermsDeep(fields.SITEFIELD, resolveTerms(null));
    assert.equal(site.find((f) => f.name === "siteName").labelText, "Site Name");
    assert.equal(site.find((f) => f.name === "status").labelText, "Site Status");
  });

  /* ---------------------------------------------------- against a database */

  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    results.push(["SKIP", "database checks — set MONGO_DB_URL to a LOCAL database"]);
  } else {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    await mongoose.connection.db.dropDatabase();
    const db = mongoose.connection.db;
    const { runWithTenant } = await import("@/lib/tenantContext");
    const { getEmployeeMenu } = await import("@/server/selectServer/selectServer");
    const { fetchAssignedWithClocksNew } = await import(
      "@/server/siteAssignmentServer/siteAssignmentServer"
    );
    const { applyTerms } = await import("@/server/tenantServer/tenantOps");

    const tenantId = new mongoose.Types.ObjectId();
    const managerId = new mongoose.Types.ObjectId();
    const superId = new mongoose.Types.ObjectId();
    withTenant = (fn) => runWithTenant(String(tenantId), fn);

    await db.collection("companies").insertOne({
      _id: tenantId,
      name: "Bright Minds Tuition",
      industry: "tuition",
      terms: {},
      isActive: true,
      delete: false,
      status: "active",
    });
    await db.collection("rolebaseds").insertOne({
      tenantId,
      name: "Teacher",
      employeeId: managerId,
      isActive: true,
      isDeleted: false,
      permissions: ["/admin/siteAssignEmployee"],
    });

    await check("a tuition company's menu says Classes and Students", async () => {
      actAs({ _id: String(superId), role: "superAdmin", tenantId: String(tenantId) });
      const res = await getEmployeeMenu();
      const names = JSON.parse(res.data).map((m) => m.name);
      assert.ok(names.includes("Classes"), names.join(", "));
      assert.ok(names.includes("Students"), names.join(", "));
      assert.ok(!names.includes("Project Sites"), "construction word leaked");
    });

    await check("a teacher is refused another class in tuition words", async () => {
      actAs({ _id: String(managerId), role: "user", tenantId: String(tenantId) });
      const res = await fetchAssignedWithClocksNew({
        siteId: String(new mongoose.Types.ObjectId()),
      });
      assert.equal(res.success, false);
      assert.equal(res.message, "You do not manage this class");
    });

    await check("saving words keeps only those that differ from the template", async () => {
      const res = await applyTerms(String(tenantId), {
        industry: "tuition",
        terms: { site: "Batch", sites: "Classes", isAdmin: "x" },
      });
      assert.equal(res.success, true, res.message);
      const saved = await db.collection("companies").findOne({ _id: tenantId });
      assert.deepEqual(saved.terms, { site: "Batch" });
    });

    await check("an unknown industry is refused", async () => {
      const res = await applyTerms(String(tenantId), { industry: "spaceport" });
      assert.equal(res.success, false);
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
