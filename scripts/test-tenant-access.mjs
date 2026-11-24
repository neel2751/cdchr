/**
 * Free trials that end, and companies that can be locked.
 *
 * What has to hold:
 *
 *   - THE POINT: a self-serve company's trial ends, and then it is not free —
 *     a week's grace, a week read-only, then locked;
 *   - locked means locked: its staff cannot sign in, and are not let back in
 *     by a session they already had; its super admin can, to be told why;
 *   - read-only means nothing changes — except clocking in, which carries on;
 *   - the platform admin can extend a trial, mark a company paying, and lock
 *     or unlock it by hand, and only the platform admin can;
 *   - nothing that already exists is locked by deploying this: a paying
 *     company, a trial from before end dates, a company that switched its own
 *     legacy "inactive" toggle.
 *
 * Needs a LOCAL replica-set database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_access?replicaSet=rs0&directConnection=true" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-tenant-access.mjs
 */
import assert from "node:assert";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { actAs } from "./lib/session-stub.mjs";

dotenv.config();
process.env.EMAIL_HOST = "";
process.env.EMAIL_USERNAME = "";
process.env.EMAIL_PASSWORD = "";

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(["pass", name]))
    .catch((e) => results.push(["FAIL", `${name} — ${e.message}`]));
}

const DAY = 24 * 60 * 60 * 1000;
const daysFrom = (n, from = new Date()) => new Date(from.getTime() + n * DAY);

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.db.dropDatabase();
  const db = mongoose.connection.db;

  const {
    companyAccess,
    canEnter,
    dueTrialReminder,
    ACCESS_RULES,
  } = await import("@/lib/tenantAccess");
  const { runWithTenant, essentialWrite } = await import("@/lib/tenantContext");
  const { invalidateCompanyAccess } = await import(
    "@/server/tenantServer/tenantAccessState"
  );
  const { LoginData } = await import("@/server/authServer/authServer");
  const { COMPANY_PAUSED_MESSAGE } = await import("@/lib/authErrors");
  const ProjectSite = (await import("@/models/siteProjectModel")).default;
  const { performClockAction } = await import("@/server/clockServer/clockActions");
  const { POST: accountStatus } = await import("@/app/api/account/status/route");
  const { setTenantAccessLock, setTenantTrialEnd, setTenantStatus } = await import(
    "@/server/tenantServer/platformServer"
  );
  const { startSignup, completeSignup } = await import(
    "@/server/authServer/signupServer"
  );

  /* ------------------------------------------------------- the ladder, pure */

  const start = new Date("2026-11-01T09:00:00Z");
  const trial = {
    status: "trial",
    billing: { trialEndsAt: daysFrom(ACCESS_RULES.trialDays, start) },
  };
  const at = (days) => companyAccess(trial, daysFrom(days, start));

  await check("THE POINT: a trial runs, then grace, then read-only, then locked", () => {
    assert.equal(at(1).level, "full");
    assert.equal(at(1).reason, "trial");
    assert.equal(at(1).daysLeft, 13);
    assert.equal(at(15).level, "grace");
    assert.equal(at(22).level, "readOnly");
    assert.equal(at(29).level, "locked");
    assert.equal(at(400).level, "locked", "and stays locked");
  });

  await check("each stage says what comes next, and when", () => {
    assert.equal(at(15).nextLevel, "readOnly");
    assert.equal(at(22).nextLevel, "locked");
    assert.equal(at(29).nextLevel, null);
  });

  await check("a paying company has full access", () => {
    assert.equal(companyAccess({ status: "active" }).level, "full");
    assert.equal(companyAccess({}).level, "full", "no status means active");
  });

  await check("REGRESSION: a trial from before end dates is not locked by deploying", () => {
    assert.equal(companyAccess({ status: "trial" }).level, "full");
  });

  await check("REGRESSION: a company's own 'inactive' toggle does not lock it", () => {
    assert.equal(companyAccess({ status: "active", isActive: false }).level, "full");
  });

  await check("suspended and cancelled are locked; a hand lock wins over the dates", () => {
    assert.equal(companyAccess({ status: "suspended" }).level, "locked");
    assert.equal(companyAccess({ status: "cancelled" }).level, "locked");
    assert.equal(
      companyAccess({ status: "active", billing: { lock: { level: "readOnly" } } }).level,
      "readOnly",
    );
    assert.equal(
      companyAccess({ ...trial, billing: { ...trial.billing, lock: { level: "locked" } } }, start)
        .level,
      "locked",
    );
  });

  await check("only the super admin gets into a locked company", () => {
    const locked = companyAccess({ status: "suspended" });
    assert.equal(canEnter(locked, "superAdmin"), true);
    assert.equal(canEnter(locked, "admin"), false);
    assert.equal(canEnter(locked, "siteEmployee"), false);
    assert.equal(canEnter(companyAccess({ status: "active" }), "user"), true);
  });

  await check("reminders: one per stage, only the latest, never backwards", () => {
    assert.equal(dueTrialReminder(at(3), []), null, "nothing 11 days out");
    assert.equal(dueTrialReminder(at(8), []), "7d");
    assert.equal(dueTrialReminder(at(8), ["7d"]), null, "not twice");
    assert.equal(dueTrialReminder(at(13.5), []), "1d", "a missed week skips ahead");
    assert.equal(dueTrialReminder(at(15), ["7d", "3d", "1d"]), "ended");
    assert.equal(dueTrialReminder(at(22), ["ended"]), "readOnly");
    assert.equal(dueTrialReminder(at(29), ["readOnly"]), "locked");
    assert.equal(dueTrialReminder(at(8), ["ended"]), null, "never backwards");
    assert.equal(dueTrialReminder(companyAccess({ status: "active" }), []), null);
  });

  /* -------------------------------------------------------- the companies */

  const oid = () => new mongoose.Types.ObjectId();
  const company = async (fields) => {
    const _id = oid();
    await db.collection("companies").insertOne({
      _id,
      name: fields.name,
      isActive: true,
      delete: false,
      ...fields,
    });
    return _id;
  };
  const paying = await company({ name: "Paying Ltd", status: "active" });
  const expired = await company({
    name: "Expired Ltd",
    status: "trial",
    billing: { trialEndsAt: daysFrom(-30) },
  });
  const readOnly = await company({
    name: "Read Only Ltd",
    status: "active",
    billing: { lock: { level: "readOnly", message: "Invoice overdue" } },
  });

  const password = "Correct-horse-9";
  const hash = bcrypt.hashSync(password, 10);
  const person = async (tenantId, email, extra = {}) => {
    const _id = oid();
    await db.collection("officeemployes").insertOne({
      _id,
      tenantId,
      email,
      name: email.split("@")[0],
      password: hash,
      isActive: true,
      delete: false,
      immigrationType: "Other",
      createdAt: new Date(),
      ...extra,
    });
    return _id;
  };
  const owner = await person(expired, "owner@expired.test", { isSuperAdmin: true });
  const clerk = await person(expired, "clerk@expired.test");
  await person(paying, "clerk@paying.test");
  const roClerk = await person(readOnly, "clerk@readonly.test");

  /* ---------------------------------------------------------------- login */

  const login = (email) => LoginData(email, password, "test-device", "127.0.0.1");

  await check("THE POINT: staff of a locked company cannot sign in", async () => {
    const res = await login("clerk@expired.test");
    assert.equal(res.status, false);
    assert.equal(res.message, COMPANY_PAUSED_MESSAGE);
  });

  await check("…its super admin can, to be told why", async () => {
    const res = await login("owner@expired.test");
    assert.equal(res.status, true, res.message);
  });

  await check("REGRESSION: a paying company's staff sign in as before", async () => {
    const res = await login("clerk@paying.test");
    assert.equal(res.status, true, res.message);
  });

  await check("a read-only company's staff can still sign in", async () => {
    const res = await login("clerk@readonly.test");
    assert.equal(res.status, true, res.message);
  });

  /* ------------------------------------------ sessions already signed in */

  const askStatus = async (employeeId, tenantId) => {
    const res = await accountStatus(
      new Request("http://test/api/account/status", {
        method: "POST",
        body: JSON.stringify({ employeeId: String(employeeId), tenantId: String(tenantId) }),
      }),
    );
    return res.json();
  };

  await check("a session from before the lock is sent to the paused page", async () => {
    const res = await askStatus(clerk, expired);
    assert.equal(res.tenantAccess, "locked");
  });

  await check("…but the route will not say how a company it is not in stands", async () => {
    const stranger = await person(paying, "nosy@paying.test");
    const res = await askStatus(stranger, expired);
    assert.equal(res.tenantAccess, "full");
  });

  /* ----------------------------------------------------------- read-only */

  const as = (tenantId, id, role = "user") =>
    actAs({ _id: String(id), role, tenantId: String(tenantId) });
  const addSite = (tenantId) =>
    runWithTenant(String(tenantId), () =>
      ProjectSite.create({
        siteName: `Site ${crypto.randomUUID().slice(0, 6)}`,
        startDate: new Date(),
        endDate: daysFrom(90),
      }),
    );

  as(readOnly, roClerk);
  await check("THE POINT: read-only means nothing can be added or changed", async () => {
    await assert.rejects(() => addSite(readOnly), /read-only/i);
  });

  as(readOnly, roClerk);
  await check("…except the essentials — clocking in", async () => {
    const site = await essentialWrite("test", () => addSite(readOnly));
    assert.ok(site?._id);
  });

  as(expired, owner, "superAdmin");
  await check("a locked company cannot write, essentials included", async () => {
    await assert.rejects(() => essentialWrite("test", () => addSite(expired)), /read-only/i);
  });

  as(paying, oid());
  await check("REGRESSION: a paying company writes as before", async () => {
    const site = await addSite(paying);
    assert.ok(site?._id);
  });

  actAs(null);
  await check("a locked company's NFC taps and QR scans are refused", async () => {
    const res = await runWithTenant(String(expired), () =>
      performClockAction({ employeeId: String(clerk), action: "clockIn" }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /locked/i);
  });

  /* ------------------------------------------------- the platform console */

  const platform = () => actAs({ _id: String(oid()), role: "platformAdmin", name: "Ops" });

  as(paying, oid(), "superAdmin");
  await check("only the platform admin can lock or extend", async () => {
    assert.equal((await setTenantAccessLock(String(paying), { level: "locked" })).success, false);
    assert.equal((await setTenantTrialEnd(String(expired), daysFrom(7))).success, false);
  });

  platform();
  await check("extending an expired trial opens the company again", async () => {
    const res = await setTenantTrialEnd(String(expired), daysFrom(10).toISOString());
    assert.equal(res.success, true, res.message);
    invalidateCompanyAccess();
    const again = await login("clerk@expired.test");
    assert.equal(again.status, true, again.message);
  });

  platform();
  await check("a paying company has no trial to extend", async () => {
    const res = await setTenantTrialEnd(String(paying), daysFrom(10).toISOString());
    assert.equal(res.success, false);
  });

  platform();
  await check("lock by hand, with a note — then unlock", async () => {
    const res = await setTenantAccessLock(String(paying), {
      level: "locked",
      message: "Invoice 42 is overdue",
    });
    assert.equal(res.success, true, res.message);
    const doc = await db.collection("companies").findOne({ _id: paying });
    assert.equal(doc.billing.lock.level, "locked");
    assert.equal(doc.billing.lock.message, "Invoice 42 is overdue");
    assert.equal((await login("clerk@paying.test")).status, false);

    platform();
    const open = await setTenantAccessLock(String(paying), { level: null });
    assert.equal(open.success, true, open.message);
    assert.equal((await login("clerk@paying.test")).status, true);
  });

  platform();
  await check("unlocking a suspended company reactivates it", async () => {
    await setTenantStatus(String(paying), "suspended");
    assert.equal((await login("clerk@paying.test")).status, false);
    platform();
    await setTenantAccessLock(String(paying), { level: null });
    const doc = await db.collection("companies").findOne({ _id: paying });
    assert.equal(doc.status, "active");
    assert.equal((await login("clerk@paying.test")).status, true);
  });

  platform();
  await check("putting a company on trial gives it an end date", async () => {
    await setTenantStatus(String(paying), "trial");
    const doc = await db.collection("companies").findOne({ _id: paying });
    assert.ok(doc.billing.trialEndsAt > new Date(), "no end date — free for ever");
    platform();
    await setTenantStatus(String(paying), "active");
  });

  /* --------------------------------------------------------------- signup */

  actAs(null);
  await check("THE POINT: a new sign-up's trial has an end date", async () => {
    const token = crypto.randomBytes(16).toString("hex");
    await db.collection("pendingsignups").insertOne({
      companyName: "Fresh Start Ltd",
      slug: `fresh-${Date.now()}`,
      name: "Fran",
      email: `fran-${Date.now()}@fresh.test`,
      phoneNumber: 7700900123,
      industry: "construction",
      passwordHash: hash,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: null,
    });
    const res = await completeSignup(token);
    assert.equal(res.success, true, res.message);
    const doc = await db.collection("companies").findOne({ name: "Fresh Start Ltd" });
    assert.equal(doc.status, "trial");
    const days = (new Date(doc.billing.trialEndsAt) - Date.now()) / DAY;
    assert.ok(days > 13.9 && days <= 14, `trial is ${days} days`);
  });
  void startSignup;

  await db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s === "FAIL");
  for (const [status, name] of results) {
    console.log(`  ${status === "pass" ? "ok  " : status}  ${name}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` — ${failed.length} FAILED` : ""),
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
