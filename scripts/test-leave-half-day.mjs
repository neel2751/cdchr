/**
 * Booking half days.
 *
 * The setup screen said any leave could be booked as a half day, and none
 * could: the forms only offered morning or afternoon for a leave type called
 * "Half Day", which the setup no longer creates; the employee's half-day branch
 * read three variables it never defined and failed every time; and the engine
 * charged annual leave whatever had been booked.
 *
 * These drive the real actions — storeEmployeeLeaveData (an employee's own
 * request, and editing one) and adminEmployeeLeaveRequest (an admin recording
 * leave for somebody) — against a company set up through the real setup flow.
 *
 * Needs a LOCAL database — it writes.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_dev?replicaSet=rs0" \
 *   npm run leave:test:half-day
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["pass", name]);
  } catch (e) {
    results.push(["FAIL", `${name} — ${e.message}`]);
  }
}

const uniq = () => Math.random().toString(36).slice(2, 8);

async function main() {
  const uri = process.env.MONGO_DB_URL;
  if (!uri || !/127\.0\.0\.1|localhost/.test(uri)) {
    console.error("Set MONGO_DB_URL to a LOCAL database. This script writes.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const { actAs } = await import("@/scripts/lib/session-stub");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const Company = (await import("@/models/companyModel")).default;
  const RoleType = (await import("@/models/roleTypeModel")).default;
  const OfficeEmploye = (await import("@/models/officeEmployeeModel")).default;
  const LeaveCategory = (await import("@/models/leaveCategoryModel")).default;
  const LeaveSetting = (await import("@/models/leaveSettingModel")).default;
  const CommonLeave = (await import("@/models/commonLeaveModel")).default;
  const LeaveRequest = (await import("@/models/leaveRequestModel")).default;
  const { completeLeaveSetup } = await import("@/server/leaveServer/leaveSetupServer");
  const { storeEmployeeLeaveData } = await import("@/server/leaveServer/leaveRequestServer");
  const { adminEmployeeLeaveRequest } = await import(
    "@/server/leaveServer/leaveEmployeeServer"
  );
  const { currentLeaveYear } = await import("@/lib/leaveYear");
  const { readDayLength, daysCharged } = await import("@/lib/leaveDayLength");

  // One company, set up through the real flow, with the founder as the
  // employee whose leave is booked. April leave year; these dates are all
  // weekdays inside the one that is current on 2026-11-03.
  const company = await Company.create({ name: `Half Day Test ${uniq()}` });
  const tenantId = String(company._id);
  const department = await runWithTenant(tenantId, () =>
    RoleType.create({ roleTitle: `HD ${uniq()}`, isActive: true, delete: false }),
  );
  const email = `founder.${uniq()}@half-day-test.invalid`;
  const founder = await runWithTenant(tenantId, () =>
    OfficeEmploye.create({
      name: "Founder",
      email,
      phoneNumber: Number(`77${Math.floor(Math.random() * 100000000)}`),
      password: "$2a$10$notarealhashnotarealhashno",
      roleType: "Manager",
      department: department._id,
      company: company._id,
      employeType: "Full-Time",
      immigrationType: "British",
      joinDate: new Date(2020, 0, 1),
      dayPerWeek: 5,
      isActive: true,
      isSuperAdmin: true,
      delete: false,
    }),
  );
  const employeeId = String(founder._id);
  const superAdmin = { _id: employeeId, name: "Founder", email, role: "superAdmin", tenantId };
  const plainUser = { ...superAdmin, role: "user" };

  const as = (user, fn) =>
    runWithTenant(tenantId, async () => {
      actAs(user);
      try {
        return await fn();
      } finally {
        actAs(null);
      }
    });

  const setup = await as(superAdmin, () =>
    completeLeaveSetup({ leaveYearStartMonth: 4, leaveTypeKeys: ["bereavement"] }),
  );
  assert.ok(setup.success, setup.message);
  const leaveYear = await runWithTenant(tenantId, () => currentLeaveYear());

  const balance = (leaveType) =>
    runWithTenant(tenantId, async () => {
      const doc = await CommonLeave.findOne({ employeeId, leaveYear }).lean();
      return doc.leaveData.find((row) => row.leaveType === leaveType);
    });
  const requestsOn = (date) =>
    runWithTenant(tenantId, () =>
      LeaveRequest.find({
        employeeId,
        leaveDates: date,
        leaveStatus: { $in: ["Pending", "Approved"] },
        isDeleted: false,
      }).lean(),
    );
  const day = (n) => new Date(2026, 11, n); // December 2026

  /* --- the rule itself --------------------------------------------------- */

  await check("readDayLength: full days unless a half is chosen", async () => {
    assert.deepEqual(readDayLength({ leaveType: "Annual Leave" }), {
      ok: true,
      leaveType: "Annual Leave",
      isHalfDay: false,
      halfDayType: null,
    });
    assert.deepEqual(readDayLength({ leaveType: "Sick Leave", dayLength: "Second Half" }), {
      ok: true,
      leaveType: "Sick Leave",
      isHalfDay: true,
      halfDayType: "Second Half",
    });
    // "Full day" in the form wins over the request it is editing.
    assert.equal(
      readDayLength({ leaveType: "Annual Leave", dayLength: "full", isHalfDay: true }).isHalfDay,
      false,
    );
    // A half day must say which half.
    assert.equal(readDayLength({ leaveType: "Annual Leave", isHalfDay: true }).ok, false);
    assert.equal(daysCharged(3, "First Half"), 1.5);
    assert.equal(daysCharged(3, "full"), 3);
  });

  await check("readDayLength: the old \"Half Day\" type still means half a day of annual leave", async () => {
    assert.deepEqual(readDayLength({ leaveType: "Half Day", halfDayType: "First Half" }), {
      ok: true,
      leaveType: "Annual Leave",
      isHalfDay: true,
      halfDayType: "First Half",
    });
  });

  /* --- an employee's own request ----------------------------------------- */

  await check("an employee can book a morning off, and half a day comes off annual leave", async () => {
    const before = await balance("Annual Leave");
    const res = await as(superAdmin, () =>
      storeEmployeeLeaveData({
        leaveType: "Annual Leave",
        dayLength: "First Half",
        leaveDates: [day(1)],
        leaveReason: "Dentist",
      }),
    );
    assert.equal(res.success, true, res.message);

    const after = await balance("Annual Leave");
    assert.equal(after.remaining, before.remaining - 0.5);
    assert.equal(after.used, before.used + 0.5);

    const [request] = await requestsOn(day(1));
    assert.equal(request.isHalfDay, true);
    assert.equal(request.halfDayType, "First Half");
    assert.equal(request.leaveDays, 0.5);
    assert.equal(request.leaveType, "Annual Leave");
    assert.equal(request.leaveStatus, "Pending");
  });

  await check("the afternoon of the same day can be booked too", async () => {
    const res = await as(superAdmin, () =>
      storeEmployeeLeaveData({
        leaveType: "Annual Leave",
        dayLength: "Second Half",
        leaveDates: [day(1)],
      }),
    );
    assert.equal(res.success, true, res.message);
    assert.equal((await requestsOn(day(1))).length, 2);
  });

  await check("the same half twice, or a full day over a half, is refused", async () => {
    const before = await balance("Annual Leave");
    const again = await as(superAdmin, () =>
      storeEmployeeLeaveData({
        leaveType: "Annual Leave",
        dayLength: "First Half",
        leaveDates: [day(1)],
      }),
    );
    assert.equal(again.success, false);
    const full = await as(superAdmin, () =>
      storeEmployeeLeaveData({ leaveType: "Annual Leave", dayLength: "full", leaveDates: [day(1)] }),
    );
    assert.equal(full.success, false);
    assert.deepEqual(await balance("Annual Leave"), before);
  });

  await check("a half day of another type comes off that type, not annual leave", async () => {
    const annualBefore = await balance("Annual Leave");
    const bereavementBefore = await balance("Bereavement Leave");
    const res = await as(superAdmin, () =>
      storeEmployeeLeaveData({
        leaveType: "Bereavement Leave",
        dayLength: "Second Half",
        leaveDates: [day(2)],
      }),
    );
    assert.equal(res.success, true, res.message);
    assert.equal((await balance("Bereavement Leave")).remaining, bereavementBefore.remaining - 0.5);
    assert.deepEqual(await balance("Annual Leave"), annualBefore);
    const [request] = await requestsOn(day(2));
    assert.equal(request.leaveType, "Bereavement Leave");
  });

  await check("a half day without morning or afternoon is refused, and nothing changes", async () => {
    const before = await balance("Annual Leave");
    const res = await as(superAdmin, () =>
      storeEmployeeLeaveData({ leaveType: "Annual Leave", isHalfDay: true, leaveDates: [day(3)] }),
    );
    assert.equal(res.success, false);
    assert.match(res.message, /morning or afternoon/);
    assert.deepEqual(await balance("Annual Leave"), before);
    assert.equal((await requestsOn(day(3))).length, 0);
  });

  /* --- an admin recording leave for somebody ------------------------------ */

  await check("an admin can record a half day, approved as it is entered", async () => {
    const res = await as(superAdmin, () =>
      adminEmployeeLeaveRequest({
        employeeId,
        leaveType: "Annual Leave",
        dayLength: "Second Half",
        leaveDates: [day(4)],
        leaveSubmitDate: new Date(2026, 10, 1),
      }),
    );
    assert.equal(res.success, true, res.message);
    const [request] = await requestsOn(day(4));
    assert.equal(request.isHalfDay, true);
    assert.equal(request.leaveStatus, "Approved");
    assert.equal(request.addByAdmin, true);
  });

  await check("the old \"Half Day\" leave type still books half a day of annual leave", async () => {
    const before = await balance("Annual Leave");
    const res = await as(superAdmin, () =>
      adminEmployeeLeaveRequest({
        employeeId,
        leaveType: "Half Day",
        halfDayType: "First Half",
        leaveDates: [day(4)],
      }),
    );
    assert.equal(res.success, true, res.message);
    assert.equal((await balance("Annual Leave")).remaining, before.remaining - 0.5);
  });

  await check("only the people who run leave can record it for somebody else", async () => {
    const before = await balance("Annual Leave");
    const res = await as(plainUser, () =>
      adminEmployeeLeaveRequest({
        employeeId,
        leaveType: "Annual Leave",
        dayLength: "full",
        leaveDates: [day(7)],
      }),
    );
    assert.equal(res.success, false);
    assert.deepEqual(await balance("Annual Leave"), before);
    assert.equal((await requestsOn(day(7))).length, 0);
  });

  /* --- editing ----------------------------------------------------------- */

  await check("a full day edited into a morning gives half a day back", async () => {
    const booked = await as(superAdmin, () =>
      storeEmployeeLeaveData({ leaveType: "Annual Leave", dayLength: "full", leaveDates: [day(8)] }),
    );
    assert.equal(booked.success, true, booked.message);
    const before = await balance("Annual Leave");
    const [original] = await requestsOn(day(8));

    const res = await as(superAdmin, () =>
      storeEmployeeLeaveData(
        { leaveType: "Annual Leave", dayLength: "First Half", leaveDates: [day(8)] },
        String(original._id),
      ),
    );
    assert.equal(res.success, true, res.message);
    assert.equal((await balance("Annual Leave")).remaining, before.remaining + 0.5);
    const [now] = await requestsOn(day(8));
    assert.equal(now.isHalfDay, true);
    assert.equal(now.leaveDays, 0.5);
  });

  await check("an edit that cannot be booked leaves the original as it was", async () => {
    const booked = await as(superAdmin, () =>
      storeEmployeeLeaveData({ leaveType: "Annual Leave", dayLength: "full", leaveDates: [day(9)] }),
    );
    assert.equal(booked.success, true, booked.message);
    const [original] = await requestsOn(day(9));
    const before = await balance("Annual Leave");

    // Bereavement leave removed from this employee: the new booking is refused
    // after the old one has been cancelled inside the edit.
    await runWithTenant(tenantId, () =>
      CommonLeave.updateOne(
        { employeeId, leaveYear, "leaveData.leaveType": "Bereavement Leave" },
        { $set: { "leaveData.$.isDelete": true } },
      ),
    );
    const res = await as(superAdmin, () =>
      storeEmployeeLeaveData(
        { leaveType: "Bereavement Leave", dayLength: "First Half", leaveDates: [day(9)] },
        String(original._id),
      ),
    );
    assert.equal(res.success, false);

    const [still] = await requestsOn(day(9));
    assert(still, "the original request was cancelled");
    assert.equal(String(still._id), String(original._id));
    assert.deepEqual(await balance("Annual Leave"), before);
  });

  /* ---------------------------------------------------------------------- */

  const oid = company._id;
  for (const Model of [OfficeEmploye, LeaveCategory, LeaveSetting, CommonLeave, LeaveRequest, RoleType]) {
    await Model.collection.deleteMany({ tenantId: oid });
  }
  await Company.collection.deleteMany({ _id: oid });
  await mongoose.disconnect();

  const failed = results.filter(([s]) => s === "FAIL");
  for (const [status, name] of results) console.log(`${status === "pass" ? "ok  " : "FAIL"} ${name}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
