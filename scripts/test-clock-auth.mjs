/**
 * Who may edit somebody else's attendance.
 *
 * The clock-editing server actions had no authorisation whatsoever. `withAudit`
 * wraps them, but it only *logs*, and only for admin and superAdmin — any other
 * role falls straight through to the handler, unrecorded (lib/audit.js:42). The
 * only thing that looked like a gate was `role: ["superAdmin"]` on a menu
 * entry, and a menu entry gates a link, not an HTTP endpoint.
 *
 * So an ordinary employee could rewrite their own clock-out, or a colleague's,
 * and it would not appear in the audit log. Those times feed pay and CIS.
 *
 * Needs a LOCAL database — it writes. The script refuses anything else.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_clockauth" \
 *   node --import ./scripts/lib/action-loader.mjs scripts/test-clock-auth.mjs
 *
 * Uses action-loader, not alias-loader: these assertions are *about* the
 * session, so the session module has to be swappable.
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
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database — this script writes.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const { canManageAttendance } = await import("@/server/clockServer/clockAuth");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const RoleBased = (await import("@/models/rolebasedModel")).default;

  await mongoose.connection.db.collection("rolebaseds").deleteMany({});

  const tenantId = new mongoose.Types.ObjectId();
  withTenant = (fn) => runWithTenant(String(tenantId), fn);

  const ids = {
    superAdmin: new mongoose.Types.ObjectId(),
    adminGranted: new mongoose.Types.ObjectId(),
    adminUngranted: new mongoose.Types.ObjectId(),
    siteManager: new mongoose.Types.ObjectId(),
    plainUser: new mongoose.Types.ObjectId(),
    siteEmployee: new mongoose.Types.ObjectId(),
    reception: new mongoose.Types.ObjectId(),
  };

  const as = (key, role) =>
    actAs({ _id: String(ids[key]), role, tenantId: String(tenantId) });

  await withTenant(async () => {
    await RoleBased.create([
      {
        name: "Office admin",
        employeeId: ids.adminGranted,
        isActive: true,
        permissions: ["/admin/attendance", "/admin/officeEmployee"],
      },
      {
        name: "Admin without attendance",
        employeeId: ids.adminUngranted,
        isActive: true,
        permissions: ["/admin/officeEmployee"],
      },
      {
        name: "Site manager",
        employeeId: ids.siteManager,
        isActive: true,
        permissions: ["/admin/siteAssign", "/admin/siteAssignEmployee"],
      },
      {
        name: "Plain user",
        employeeId: ids.plainUser,
        isActive: true,
        permissions: ["/admin/expense"],
      },
    ]);
  });

  /* ------------------------------------------------------------- allowed */

  await check("a super admin may manage attendance", async () => {
    as("superAdmin", "superAdmin");
    assert.equal((await canManageAttendance()).ok, true);
  });

  await check("an admin granted the office screen may", async () => {
    as("adminGranted", "admin");
    assert.equal((await canManageAttendance()).ok, true);
  });

  await check("THE POINT: a site manager granted the roll-call may", async () => {
    // Phase 0's whole reason for existing. This person stands on the site while
    // their team arrives; before this they could not clock anyone in.
    as("siteManager", "user");
    const verdict = await canManageAttendance();
    assert.equal(verdict.ok, true, verdict.reason);
  });

  /* ------------------------------------------------------------- refused */

  await check("REGRESSION: a site employee may not", async () => {
    // The hole. This role could previously call the action directly and rewrite
    // anybody's hours, with no audit entry written.
    as("siteEmployee", "siteEmployee");
    const verdict = await canManageAttendance();
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not allowed/i);
  });

  await check("REGRESSION: an office user with no grant may not", async () => {
    as("plainUser", "user");
    assert.equal((await canManageAttendance()).ok, false);
  });

  await check("an admin without the grant may not", async () => {
    // Role alone is not enough — the permission is the control.
    as("adminUngranted", "admin");
    assert.equal((await canManageAttendance()).ok, false);
  });

  await check("reception may not, even if somehow granted", async () => {
    // Reception operates a shared desk machine; it is the wrong place to be
    // able to rewrite hours from.
    await withTenant(() =>
      RoleBased.create({
        name: "Reception",
        employeeId: ids.reception,
        isActive: true,
        permissions: ["/admin/attendance"],
      }),
    );
    as("reception", "reception");
    assert.equal((await canManageAttendance()).ok, false);
  });

  await check("a revoked (inactive) grant does not count", async () => {
    await withTenant(() =>
      RoleBased.updateOne(
        { employeeId: ids.siteManager },
        { $set: { isActive: false } },
      ),
    );
    as("siteManager", "user");
    assert.equal((await canManageAttendance()).ok, false);
    await withTenant(() =>
      RoleBased.updateOne(
        { employeeId: ids.siteManager },
        { $set: { isActive: true } },
      ),
    );
  });

  await check("no session at all is refused", async () => {
    actAs(null);
    const verdict = await canManageAttendance();
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /signed in/i);
  });

  /* ------------------------------------------- and the action itself refuses */

  await check("the clock-edit action refuses an unauthorised caller", async () => {
    const { updateClockManuallyByIdNew } = await import(
      "@/server/timeOffServer/updateClockServer"
    );
    as("siteEmployee", "siteEmployee");
    const res = await withTenant(() =>
      updateClockManuallyByIdNew({
        employeeId: String(ids.plainUser),
        date: new Date(Date.UTC(2026, 8, 19)),
        clockIn: "09:00",
      }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /not allowed/i);
  });

  /* --------------------------------------------- the default location */

  await check("the default office can be moved", async () => {
    // Nothing set isDefault before this. ensureDefaultLocation() picked one on
    // first use and that was the end of it, so a company with two offices was
    // stuck with whichever the migration happened to adopt.
    as("superAdmin", "superAdmin");
    const { setDefaultLocation } = await import(
      "@/server/clockServer/locations"
    );
    const ClockLocation = (await import("@/models/clockLocationModel")).default;

    await withTenant(async () => {
      const a = await ClockLocation.create({
        name: "First Office",
        kind: "office",
        isDefault: true,
      });
      const b = await ClockLocation.create({
        name: "Second Office",
        kind: "office",
      });

      const res = await setDefaultLocation({ id: String(b._id) });
      assert.equal(res.success, true, res.message);
      assert.equal((await ClockLocation.findById(b._id).lean()).isDefault, true);
      assert.equal(
        (await ClockLocation.findById(a._id).lean()).isDefault,
        false,
        "the old default was not cleared — the index allows only one",
      );
    });
  });

  await check("a site cannot be made the default", async () => {
    // The default is where a clock-in naming no site is recorded, so a site
    // holding it would file office attendance under a job.
    as("superAdmin", "superAdmin");
    const { setDefaultLocation } = await import(
      "@/server/clockServer/locations"
    );
    const ClockLocation = (await import("@/models/clockLocationModel")).default;

    await withTenant(async () => {
      const site = await ClockLocation.create({
        name: "A Job",
        kind: "site",
        projectSiteId: new mongoose.Types.ObjectId(),
      });
      const res = await setDefaultLocation({ id: String(site._id) });
      assert.equal(res.success, false);
      assert.match(res.message, /has to be an office/i);
    });
  });

  await check("only a super admin may move the default", async () => {
    as("adminGranted", "admin");
    const { setDefaultLocation } = await import(
      "@/server/clockServer/locations"
    );
    const ClockLocation = (await import("@/models/clockLocationModel")).default;

    await withTenant(async () => {
      const office = await ClockLocation.findOne({ name: "First Office" }).lean();
      const res = await setDefaultLocation({ id: String(office._id) });
      assert.equal(res.success, false);
      assert.match(res.message, /not authorized/i);
    });
  });

  /* ------------------------------------------------ site name uniqueness */

  // startDate and endDate are required on ProjectSite; without them the create
  // fails validation and the name check never runs.
  const siteFixture = {
    siteDelete: false,
    startDate: new Date(Date.UTC(2026, 0, 1)),
    endDate: new Date(Date.UTC(2026, 11, 31)),
  };

  await check("a site cannot take another site's name", async () => {
    // Enforced where a person types it, not on the location that mirrors it:
    // refusing the copy while allowing the original leaves the two permanently
    // disagreeing, which is what halted the first migration.
    as("superAdmin", "superAdmin");
    const { updateSiteProjectById } = await import(
      "@/server/siteProjectServer/siteProjectServer"
    );
    const ProjectSite = (await import("@/models/siteProjectModel")).default;

    await withTenant(async () => {
      await ProjectSite.create({ ...siteFixture, siteName: "Park Road New" });
      const res = await updateSiteProjectById(
        { ...siteFixture, siteName: "Park Road New" },
        null,
      );
      assert.equal(res.success, false, "a duplicate site name was accepted");
      assert.match(res.message, /already called/i);
    });
  });

  await check("the comparison ignores case and padding", async () => {
    as("superAdmin", "superAdmin");
    const { updateSiteProjectById } = await import(
      "@/server/siteProjectServer/siteProjectServer"
    );
    await withTenant(async () => {
      const res = await updateSiteProjectById(
        { ...siteFixture, siteName: "  park road NEW  " },
        null,
      );
      assert.equal(res.success, false, "case-only difference was accepted");
    });
  });

  await check("a site cannot take an office's name", async () => {
    as("superAdmin", "superAdmin");
    const { updateSiteProjectById } = await import(
      "@/server/siteProjectServer/siteProjectServer"
    );
    const ClockLocation = (await import("@/models/clockLocationModel")).default;

    await withTenant(async () => {
      await ClockLocation.create({ name: "Northgate", kind: "office" });
      const res = await updateSiteProjectById(
        { ...siteFixture, siteName: "Northgate" },
        null,
      );
      assert.equal(res.success, false);
      assert.match(res.message, /office is already called/i);
    });
  });

  await check("a site may keep its own name when edited", async () => {
    // The rename check must not refuse a site for clashing with itself, or no
    // site could ever have anything else about it changed.
    as("superAdmin", "superAdmin");
    const { updateSiteProjectById } = await import(
      "@/server/siteProjectServer/siteProjectServer"
    );
    const ProjectSite = (await import("@/models/siteProjectModel")).default;

    await withTenant(async () => {
      const site = await ProjectSite.create({
        ...siteFixture,
        siteName: "Keeps Its Name",
      });
      const res = await updateSiteProjectById(
        { siteName: "Keeps Its Name", siteType: "Commercial" },
        String(site._id),
      );
      assert.equal(res.success, true, res.message);
    });
  });

  await check("a deleted site does not block the name", async () => {
    as("superAdmin", "superAdmin");
    const { updateSiteProjectById } = await import(
      "@/server/siteProjectServer/siteProjectServer"
    );
    const ProjectSite = (await import("@/models/siteProjectModel")).default;

    await withTenant(async () => {
      await ProjectSite.create({
        ...siteFixture,
        siteName: "Gone",
        siteDelete: true,
      });
      const res = await updateSiteProjectById(
        { ...siteFixture, siteName: "Gone" },
        null,
      );
      assert.equal(res.success, true, res.message);
    });
  });

  /* ------------------------------------------- which office is this screen */

  await check("an enrolled screen says which office it is in", async () => {
    // The whole point of §10.4: the screen answers, not the person standing
    // at it, and not this browser's localStorage.
    as("superAdmin", "superAdmin");
    const { getDeviceLocation, setDeviceLocation } = await import(
      "@/server/deviceServer/deviceManagementServer"
    );
    const ClockLocation = (await import("@/models/clockLocationModel")).default;
    const OfficeUser = (await import("@/models/officeModel")).default;

    await withTenant(async () => {
      const office = await ClockLocation.create({
        name: "Enrolled Office",
        kind: "office",
      });
      const user = await OfficeUser.create({
        name: "Front Desk",
        email: `desk-${Date.now()}@example.com`,
        password: "x",
        authorizedDevices: [{ deviceId: "SCREEN-1", deviceName: "Lobby" }],
      });

      const set = await setDeviceLocation({
        userId: String(user._id),
        deviceId: "SCREEN-1",
        locationId: String(office._id),
      });
      assert.equal(set.success, true, set.message);

      const got = JSON.parse(
        (await getDeviceLocation({ deviceId: "SCREEN-1" })).data,
      );
      assert.equal(got.locationId, String(office._id));
      assert.equal(got.locationName, "Enrolled Office");
    });
  });

  await check("the account's office covers an unenrolled screen", async () => {
    // A replacement tablet, or a second browser. Without this the desk falls
    // all the way back to asking, and the answer lives in that browser only.
    as("superAdmin", "superAdmin");
    const { getDeviceLocation } = await import(
      "@/server/deviceServer/deviceManagementServer"
    );
    const ClockLocation = (await import("@/models/clockLocationModel")).default;
    const OfficeUser = (await import("@/models/officeModel")).default;

    await withTenant(async () => {
      const office = await ClockLocation.create({
        name: "Desk Default Office",
        kind: "office",
      });
      // The signed-in account is what the fallback reads, so it has to be the
      // one the session stub is pretending to be.
      await OfficeUser.findOneAndUpdate(
        { _id: ids.superAdmin },
        {
          $set: {
            clockLocationId: office._id,
            isReception: true,
            name: "Front Desk Account",
            email: `desk-account-${Date.now()}@example.com`,
            password: "x",
          },
        },
        { upsert: true },
      );

      const got = JSON.parse(
        (await getDeviceLocation({ deviceId: "AN-UNKNOWN-SCREEN" })).data,
      );
      assert.equal(got.locationName, "Desk Default Office");
      assert.equal(got.source, "account");
    });
  });

  await check("an enrolled screen beats the account's office", async () => {
    // The screen is the thing physically in a room. Two receptionists signing
    // in on alternate days are still one screen in one office.
    as("superAdmin", "superAdmin");
    const { getDeviceLocation, setDeviceLocation } = await import(
      "@/server/deviceServer/deviceManagementServer"
    );
    const ClockLocation = (await import("@/models/clockLocationModel")).default;
    const OfficeUser = (await import("@/models/officeModel")).default;

    await withTenant(async () => {
      const screenOffice = await ClockLocation.create({
        name: "Screen Wins Office",
        kind: "office",
      });
      await OfficeUser.findOneAndUpdate(
        { _id: ids.superAdmin },
        { $push: { authorizedDevices: { deviceId: "SCREEN-2" } } },
      );
      await setDeviceLocation({
        userId: String(ids.superAdmin),
        deviceId: "SCREEN-2",
        locationId: String(screenOffice._id),
      });

      const got = JSON.parse(
        (await getDeviceLocation({ deviceId: "SCREEN-2" })).data,
      );
      assert.equal(got.locationName, "Screen Wins Office");
      assert.equal(got.source, "screen");
    });
  });

  await check("an unenrolled screen answers nothing, not a guess", async () => {
    // It has to fall through to asking. Guessing an office here would file
    // attendance at the wrong one with nothing looking broken.
    as("superAdmin", "superAdmin");
    const { getDeviceLocation } = await import(
      "@/server/deviceServer/deviceManagementServer"
    );
    const OfficeUser = (await import("@/models/officeModel")).default;
    await withTenant(async () => {
      // No screen AND no desk office: the only case where it should ask.
      await OfficeUser.findOneAndUpdate(
        { _id: ids.superAdmin },
        { $set: { clockLocationId: null } },
      );
      const got = JSON.parse(
        (await getDeviceLocation({ deviceId: "NEVER-SEEN" })).data,
      );
      assert.equal(got.locationId, undefined);
    });
  });

  await check("archiving the office unbinds the screen", async () => {
    // Read through to the location rather than trusting the device entry: an
    // office archived after enrolment must not keep minting codes for itself.
    as("superAdmin", "superAdmin");
    const { getDeviceLocation } = await import(
      "@/server/deviceServer/deviceManagementServer"
    );
    const ClockLocation = (await import("@/models/clockLocationModel")).default;

    await withTenant(async () => {
      await ClockLocation.updateOne(
        { name: "Enrolled Office" },
        { $set: { isActive: false } },
      );
      const got = JSON.parse(
        (await getDeviceLocation({ deviceId: "SCREEN-1" })).data,
      );
      assert.equal(got.locationId, undefined, "an archived office still bound");
    });
  });

  /* ------------------------------------------------- the reception list */

  await check("only reception accounts are listed", async () => {
    // This filtered on `delete: false` alone, so the screen showed every
    // office employee in the company and an administrator had to know which
    // of them was the front desk.
    as("superAdmin", "superAdmin");
    const { getReceptionUsers } = await import(
      "@/server/receptionServer/receptionServer"
    );
    const OfficeUser = (await import("@/models/officeModel")).default;

    await withTenant(async () => {
      await OfficeUser.create({
        name: "Ordinary Office Staff",
        email: `staff-${Date.now()}@example.com`,
        password: "x",
        delete: false,
      });
      await OfficeUser.create({
        name: "The Front Desk",
        email: `front-${Date.now()}@example.com`,
        password: "x",
        delete: false,
        isReception: true,
      });

      const listed = JSON.parse((await getReceptionUsers()).data);
      const names = listed.map((u) => u.name);
      assert.ok(names.includes("The Front Desk"), "the desk is missing");
      assert.ok(
        !names.includes("Ordinary Office Staff"),
        "office staff are still being listed as reception accounts",
      );
    });
  });

  await check("a reception password reset works and is hashed", async () => {
    // Two bugs met here: the guard read `user.isReception`, which nothing set
    // and the session never carried, so it refused everybody; and the hash was
    // not awaited, so a Promise went into the password field and the account
    // could never sign in again — while the screen said it had worked.
    as("superAdmin", "superAdmin");
    const { updateReceptionUserPassword } = await import(
      "@/server/receptionServer/receptionServer"
    );
    const OfficeUser = (await import("@/models/officeModel")).default;
    const { isMatchedPassword } = await import("@/utils/bcrypt");

    await withTenant(async () => {
      const desk = await OfficeUser.create({
        name: "Resettable Desk",
        email: `reset-${Date.now()}@example.com`,
        password: "x",
        delete: false,
        isReception: true,
      });

      const res = await updateReceptionUserPassword(
        String(desk._id),
        "NewPass123!",
      );
      assert.equal(res.success, true, res.message);

      const after = await OfficeUser.findById(desk._id).lean();
      assert.equal(
        typeof after.password,
        "string",
        "a Promise was stored instead of a hash",
      );
      assert.ok(
        await isMatchedPassword("NewPass123!", after.password),
        "the stored value is not a usable hash of the new password",
      );
    });
  });

  await check("a non-super-admin cannot reset a desk password", async () => {
    as("adminGranted", "admin");
    const { updateReceptionUserPassword } = await import(
      "@/server/receptionServer/receptionServer"
    );
    const res = await withTenant(() =>
      updateReceptionUserPassword(String(ids.reception), "whatever"),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /unauthor/i);
  });

  /* ------------------------------------------- PAF lookup, which costs us */

  await check("a malformed postcode never costs a lookup", async () => {
    // The whole guard: PAF is billed per call, the key is ours, and the
    // person pressing the button works for somebody else. A postcode that
    // cannot have an answer must not be asked about.
    as("superAdmin", "superAdmin");
    const { findAddresses, saveAddressAccount } = await import(
      "@/server/addressServer/paf"
    );

    // Configure and enable a licence, through the real action.
    actAs({ _id: String(ids.superAdmin), role: "platformAdmin", tenantId: String(tenantId) });
    const saved = await saveAddressAccount({
      provider: "ideal-postcodes",
      credentials: { apiKey: "test-key" },
      isEnabled: true,
    });
    assert.equal(saved.success, true, saved.message);

    as("superAdmin", "superAdmin");
    let called = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ code: 2000, result: [] }) };
    };
    try {
      const res = await withTenant(() =>
        findAddresses({ postcode: "NOT A POSTCODE" }),
      );
      assert.equal(res.success, false);
      assert.match(res.message, /not a valid UK postcode/i);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(called, false, "a billable lookup went out for rubbish");
  });

  await check("only someone who can order may look up", async () => {
    // Not platform-only — the point is that a customer uses our licence —
    // but not open either.
    as("siteEmployee", "employee");
    const { findAddresses } = await import("@/server/addressServer/paf");
    const res = await withTenant(() =>
      findAddresses({ postcode: "SW1A 1AA" }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /not authorized/i);
  });

  await check("the same postcode twice is one charge", async () => {
    // A double click should not be two invoices.
    as("superAdmin", "superAdmin");
    const { findAddresses } = await import("@/server/addressServer/paf");

    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 2000,
          result: [
            { line_1: "10 Downing Street", post_town: "LONDON", postcode: "SW1A 2AA" },
          ],
        }),
      };
    };
    try {
      const first = await withTenant(() =>
        findAddresses({ postcode: "SW1A 2AA" }),
      );
      assert.equal(first.success, true, first.message);
      assert.equal(JSON.parse(first.data).cached, false);

      const second = await withTenant(() =>
        findAddresses({ postcode: "sw1a2aa" }),
      );
      assert.equal(JSON.parse(second.data).cached, true, "it asked twice");
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(calls, 1, `${calls} billable calls for one postcode`);
  });

  await check("no licence means the form falls back, not breaks", async () => {
    // A licensed extra must never become something you cannot order without.
    actAs({ _id: String(ids.superAdmin), role: "platformAdmin", tenantId: String(tenantId) });
    const { saveAddressAccount, addressLookupAvailable, findAddresses } =
      await import("@/server/addressServer/paf");
    await saveAddressAccount({ provider: "ideal-postcodes", isEnabled: false });

    as("superAdmin", "superAdmin");
    const available = JSON.parse(
      (await withTenant(() => addressLookupAvailable())).data,
    );
    assert.equal(available.available, false);

    const res = await withTenant(() =>
      findAddresses({ postcode: "EC1A 1BB" }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /type the address instead/i);
  });

  await check("a stored PAF key never comes back out", async () => {
    actAs({ _id: String(ids.superAdmin), role: "platformAdmin", tenantId: String(tenantId) });
    const { getAddressAccounts } = await import("@/server/addressServer/paf");
    const payload = JSON.parse((await getAddressAccounts()).data);
    const serialised = JSON.stringify(payload);

    assert.ok(!serialised.includes("test-key"), "a plaintext key reached the screen");
    assert.ok(
      !/[A-Za-z0-9+/]{16,}={0,2}:[A-Za-z0-9+/]{16,}/.test(serialised),
      "a sealed key reached the screen",
    );
    const ideal = payload.providers.find((p) => p.key === "ideal-postcodes");
    assert.equal(ideal.hints.apiKey, "····-key");
  });

  await check("enabling one licence disables the other", async () => {
    // Two enabled providers would bill us twice for the same question and
    // which one answered would be a coin toss.
    actAs({ _id: String(ids.superAdmin), role: "platformAdmin", tenantId: String(tenantId) });
    const { saveAddressAccount, getAddressAccounts } = await import(
      "@/server/addressServer/paf"
    );
    await saveAddressAccount({
      provider: "ideal-postcodes",
      credentials: { apiKey: "one" },
      isEnabled: true,
    });
    await saveAddressAccount({
      provider: "getaddress-io",
      credentials: { apiKey: "two" },
      isEnabled: true,
    });

    const payload = JSON.parse((await getAddressAccounts()).data);
    const enabled = payload.providers.filter((p) => p.isEnabled);
    assert.equal(enabled.length, 1, "two licences were live at once");
    assert.equal(enabled[0].key, "getaddress-io");
  });

  /* ------------------------------------------------- the dashboard pulse */

  await check("the dashboard counts who is in right now", async () => {
    // The question an attendance system exists to answer, and the one the
    // dashboard could not ask.
    as("superAdmin", "superAdmin");
    const { getAttendancePulse } = await import(
      "@/server/dashboardServer/attendancePulse"
    );
    const ClockRecord = (await import("@/models/clockInModel")).default;
    const OfficeEmployee = (await import("@/models/officeEmployeeModel")).default;
    const { getWorkingDate } = await import("@/lib/clockTime");
    const today = getWorkingDate();

    await withTenant(async () => {
      await ClockRecord.deleteMany({});
      // OfficeEmploye requires a handful of fields this test does not care
      // about. Inserted through the driver rather than the model: the point
      // here is the COUNT, and filling in a joining date and a department to
      // satisfy validation would say nothing about whether the aggregation
      // is right.
      await OfficeEmployee.collection.insertMany(
        Array.from({ length: 4 }, (_, i) => ({
          tenantId,
          name: `Pulse ${i}`,
          email: `pulse-${i}-${Date.now()}@example.com`,
          isActive: true,
          delete: false,
        })),
      );

      const make = (status, over = {}) =>
        ClockRecord.create({
          employeeId: new mongoose.Types.ObjectId(),
          employeeType: "OfficeEmployee",
          date: today,
          locationId: new mongoose.Types.ObjectId(),
          clockIn: "09:00",
          status,
          breaks: [],
          isDeleted: false,
          ...over,
        });

      await make("checked-in");
      await make("checked-in");
      await make("on-break", { breaks: [{ breakIn: "12:00" }] });
      await make("clocked-out", { clockOut: "17:00" });

      const pulse = JSON.parse((await getAttendancePulse()).data);
      assert.equal(pulse.working, 2);
      assert.equal(pulse.onBreak, 1);
      assert.equal(pulse.finished, 1);
      assert.equal(pulse.staff >= 4, true, "active staff were not counted");
    });
  });

  await check("the dashboard breaks today down by place", async () => {
    // The report this codebase could not produce until locations existed:
    // every office record was siteId:null, so two offices were one
    // indistinguishable blur.
    as("superAdmin", "superAdmin");
    const { getAttendancePulse } = await import(
      "@/server/dashboardServer/attendancePulse"
    );
    const ClockRecord = (await import("@/models/clockInModel")).default;
    const ClockLocation = (await import("@/models/clockLocationModel")).default;
    const { getWorkingDate } = await import("@/lib/clockTime");
    const today = getWorkingDate();

    await withTenant(async () => {
      await ClockRecord.deleteMany({});
      const head = await ClockLocation.create({
        name: "Head Office",
        kind: "office",
      });
      const elm = await ClockLocation.create({
        name: "Elm Street",
        kind: "site",
        projectSiteId: new mongoose.Types.ObjectId(),
      });

      const at = (locationId, status, over = {}) =>
        ClockRecord.create({
          employeeId: new mongoose.Types.ObjectId(),
          employeeType: "OfficeEmployee",
          date: today,
          locationId,
          clockIn: "09:00",
          status,
          breaks: [],
          isDeleted: false,
          ...over,
        });

      await at(head._id, "checked-in");
      await at(head._id, "checked-in");
      await at(head._id, "on-break", { breaks: [{ breakIn: "12:00" }] });
      await at(elm._id, "checked-in");
      // Finished for the day — no longer AT anywhere, so not counted.
      await at(elm._id, "clocked-out", { clockOut: "14:00" });

      const pulse = JSON.parse((await getAttendancePulse()).data);
      assert.equal(pulse.locations.length, 2);

      // Busiest first, so a glance lands on the place with most people.
      assert.equal(pulse.locations[0].name, "Head Office");
      assert.equal(pulse.locations[0].working, 2);
      assert.equal(pulse.locations[0].onBreak, 1);
      assert.equal(pulse.locations[0].kind, "office");

      assert.equal(pulse.locations[1].name, "Elm Street");
      assert.equal(pulse.locations[1].kind, "site");
      assert.equal(
        pulse.locations[1].total,
        1,
        "somebody who had gone home was counted as being there",
      );
    });
  });

  await check("NOT-IN-YET IS NEVER NEGATIVE", async () => {
    // A company mid-migration can have more records today than active staff —
    // somebody clocked in and was then deactivated — and "-2 not in yet" is a
    // number nobody can act on.
    as("superAdmin", "superAdmin");
    const { getAttendancePulse } = await import(
      "@/server/dashboardServer/attendancePulse"
    );
    const ClockRecord = (await import("@/models/clockInModel")).default;
    const { getWorkingDate } = await import("@/lib/clockTime");
    const today = getWorkingDate();

    await withTenant(async () => {
      for (let i = 0; i < 20; i++) {
        await ClockRecord.create({
          employeeId: new mongoose.Types.ObjectId(),
          employeeType: "OfficeEmployee",
          date: today,
          locationId: new mongoose.Types.ObjectId(),
          clockIn: "09:00",
          status: "checked-in",
          breaks: [],
          isDeleted: false,
        });
      }

      const pulse = JSON.parse((await getAttendancePulse()).data);
      assert.ok(pulse.notIn >= 0, `notIn was ${pulse.notIn}`);
    });
  });

  await check("an unfinished shift from an earlier day is surfaced", async () => {
    // The nightly job flags these; showing the count is what turns a flag
    // into something somebody acts on.
    as("superAdmin", "superAdmin");
    const { getAttendancePulse } = await import(
      "@/server/dashboardServer/attendancePulse"
    );
    const ClockRecord = (await import("@/models/clockInModel")).default;
    const { getWorkingDate } = await import("@/lib/clockTime");
    const yesterday = new Date(getWorkingDate().getTime() - 86400000);

    await withTenant(async () => {
      await ClockRecord.create({
        employeeId: new mongoose.Types.ObjectId(),
        employeeType: "OfficeEmployee",
        date: yesterday,
        locationId: new mongoose.Types.ObjectId(),
        clockIn: "09:00",
        status: "checked-in",
        breaks: [],
        isDeleted: false,
      });

      const pulse = JSON.parse((await getAttendancePulse()).data);
      assert.ok(pulse.stillOpen >= 1, "the open shift was not counted");
    });
  });

  await check("the pulse is not readable by an employee", async () => {
    as("siteEmployee", "employee");
    const { getAttendancePulse } = await import(
      "@/server/dashboardServer/attendancePulse"
    );
    const res = await withTenant(() => getAttendancePulse());
    assert.equal(res.success, false);
    assert.match(res.message, /not authorized/i);
  });

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s !== "pass");
  for (const [status, name] of results) {
    if (status !== "pass") console.log(`  ${status}  ${name}`);
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
