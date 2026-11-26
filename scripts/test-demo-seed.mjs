/**
 * The demo companies (scripts/seed-demo.mjs), seen the way a customer sees
 * them.
 *
 * What has to hold:
 *
 *   - THE POINT: the demo login signs in, with no two-factor setup, lands in
 *     the construction company, and can switch to all four;
 *   - each company has its people, places and today's attendance, so the
 *     dashboard is alive;
 *   - nothing can be changed — not the company's own record, not its data,
 *     not by clocking in;
 *   - THE POINT: opening the screens does not need to save anything. A
 *     screen that quietly creates a record the first time it is opened fails
 *     in a view-only company, so every read action in the app is called as
 *     the demo owner in every demo company, and any write it attempts is a
 *     failure here;
 *   - running it again refreshes the data and keeps the same companies;
 *     --remove takes everything away;
 *   - it refuses an owner email that belongs to a real account.
 *
 * Needs a LOCAL replica-set database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_demo_test?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-demo-seed.mjs
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();
process.env.EMAIL_HOST = "";
process.env.EMAIL_USERNAME = "";
process.env.EMAIL_PASSWORD = "";
process.env.AWS_ENDPOINT_URL_S3 = "http://127.0.0.1:9";
process.env.AWS_ACCESS_ID = "test";
process.env.AWS_ACCESS_PORTAL_KEY = "test";
process.env.AWS_REGION = "eu-west-2";
process.env.AWS_BUCKET_NAME = "demo-tests-not-a-bucket";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

const EMAIL = "demo@example.com";
const PASSWORD = "Demo-pass-123";

function seed(...extra) {
  return execFileSync(
    process.execPath,
    ["--no-warnings", "scripts/seed-demo.mjs", ...extra],
    { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
}

/** Server modules whose read actions a demo visitor's screens call. */
const SWEEP_DIRS = [
  "announcementServer", "attendanceServer", "assignSiteServer", "category",
  "clockServer", "companyServer", "dashboardServer", "document", "employeServer",
  "expenseServer", "holidayServer", "leaveServer", "officeAttendanceServer",
  "officeServer", "permissionServer", "policyServer", "projectServer",
  "reportServer", "roleTypeServer", "selectServer", "settingsServer",
  "siteAssignServer", "siteAssignmentServer", "siteProjectServer",
  "tenantServer", "timeOffServer", "visaServer", "weeklyRotaServer",
  "billingServer", "auditServer", "notificationServer",
];
const SWEEP_FILES = ["leaveSettingServer.js", "visitorServer.js", "leadServer.js"];
const READ_NAME = /^(get|fetch|list|count|load|find|search|preview|check)[A-Z]/;
// Not reads, whatever they are called: they do something on purpose.
const SKIP = new Set([
  "checkTenantDomainTls", // a deliberate re-check, refused like any change
]);

function serverModules() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.js$/.test(name) && /^\s*["']use server["']/.test(readFileSync(full, "utf8"))) {
        out.push(full);
      }
    }
  };
  for (const d of SWEEP_DIRS) walk(path.join("server", d));
  for (const f of SWEEP_FILES) out.push(path.join("server", f));
  return out;
}

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.db.dropDatabase();
  const db = mongoose.connection.db;

  const { LoginData } = await import("@/server/authServer/authServer");
  const { reachesOnlyDemoCompanies } = await import("@/server/tenantServer/demoLogin");
  const { getMyTenants } = await import("@/server/tenantServer/membershipServer");
  const { getAttendancePulse } = await import("@/server/dashboardServer/attendancePulse");
  const { updateTenantBranding } = await import("@/server/tenantServer/tenantSettingsServer");
  const { setOverageMode, getMyPlan } = await import("@/server/billingServer/myPlanServer");
  const { startCardSetup } = await import("@/server/billingServer/cardServer");
  const { performClockAction } = await import("@/server/clockServer/clockActions");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const ProjectSiteModel = (await import("@/models/siteProjectModel")).default;
  const { invalidateCompanyAccess } = await import("@/server/tenantServer/tenantAccessState");

  /* ------------------------------------------------------------- seeding */

  await check("refuses an owner email that belongs to a real account", async () => {
    const real = new mongoose.Types.ObjectId();
    await db.collection("companies").insertOne({ _id: real, name: "Real Co", slug: "real-co", status: "active" });
    await db.collection("officeemployes").insertOne({ tenantId: real, email: "boss@real.test", name: "Boss" });
    let failed = false;
    try {
      seed("--apply", "--email=boss@real.test", `--password=${PASSWORD}`);
    } catch (e) {
      failed = true;
      assert.match(String(e.stderr), /already belongs to a real account/);
    }
    assert.ok(failed, "it should have stopped");
    assert.equal(await db.collection("companies").countDocuments({ seedMarker: "demo" }), 0);
  });

  await check("--apply makes four demo companies, one login", async () => {
    const out = seed("--apply", `--password=${PASSWORD}`);
    assert.match(out, /Demo companies are ready/);
    const companies = await db.collection("companies").find({ seedMarker: "demo" }).toArray();
    assert.equal(companies.length, 4);
    assert.ok(companies.every((c) => c.billing?.demo === true && c.status === "active"));
    assert.deepEqual(
      [...new Set(companies.map((c) => c.industry))].sort(),
      ["construction", "restaurant", "tuition"]
    );
    const accounts = new Set(companies.map((c) => String(c.billing.accountId)));
    assert.equal(accounts.size, 1, "one bill");
    assert.equal(companies.filter((c) => !c.billing.extraCompany).length, 1, "one main company");
  });

  const companies = await db.collection("companies").find({ seedMarker: "demo" }).toArray();
  const bySlug = Object.fromEntries(companies.map((c) => [c.slug, c]));
  const construction = bySlug["demo-construction"];

  /* ------------------------------------------------------------- signing in */

  let session = null;
  await check("the demo login signs in, lands in construction, skips two-factor", async () => {
    await db.collection("auditlogs").deleteMany({});
    const res = await LoginData(EMAIL, PASSWORD, "test-device", "127.0.0.1");
    assert.equal(res.status, true, res.message);
    assert.equal(String(res.data.tenantId), String(construction._id));
    assert.equal(res.data.role, "superAdmin");
    assert.equal(await reachesOnlyDemoCompanies(res.data), true);
    assert.equal(
      await db.collection("auditlogs").countDocuments({ action: "Auth.duplicateEmail" }),
      0,
      "one owner of linked companies is not a duplicate"
    );
    session = res.data;
  });

  await check("the switcher lists all four", async () => {
    actAs({ ...session, _id: String(session._id), tenantId: String(construction._id) });
    const res = await getMyTenants();
    assert.equal(res.success, true, res.message);
    const { tenants } = JSON.parse(res.data);
    assert.deepEqual(
      tenants.map((t) => t.slug).sort(),
      ["demo-construction", "demo-restaurant", "demo-restaurant-mcr", "demo-tuition"]
    );
  });

  // Acting as the owner in each company: their record there, role superAdmin.
  const asOwnerIn = async (company) => {
    const me = await db.collection("officeemployes").findOne({ tenantId: company._id, email: EMAIL });
    actAs({
      _id: String(me._id),
      name: me.name,
      email: EMAIL,
      role: "superAdmin",
      tenantId: String(company._id),
      employeType: "OfficeEmployee",
    });
    return me;
  };

  await check("the dashboard is alive: people in now, on a break, done for the day", async () => {
    await asOwnerIn(construction);
    const res = await getAttendancePulse();
    assert.equal(res.success, true, res.message);
    const pulse = JSON.parse(res.data);
    assert.ok(pulse.staff >= 30, `staff ${pulse.staff}`);
    assert.ok(pulse.working > 5, `working ${pulse.working}`);
    assert.ok(pulse.locations.length >= 3, "people at several places");
    assert.ok(pulse.locations.every((l) => l.name !== "Somewhere no longer listed"));
  });

  await check("Plan & Billing shows the package and that it is shared", async () => {
    await asOwnerIn(bySlug["demo-restaurant-mcr"]);
    const res = await getMyPlan();
    assert.equal(res.success, true, res.message);
    const plan = JSON.parse(res.data);
    assert.ok(plan.plan || plan.current || plan.packages, "a plan to show");
  });

  /* ----------------------------------------------------------- view-only */

  await check("nothing can be changed: company record, data, payment, clocking", async () => {
    const me = await asOwnerIn(construction);
    invalidateCompanyAccess(String(construction._id));

    const branding = await updateTenantBranding(String(construction._id), { appName: "Hacked" });
    assert.equal(branding.success, false);
    assert.match(branding.message, /read-only/);
    assert.equal((await db.collection("companies").findOne({ _id: construction._id })).branding?.appName, undefined);

    const overage = await setOverageMode("block");
    assert.equal(overage.success, false);

    const card = await startCardSetup({ returnUrl: "http://localhost/x" });
    assert.equal(card.success, false);
    assert.match(card.message, /demo/);

    await assert.rejects(
      runWithTenant(String(construction._id), () =>
        ProjectSiteModel.create({ siteName: "New", startDate: new Date(), endDate: new Date() })
      ),
      /read-only/
    );

    const clock = await runWithTenant(String(construction._id), () =>
      performClockAction({ employeeId: String(me._id), action: "clockIn" })
    );
    assert.equal(clock.success, false);
    assert.match(clock.message, /demo/);
  });

  /* ------------------------------------------------- the screens need no writes */

  await check("no screen needs to save anything to be shown", async () => {
    const blocked = [];
    let current = "";
    const original = { log: console.log, error: console.error, warn: console.warn };
    const listen = (...a) => {
      const text = a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : x?.message || "")).join(" ");
      if (/blocked: this company's account is read-only/.test(text)) {
        blocked.push(`${current}: ${text.match(/(\w+)\.(\w+) blocked/)?.slice(1, 3).join(".") || text.slice(0, 80)}`);
      }
    };
    console.log = listen;
    console.error = listen;
    console.warn = listen;

    let called = 0;
    try {
      for (const file of serverModules()) {
        let mod;
        try {
          mod = await import(path.resolve(file));
        } catch {
          continue;
        }
        for (const [name, fn] of Object.entries(mod)) {
          if (typeof fn !== "function" || !READ_NAME.test(name) || SKIP.has(name)) continue;
          for (const company of companies) {
            await asOwnerIn(company);
            current = `${path.relative("server", file)} ${name} (${company.slug})`;
            called += 1;
            try {
              await Promise.race([
                runWithTenant(String(company._id), () => fn()),
                new Promise((r) => setTimeout(r, 5000)),
              ]);
            } catch (e) {
              listen(e);
            }
          }
        }
      }
    } finally {
      Object.assign(console, original);
    }
    assert.ok(called > 100, `swept ${called} calls`);
    const unique = [...new Set(blocked)];
    assert.equal(unique.length, 0, `screens that tried to save:\n    ${unique.join("\n    ")}`);
  });

  /* ------------------------------------------------------- refresh, remove */

  await check("--apply again refreshes the data, same companies", async () => {
    const before = await db.collection("companies").find({ seedMarker: "demo" }).project({ _id: 1 }).toArray();
    const people = await db.collection("employes").countDocuments({ tenantId: construction._id });
    seed("--apply", `--password=${PASSWORD}`);
    const after = await db.collection("companies").find({ seedMarker: "demo" }).project({ _id: 1 }).toArray();
    assert.deepEqual(after.map((c) => String(c._id)).sort(), before.map((c) => String(c._id)).sort());
    assert.equal(await db.collection("employes").countDocuments({ tenantId: construction._id }), people);
    assert.equal(await db.collection("tenantmemberships").countDocuments({ email: EMAIL }), 4);
    const res = await LoginData(EMAIL, PASSWORD, "test-device", "127.0.0.1");
    assert.equal(res.status, true, res.message);
  });

  await check("--remove takes everything away, and only that", async () => {
    seed("--remove");
    assert.equal(await db.collection("companies").countDocuments({ seedMarker: "demo" }), 0);
    const ids = companies.map((c) => c._id);
    for (const name of ["officeemployes", "employes", "clockrecords", "projectsites", "tenantmemberships", "leaverequests"]) {
      assert.equal(await db.collection(name).countDocuments({ tenantId: { $in: ids } }), 0, name);
    }
    assert.equal(await db.collection("billingaccounts").countDocuments({}), 0);
    assert.ok(await db.collection("officeemployes").findOne({ email: "boss@real.test" }), "the real company is untouched");
  });

  await mongoose.disconnect();
  for (const [s, n] of results) console.log(`${s === "pass" ? "✓" : "✗"} ${n}`);
  const failed = results.filter(([s]) => s !== "pass").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
