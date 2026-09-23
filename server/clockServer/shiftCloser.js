/**
 * Closing off shifts nobody clocked out of, and working out overtime.
 *
 * Two things were missing. Nothing ever closed an open shift, so someone who
 * forgot to clock out left a record with a clock-in and no clock-out — which
 * reads as "still at work" for ever, and contributes nothing to their hours
 * because a span needs both ends. And `overtime` was written as a literal 0 on
 * every clock-out, so the field existed but never held anything.
 *
 * WHAT THIS DOES NOT DO is invent a clock-out time. A guessed finish goes
 * straight into somebody's pay, and a plausible guess is worse than an obvious
 * gap because nobody checks it. Instead the shift is *flagged*: `needsReview`
 * is set, `autoClosedAt` records when the job noticed, and the record keeps its
 * empty clockOut so the admin screen still shows the hole for a human to fill.
 *
 * Context-free — no next/headers, no next-auth — so it runs from the cron API
 * route. Each company is handled inside its own runWithTenant() scope.
 *
 * Idempotent: a record that has already been flagged is skipped, so a second
 * run in the same day is a no-op and a run that dies half way is simply
 * finished by the next one.
 */

import { connect } from "@/db/db";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { diffMinutes, getWorkingDate } from "@/lib/clockTime";
import { resolveClockRules } from "@/lib/clockRules";
import { effectiveDaysPerWeek, effectiveWeeklyHours } from "@/lib/workHours";
import ClockRecordModel from "@/models/clockInModel";
import CompanyModel from "@/models/companyModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import WorkSettingModel from "@/models/workSettingModel";

/**
 * Minutes actually worked: the shift, less every break in it.
 *
 * Returns null while the shift is still open — an unfinished shift has no
 * length yet, and treating it as zero would quietly drag averages down.
 */
export function workedMinutes(record) {
  const span = diffMinutes(record?.clockIn, record?.clockOut);
  if (span === null) return null;

  const breaks = Array.isArray(record?.breaks) ? record.breaks : [];
  const breakTotal = breaks.reduce((total, br) => {
    const length = diffMinutes(br?.breakIn, br?.breakOut);
    return total + (length === null ? 0 : length);
  }, 0);

  return Math.max(0, span - breakTotal);
}

/**
 * Minutes beyond a standard day for this employee.
 *
 * The standard day is their contracted week divided by the days they work —
 * the same figure lib/workHours.js values a day of paid leave at, so overtime
 * and leave cannot disagree about what a day is worth. Someone on 20 hours
 * over 3 days is over their day at 6h40, not at 8h.
 */
export function overtimeMinutes(record, employee, settings) {
  const worked = workedMinutes(record);
  if (worked === null) return 0;

  const weeklyHours = effectiveWeeklyHours(employee, settings);
  const daysPerWeek = effectiveDaysPerWeek(employee, settings);
  if (!daysPerWeek) return 0;

  const standardDay = Math.round((weeklyHours / daysPerWeek) * 60);
  return Math.max(0, worked - standardDay);
}

/** Look up whichever collection holds this employee, for their contract. */
async function loadEmployees(records) {
  const ids = [...new Set(records.map((r) => String(r.employeeId)))];
  const [site, office] = await Promise.all([
    EmployeModel.find({ _id: { $in: ids } })
      .select("weeklyHourType weeklyHours dayPerWeek")
      .lean(),
    OfficeEmployeeModel.find({ _id: { $in: ids } })
      .select("weeklyHourType weeklyHours dayPerWeek")
      .lean(),
  ]);

  const byId = new Map();
  for (const e of [...site, ...office]) byId.set(String(e._id), e);
  return byId;
}

/**
 * One company's pass.
 *
 * `before` is the working day to stop at — everything strictly earlier than it
 * is fair game. Defaults to today, so a shift still running right now is never
 * touched.
 */
export async function closeOpenShiftsForTenant({ before } = {}) {
  const cutoff = before || getWorkingDate();

  // The floor. Everything before the company's cutover is left alone: it is
  // migrated history nobody has reviewed, and flagging months of it opens the
  // queue with items nobody can answer. models/workSettingModel.js has the
  // reasoning. Read first, because both passes below are bounded by it.
  const settings = await WorkSettingModel.findOne().lean();
  const rules = resolveClockRules(settings);
  const since = rules.clockCutoverDate;

  // `$lt` cutoff and `$gte` since — a window, not a start. Built once so the
  // two passes cannot drift apart and start disagreeing about which days count.
  const window = since ? { $gte: since, $lt: cutoff } : { $lt: cutoff };

  const needsAttention = await
    ClockRecordModel.find({
      date: window,
      isDeleted: false,
      clockIn: { $type: "string", $ne: "" },
      // Already dealt with by an earlier run.
      needsReview: { $ne: true },
      $or: [
        // Never clocked out.
        { clockOut: null },
        { clockOut: { $exists: false } },
        // Clocked out, but with a break still open. Worth flagging separately:
        // the shift looks complete, so nobody would go looking — and an
        // unfinished break deducts nothing, so the day quietly over-pays until
        // someone settles it.
        { breaks: { $elemMatch: { breakIn: { $ne: null }, breakOut: null } } },
      ],
    })
    .select("_id employeeId date clockIn clockOut breaks")
    .lean();

  // Records that DID close, on the same days, still need their overtime — the
  // field was written as a hard 0 by every clock-out until now.
  //
  // Bounded by the same window. Pricing a shift from before the cutover would
  // write a pay figure onto a record from before this system was authoritative,
  // which is the same retroactive change as flagging one — quieter, because it
  // lands in a report instead of a queue, and therefore worth being stricter
  // about rather than looser.
  const closed = await ClockRecordModel.find({
    date: window,
    isDeleted: false,
    clockIn: { $type: "string", $ne: "" },
    clockOut: { $type: "string", $ne: "" },
    overtime: { $in: [0, null] },
  })
    .select("_id employeeId clockIn clockOut breaks")
    .lean();

  const employees = await loadEmployees([...needsAttention, ...closed]);

  let flagged = 0;
  for (const record of needsAttention) {
    const openBreak = (record.breaks || []).find(
      (b) => b?.breakIn && !b?.breakOut,
    );
    // Both can be true at once, and the message should say so — "no clock out"
    // alone would send someone looking for one problem and leave the other.
    const reasons = [];
    if (!record.clockOut) reasons.push("No clock out was recorded.");
    if (openBreak) {
      reasons.push(`A break started at ${openBreak.breakIn} was never ended.`);
    }
    if (!reasons.length) continue;

    await ClockRecordModel.updateOne(
      // Guarded on the state that was read: a record someone fixed between the
      // read and here should not be flagged for a problem it no longer has.
      { _id: record._id, needsReview: { $ne: true } },
      {
        $set: {
          needsReview: true,
          reviewReason: reasons.join(" "),
          autoClosedAt: new Date(),
        },
      },
    );
    flagged++;
  }

  let priced = 0;
  for (const record of closed) {
    const employee = employees.get(String(record.employeeId));
    const minutes = overtimeMinutes(record, employee, settings);
    if (!minutes) continue;
    // Guard on the value we read, so a shift edited between the read and here
    // is left for the next run rather than overwritten with a stale figure.
    const res = await ClockRecordModel.updateOne(
      { _id: record._id, overtime: { $in: [0, null] } },
      { $set: { overtime: minutes } },
    );
    priced += res.modifiedCount;
  }

  // `since` is reported so the cron log says which days were in scope. A run
  // that flags nothing because the floor excluded everything should be
  // distinguishable from one that found nothing wrong.
  return {
    flagged,
    priced,
    maxShiftHours: rules.maxShiftHours,
    since: since ? since.toISOString().slice(0, 10) : null,
  };
}

/** Every company, each in its own scope. */
export async function runShiftCloseJob() {
  await connect();
  const results = { tenants: 0, flagged: 0, priced: 0 };

  const tenants = await escapeTenant("shift-close cron: iterate companies", () =>
    CompanyModel.find({ delete: { $ne: true }, isActive: { $ne: false } })
      .select("_id")
      .lean(),
  );

  for (const tenant of tenants) {
    try {
      const one = await runWithTenant(String(tenant._id), () =>
        closeOpenShiftsForTenant(),
      );
      results.tenants++;
      results.flagged += one.flagged;
      results.priced += one.priced;
    } catch (error) {
      // One company's bad data must not stop the rest.
      console.error(
        `[shift-close] tenant ${tenant._id} failed:`,
        error?.message,
      );
    }
  }

  return results;
}
