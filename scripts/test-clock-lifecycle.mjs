/**
 * Clock lifecycle tests: status, worked minutes, overtime, and the nightly job.
 *
 * Covers what Phase 4 added or repointed:
 *
 *   lib/clockStatus.js       — one vocabulary, derived rather than supplied
 *   shiftCloser.workedMinutes/overtimeMinutes — the arithmetic behind pay
 *   closeOpenShiftsForTenant — flagging shifts nobody clocked out of
 *
 * The overtime tests are the ones worth reading. `overtime` was written as a
 * literal 0 on every clock-out, so the field has always existed and never held
 * anything; and a standard day is the employee's own contract divided by the
 * days they work, not a flat eight hours, so that 20-hours-over-3-days case is
 * the one a flat constant gets wrong.
 *
 * Needs a LOCAL database — it writes. The script refuses anything else.
 *
 *   MONGO_DB_URL="mongodb://127.0.0.1:27017/cdchr_clocklife" \
 *   node --import ./scripts/lib/alias-loader.mjs scripts/test-clock-lifecycle.mjs
 */
import assert from "node:assert";
import dotenv from "dotenv";
import mongoose from "mongoose";

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
    console.error(
      "Set MONGO_DB_URL to a LOCAL database — this script writes and drops.",
    );
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const { CLOCK_STATUS, deriveClockStatus, normaliseClockStatus } =
    await import("@/lib/clockStatus");
  const { closeOpenShiftsForTenant, overtimeMinutes, workedMinutes } =
    await import("@/server/clockServer/shiftCloser");
  const { runWithTenant } = await import("@/lib/tenantContext");
  const ClockRecord = (await import("@/models/clockInModel")).default;

  await mongoose.connection.db.collection("clockrecords").deleteMany({});
  await ClockRecord.syncIndexes();

  const tenantId = new mongoose.Types.ObjectId();
  withTenant = (fn) => runWithTenant(String(tenantId), fn);

  /* --------------------------------------------------------- status */

  check("status is derived from the record", () => {
    assert.equal(deriveClockStatus({ clockIn: "09:00" }), CLOCK_STATUS.CHECKED_IN);
    assert.equal(
      deriveClockStatus({ clockIn: "09:00", breaks: [{ breakIn: "12:00" }] }),
      CLOCK_STATUS.ON_BREAK,
    );
    assert.equal(
      deriveClockStatus({
        clockIn: "09:00",
        breaks: [{ breakIn: "12:00", breakOut: "12:30" }],
      }),
      CLOCK_STATUS.CHECKED_IN,
    );
    assert.equal(
      deriveClockStatus({ clockIn: "09:00", clockOut: "17:00" }),
      CLOCK_STATUS.CLOCKED_OUT,
    );
  });

  check("clocked out beats a break left open", () => {
    // A shift that ended is over, whatever the breaks say — and a forgotten
    // break-in is exactly the record that carries an open break to closing.
    assert.equal(
      deriveClockStatus({
        clockIn: "09:00",
        clockOut: "17:00",
        breaks: [{ breakIn: "15:00" }],
      }),
      CLOCK_STATUS.CLOCKED_OUT,
    );
  });

  check("no clock-in has no status", () => {
    // Absent / on leave / bank holiday is a question about the day, answered
    // by the attendance table with information the record does not carry.
    assert.equal(deriveClockStatus({}), null);
    assert.equal(deriveClockStatus(null), null);
  });

  check("all five old vocabularies map onto the three", () => {
    const expected = {
      "checked-out": CLOCK_STATUS.CLOCKED_OUT,
      completed: CLOCK_STATUS.CLOCKED_OUT,
      "clocked-out": CLOCK_STATUS.CLOCKED_OUT,
      "break-in": CLOCK_STATUS.ON_BREAK,
      "on-break": CLOCK_STATUS.ON_BREAK,
      "break-out": CLOCK_STATUS.CHECKED_IN,
      "break-ended": CLOCK_STATUS.CHECKED_IN,
      "checked-in": CLOCK_STATUS.CHECKED_IN,
    };
    for (const [old, want] of Object.entries(expected)) {
      assert.equal(normaliseClockStatus(old), want, `"${old}"`);
    }
    assert.equal(normaliseClockStatus("nonsense"), null);
  });

  /* -------------------------------------------------- worked minutes */

  check("worked minutes subtract every break, not just the first", () => {
    const worked = workedMinutes({
      clockIn: "09:00",
      clockOut: "17:00",
      breaks: [
        { breakIn: "11:00", breakOut: "11:15" },
        { breakIn: "13:00", breakOut: "13:45" },
      ],
    });
    assert.equal(worked, 480 - 15 - 45);
  });

  check("worked minutes handle a night shift", () => {
    assert.equal(
      workedMinutes({ clockIn: "22:00", clockOut: "06:00", breaks: [] }),
      480,
    );
  });

  check("an open break does not subtract anything yet", () => {
    assert.equal(
      workedMinutes({
        clockIn: "09:00",
        clockOut: "17:00",
        breaks: [{ breakIn: "12:00" }],
      }),
      480,
    );
  });

  check("an open shift has no length, not a zero length", () => {
    // Zero would drag an average down; null says "not finished".
    assert.equal(workedMinutes({ clockIn: "09:00", breaks: [] }), null);
  });

  check("breaks longer than the shift never go negative", () => {
    assert.equal(
      workedMinutes({
        clockIn: "09:00",
        clockOut: "10:00",
        breaks: [{ breakIn: "09:00", breakOut: "12:00" }],
      }),
      0,
    );
  });

  /* ------------------------------------------------------- overtime */

  const settings = { fixedWeeklyHours: 40, defaultDaysPerWeek: 5 };
  const fullTime = { weeklyHourType: "fixed" };

  check("a standard day earns no overtime", () => {
    const record = {
      clockIn: "09:00",
      clockOut: "17:30",
      breaks: [{ breakIn: "13:00", breakOut: "13:30" }],
    };
    assert.equal(workedMinutes(record), 480);
    assert.equal(overtimeMinutes(record, fullTime, settings), 0);
  });

  check("two hours over is two hours of overtime", () => {
    const record = { clockIn: "09:00", clockOut: "19:00", breaks: [] };
    assert.equal(overtimeMinutes(record, fullTime, settings), 120);
  });

  check("overtime uses the employee's own contract, not a flat 8 hours", () => {
    // 20 hours over 3 days is a 6h40 day. A flat eight-hour rule says this
    // seven-hour shift is not overtime; their contract says twenty minutes of
    // it is.
    const partTime = {
      weeklyHourType: "custom",
      weeklyHours: 20,
      dayPerWeek: 3,
    };
    const record = { clockIn: "09:00", clockOut: "16:00", breaks: [] };
    assert.equal(workedMinutes(record), 420);
    assert.equal(overtimeMinutes(record, partTime, settings), 420 - 400);
  });

  check("an open shift earns no overtime", () => {
    assert.equal(
      overtimeMinutes({ clockIn: "09:00", breaks: [] }, fullTime, settings),
      0,
    );
  });

  /* ------------------------------------------------- the nightly job */

  const day = (offset) => {
    const d = new Date();
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset),
    );
  };

  const make = (over) =>
    ClockRecord.create({
      employeeId: new mongoose.Types.ObjectId(),
      employeeType: "Employee",
      date: day(-1),
      clockIn: "09:00",
      breaks: [],
      isDeleted: false,
      ...over,
    });

  await check("an unclosed shift from yesterday is flagged", async () => {
    const rec = await make({});
    const res = await closeOpenShiftsForTenant();
    assert.ok(res.flagged >= 1, "nothing was flagged");

    const after = await ClockRecord.findById(rec._id).lean();
    assert.equal(after.needsReview, true);
    assert.ok(after.autoClosedAt, "autoClosedAt not set");
    assert.ok(after.reviewReason, "no reason recorded");
  });

  await check("the clock out is left empty, never guessed", async () => {
    // The whole point: a made-up finish time goes into somebody's pay and
    // nobody checks it. The gap has to stay visible.
    const rec = await make({});
    await closeOpenShiftsForTenant();
    const after = await ClockRecord.findById(rec._id).lean();
    assert.ok(!after.clockOut, `clockOut was invented: ${after.clockOut}`);
  });

  await check("today's still-running shift is left alone", async () => {
    const rec = await make({ date: day(0) });
    await closeOpenShiftsForTenant();
    const after = await ClockRecord.findById(rec._id).lean();
    assert.notEqual(after.needsReview, true, "flagged a shift still running");
  });

  await check("a closed shift is not flagged", async () => {
    const rec = await make({ clockOut: "17:00" });
    await closeOpenShiftsForTenant();
    const after = await ClockRecord.findById(rec._id).lean();
    assert.notEqual(after.needsReview, true);
  });

  await check("a deleted record is not flagged", async () => {
    const rec = await make({ isDeleted: true });
    await closeOpenShiftsForTenant();
    const after = await ClockRecord.findById(rec._id).lean();
    assert.notEqual(after.needsReview, true);
  });

  await check("a clocked-out shift with an open break is flagged", async () => {
    // The shift looks complete, so nobody would go looking — and an unfinished
    // break deducts nothing, so the day quietly over-pays until someone
    // settles it.
    const rec = await make({
      clockOut: "17:00",
      breaks: [{ breakIn: "12:00" }],
    });
    await closeOpenShiftsForTenant();
    const after = await ClockRecord.findById(rec._id).lean();
    assert.equal(after.needsReview, true, "open break was not flagged");
    assert.match(after.reviewReason, /break started at 12:00/i);
  });

  await check("a closed break on a closed shift is not flagged", async () => {
    const rec = await make({
      clockOut: "17:00",
      breaks: [{ breakIn: "12:00", breakOut: "12:30" }],
    });
    await closeOpenShiftsForTenant();
    const after = await ClockRecord.findById(rec._id).lean();
    assert.notEqual(after.needsReview, true);
  });

  await check("both problems at once are reported together", async () => {
    const rec = await make({ breaks: [{ breakIn: "12:00" }] });
    await closeOpenShiftsForTenant();
    const after = await ClockRecord.findById(rec._id).lean();
    assert.match(after.reviewReason, /no clock out/i);
    assert.match(after.reviewReason, /never ended/i);
  });

  await check("an open break is never closed by the job", async () => {
    // Same rule as the clock-out: guessing an end time puts invented minutes
    // into someone's pay.
    const rec = await make({
      clockOut: "17:00",
      breaks: [{ breakIn: "12:00" }],
    });
    await closeOpenShiftsForTenant();
    const after = await ClockRecord.findById(rec._id).lean();
    assert.ok(!after.breaks[0].breakOut, "the job invented a break end");
  });

  await check("an unfinished break deducts nothing, it does not eat the day", () => {
    // What the old clock-out did: set breakOut to the clock-out time, turning
    // a forgotten scan at 12:00 into a five-hour break and costing the
    // employee their whole afternoon.
    const forgotten = {
      clockIn: "09:00",
      clockOut: "17:00",
      breaks: [{ breakIn: "12:00" }],
    };
    assert.equal(workedMinutes(forgotten), 480);

    const asItWas = {
      clockIn: "09:00",
      clockOut: "17:00",
      breaks: [{ breakIn: "12:00", breakOut: "17:00" }],
    };
    assert.equal(workedMinutes(asItWas), 180, "sanity: the old shape lost 5h");
  });

  await check("the job is idempotent", async () => {
    await make({});
    const first = await closeOpenShiftsForTenant();
    const second = await closeOpenShiftsForTenant();
    assert.ok(first.flagged >= 1);
    assert.equal(second.flagged, 0, "a second run re-flagged the same records");
  });

  await check("overtime is written onto shifts that did close", async () => {
    // Needs a real employee row for the contract lookup; without one the
    // company default (40/5) applies, which is what this asserts.
    const rec = await make({ clockOut: "19:00", overtime: 0 });
    const res = await closeOpenShiftsForTenant();
    assert.ok(res.priced >= 1, "nothing was priced");

    const after = await ClockRecord.findById(rec._id).lean();
    assert.equal(after.overtime, 120);
  });

  await check("overtime is not recomputed once set", async () => {
    const rec = await make({ clockOut: "19:00", overtime: 0 });
    await closeOpenShiftsForTenant();
    await ClockRecord.updateOne({ _id: rec._id }, { $set: { overtime: 999 } });
    await closeOpenShiftsForTenant();
    const after = await ClockRecord.findById(rec._id).lean();
    assert.equal(after.overtime, 999, "an admin's figure was overwritten");
  });

  /* ------------------------------------------------- the cutover floor */

  // Migrated history nobody has reviewed. Flagging months of it opens the queue
  // with items nobody can answer, so a company sets a floor and the job leaves
  // everything below it alone. The first production migration left 24 open
  // shifts spread over sixteen months, which is what this guards against.
  const WorkSetting = (await import("@/models/workSettingModel")).default;

  const setCutover = (value) =>
    WorkSetting.findOneAndUpdate(
      {},
      { $set: { clockCutoverDate: value } },
      { upsert: true, new: true },
    );

  await check("a shift before the cutover is not flagged", async () => {
    const rec = await make({ date: day(-30) });
    await setCutover(day(-7));
    const res = await closeOpenShiftsForTenant();

    const after = await ClockRecord.findById(rec._id).lean();
    assert.notEqual(after.needsReview, true, "pre-cutover shift was flagged");
    assert.equal(res.since, day(-7).toISOString().slice(0, 10));

    await setCutover(null);
  });

  await check("a shift after the cutover is still flagged", async () => {
    // The floor must not turn the job off — a real gap since the cutover is
    // exactly what the queue is for.
    const rec = await make({ date: day(-1) });
    await setCutover(day(-7));
    await closeOpenShiftsForTenant();

    const after = await ClockRecord.findById(rec._id).lean();
    assert.equal(after.needsReview, true, "a post-cutover gap was missed");

    await setCutover(null);
  });

  await check("the cutover day itself is included", async () => {
    // An off-by-one here silently drops a day, and it would be the day the
    // company started trusting the data.
    const rec = await make({ date: day(-7) });
    await setCutover(day(-7));
    await closeOpenShiftsForTenant();

    const after = await ClockRecord.findById(rec._id).lean();
    assert.equal(after.needsReview, true, "the cutover day was excluded");

    await setCutover(null);
  });

  await check("overtime is not priced before the cutover either", async () => {
    // Quieter than a flag, and therefore worth being stricter about: it writes
    // a pay figure onto a record from before the system was authoritative, and
    // it lands in a report where nobody is looking for it.
    const rec = await make({ date: day(-30), clockOut: "19:00", overtime: 0 });
    await setCutover(day(-7));
    await closeOpenShiftsForTenant();

    const after = await ClockRecord.findById(rec._id).lean();
    assert.equal(after.overtime, 0, "a pre-cutover shift was priced");

    await setCutover(null);
  });

  await check("no cutover means every shift is checked", async () => {
    // The default, and right for a company with no imported history: there is
    // nothing unreviewed to hide, so a floor would only mask real gaps.
    const rec = await make({ date: day(-400) });
    await setCutover(null);
    const res = await closeOpenShiftsForTenant();

    const after = await ClockRecord.findById(rec._id).lean();
    assert.equal(after.needsReview, true, "old shift skipped with no cutover");
    assert.equal(res.since, null);
  });

  await check("an unreadable cutover is treated as no floor", async () => {
    // Failing open flags more rather than fewer. A bad value that silently
    // switched the job off would be invisible.
    const rec = await make({ date: day(-400) });
    await WorkSetting.collection.updateOne(
      {},
      { $set: { clockCutoverDate: "not a date" } },
      { upsert: true },
    );
    await closeOpenShiftsForTenant();

    const after = await ClockRecord.findById(rec._id).lean();
    assert.equal(after.needsReview, true, "a bad cutover switched the job off");

    await WorkSetting.collection.updateOne(
      {},
      { $set: { clockCutoverDate: null } },
    );
  });

  /* ------------------------------------------------- the anomaly report */

  await check("the report surfaces what the job flagged", async () => {
    // Every phase produced a signal and left it in the database. This is the
    // one screen that asks "is anything wrong", so it has to actually find
    // them.
    const { actAs } = await import("./lib/session-stub.mjs");
    const { getClockAnomalies } = await import(
      "@/server/clockServer/anomalyReport"
    );
    actAs({
      _id: String(new mongoose.Types.ObjectId()),
      role: "superAdmin",
      tenantId: String(tenantId),
    });

    const res = await getClockAnomalies();
    assert.equal(res.success, true, res.message);
    const report = JSON.parse(res.data);

    // The nightly job flagged several records earlier in this suite.
    assert.ok(
      report.needsReview.length > 0,
      "nothing flagged reached the report",
    );
    const reasons = report.needsReview.map((r) => r.reason).join(" ");
    assert.match(reasons, /no clock out|never ended/i);
  });

  await check("an ordinary employee cannot read it", async () => {
    const { actAs } = await import("./lib/session-stub.mjs");
    const { getClockAnomalies } = await import(
      "@/server/clockServer/anomalyReport"
    );
    actAs({
      _id: String(new mongoose.Types.ObjectId()),
      role: "siteEmployee",
      tenantId: String(tenantId),
    });
    assert.equal((await getClockAnomalies()).success, false);
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
