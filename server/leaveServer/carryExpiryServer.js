"use server";

/**
 * Taking away carried-over days once they expire.
 *
 * `expireAfterMonths` has been a required field on the leave settings form since
 * carry-forward shipped, and until now nothing read it: a company could set
 * "carried days expire after three months" and those days stayed spendable for
 * the whole leave year.
 *
 * TWO HALVES, DELIBERATELY.
 *
 *   The booking path refuses an expired day the moment it expires — see
 *   carriedState() in lib/carryForward.js, used by storeEmployeeLeaveData. That
 *   is the half that has to be right, because a day must become unbookable on
 *   its expiry date and not on whenever a job next happens to run.
 *
 *   This file is the other half: it writes the lapse down. Without it the stored
 *   `total` and `remaining` keep claiming days nobody can take, which is what an
 *   employee sees on their own leave card and what every report adds up. So the
 *   numbers are brought into line, with a leave-history entry explaining the
 *   drop — an allowance falling by ten days overnight is not something to leave
 *   unexplained.
 *
 * IDEMPOTENT. The lapse reduces `carryForwarded` to the number of carried days
 * that were actually taken, so a second pass finds nothing left to expire. Safe
 * to run hourly, nightly, or twice by accident.
 */

import { connect } from "@/db/db";
import { logAuditDirect } from "@/lib/audit";
import {
  applyCarryForwardLapse,
  carriedState,
  resolveCarryForward,
} from "@/lib/carryForward";
import { boundsForLeaveYear } from "@/lib/leaveEntitlement";
import { getPreviousLeaveYearString } from "@/helper/getLeaveYearString";
import { getLeaveSettings } from "@/server/leaveSettingServer";
import { currentLeaveYear } from "@/lib/leaveYear";
import { createObjectId } from "@/lib/mongodb";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { requireEntitlementAccess } from "@/lib/employeeAccess";
import CommonLeaveModel from "@/models/commonLeaveModel";
import CompanyModel from "@/models/companyModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";

/**
 * Expire whatever has expired, for the tenant in context.
 *
 * Scoped to one leave year because that is the only one with live carry-over in
 * it: an expiry is measured from the start of the year the days were carried
 * into, so a closed year's carried days expired long ago and were either taken
 * or already lapsed.
 *
 * @param {{ leaveYear?: string, on?: Date, actor?: object }} [options]
 * @returns {Promise<{employees: number, lapsedDays: number, rows: object[]}>}
 */
async function expireForCurrentTenant({ leaveYear, on = new Date(), actor } = {}) {
  await connect();

  const year = leaveYear || (await currentLeaveYear());

  // Only rows that carried something and have an expiry on them. Everything
  // else cannot lapse, so there is no reason to read it.
  const documents = await CommonLeaveModel.find({
    leaveYear: year,
    leaveData: {
      $elemMatch: {
        carryForwarded: { $gt: 0 },
        carryForwardExpiresAt: { $ne: null, $lte: on },
      },
    },
  });

  const rows = [];
  let lapsedDays = 0;

  for (const document of documents) {
    const changes = [];

    for (const entitlement of document.leaveData) {
      const lapse = applyCarryForwardLapse(entitlement, on);
      if (!lapse) continue;

      const before = {
        total: entitlement.total,
        remaining: entitlement.remaining,
      };

      entitlement.total = lapse.total;
      entitlement.remaining = lapse.remaining;
      entitlement.carryForwarded = lapse.carryForwarded;
      entitlement.carryForwardLapsed =
        (Number(entitlement.carryForwardLapsed) || 0) + lapse.lapsed;
      entitlement.carryForwardLapsedAt = on;

      changes.push({
        leaveType: entitlement.leaveType,
        lapsed: lapse.lapsed,
        ...before,
        newTotal: lapse.total,
        newRemaining: lapse.remaining,
        expiredOn: carriedState(entitlement, on).expiresAt,
      });
    }

    if (!changes.length) continue;

    for (const change of changes) {
      // Written as a history entry so the drop is explained where somebody will
      // look for it, in the same list as every other change to the allowance.
      document.leaveHistory.push({
        updateAt: on,
        updatedBy: "System",
        updatedByName: "System",
        role: "system",
        leaveType: change.leaveType,
        used: 0,
        oldTotal: change.total,
        newTotal: change.newTotal,
        oldRemaining: change.remaining,
        newRemaining: change.newRemaining,
        carryForwardLapsed: change.lapsed,
        reason:
          `${change.lapsed} carried-over day(s) expired` +
          (change.expiredOn
            ? ` on ${change.expiredOn.toISOString().slice(0, 10)}`
            : "") +
          " and were removed from the balance.",
      });
      lapsedDays += change.lapsed;
    }

    // `leaveData` is a plain Array on the schema, so Mongoose cannot see that
    // elements inside it changed.
    document.markModified("leaveData");
    document.markModified("leaveHistory");
    await document.save();

    rows.push({ employeeId: String(document.employeeId), changes });
  }

  if (rows.length) {
    // One entry for the run, not one per employee: the per-employee detail is
    // on each leave record, and an audit log with four hundred rows a night is
    // an audit log nobody reads.
    await logAuditDirect({
      actor: actor || { system: true },
      action: "Leave.carryForwardExpired",
      module: "Leave",
      description:
        `${lapsedDays} carried-over leave day(s) expired for ${rows.length} ` +
        `employee(s) in ${year}`,
      metadata: { leaveYear: year, employees: rows.length, lapsedDays },
    });
  }

  return { employees: rows.length, lapsedDays, rows };
}

/**
 * Run the expiry for the signed-in admin's own company.
 *
 * Exposed so the leave screens can bring the figures into line on demand rather
 * than waiting for the nightly job — useful straight after changing an expiry
 * rule, when the stored balances are knowingly stale.
 */
export async function expireCarryForwardNow({ leaveYear } = {}) {
  const refusal = await requireEntitlementAccess();
  if (refusal) return refusal;

  try {
    const result = await expireForCurrentTenant({ leaveYear });
    return {
      success: true,
      message: result.lapsedDays
        ? `${result.lapsedDays} expired carried-over day(s) removed from ` +
          `${result.employees} employee(s).`
        : "Nothing has expired.",
      data: JSON.stringify({
        employees: result.employees,
        lapsedDays: result.lapsedDays,
      }),
    };
  } catch (error) {
    console.log("expireCarryForwardNow failed:", error);
    return { success: false, message: "Could not expire carried-over days" };
  }
}

/**
 * What would lapse, without writing anything.
 *
 * The honest thing to show next to a button that takes days off people.
 */
export async function previewCarryForwardExpiry({ leaveYear } = {}) {
  const refusal = await requireEntitlementAccess();
  if (refusal) return refusal;

  try {
    await connect();
    const year = leaveYear || (await currentLeaveYear());
    const on = new Date();

    const documents = await CommonLeaveModel.find({
      leaveYear: year,
      leaveData: { $elemMatch: { carryForwarded: { $gt: 0 } } },
    }).lean();

    const employees = await OfficeEmployeeModel.find({
      _id: { $in: documents.map((d) => d.employeeId) },
    })
      .select("name")
      .lean();
    const nameOf = new Map(employees.map((e) => [String(e._id), e.name]));

    const rows = [];
    for (const document of documents) {
      for (const entitlement of document.leaveData) {
        const state = carriedState(entitlement, on);
        if (state.carried <= 0) continue;
        rows.push({
          employeeId: String(document.employeeId),
          employeeName: nameOf.get(String(document.employeeId)) || "Unknown",
          leaveType: entitlement.leaveType,
          carried: state.carried,
          carriedUsed: state.carriedUsed,
          carriedRemaining: state.carriedRemaining,
          expiresAt: state.expiresAt,
          hasExpired: state.hasExpired,
          // What this run would take away right now.
          willLapse: state.lapsed,
        });
      }
    }

    return {
      success: true,
      data: JSON.stringify({
        leaveYear: year,
        rows,
        totals: {
          employees: new Set(rows.map((r) => r.employeeId)).size,
          willLapse: rows.reduce((sum, r) => sum + r.willLapse, 0),
          stillValid: rows.reduce(
            (sum, r) => sum + (r.hasExpired ? 0 : r.carriedRemaining),
            0
          ),
        },
      }),
    };
  } catch (error) {
    console.log("previewCarryForwardExpiry failed:", error);
    return { success: false, message: "Could not work out what has expired" };
  }
}

/**
 * Recompute one employee's carry-forward on an entitlement that already exists.
 *
 * THE GAP THIS FILLS. Carry-forward is worked out once, when the leave year is
 * generated — so changing who qualifies in October does not touch days granted
 * back in April, and the per-employee scan button skips anybody who already has
 * a record. Without this, narrowing a rule or setting somebody to "never carry"
 * would be a setting with no effect on the people it was aimed at until the next
 * leave year.
 *
 * WHAT IT WILL NOT DO: take back days already taken. If somebody carried ten
 * days, spent four, and is then ruled ineligible, the four are gone — they were
 * booked, approved and possibly worked around. The carried figure floors at what
 * was spent, exactly as an expiry does, and `total - used === remaining` holds
 * afterwards either way.
 *
 * @param {{ employeeId: string, leaveYear?: string }} input
 */
/**
 * Recompute one employee's carry-forward, given everything already in hand.
 *
 * Split out from the action so the bulk version does not re-read the company's
 * settings and leave year once per employee — twenty exceptions set at once
 * would otherwise be twenty identical settings reads and twenty leave-year
 * derivations.
 *
 * @returns {Promise<{changes: object[], message: string}|null>} null when the
 *   employee has no entitlement document for the year.
 */
async function recomputeOne({ employee, year, settings, yearStart }) {
  const rules = settings?.data?.carryForwardRules || [];
  const enabled = Boolean(settings?.data?.carryForwardEnabled);
  const startMonth = settings?.data?.leaveYearStartMonth;

  const document = await CommonLeaveModel.findOne({
    employeeId: employee._id,
    leaveYear: year,
  });
  if (!document) return null;

  const previousYear = getPreviousLeaveYearString(year, startMonth);
  const previous = await CommonLeaveModel.findOne({
    employeeId: employee._id,
    leaveYear: previousYear,
  }).lean();

  const changes = [];

  for (const entitlement of document.leaveData) {
    const carriedNow = Math.max(Number(entitlement.carryForwarded) || 0, 0);
    const previousRow = previous?.leaveData?.find(
      (row) => row.leaveType === entitlement.leaveType
    );

    // What the rules say today, for this employee.
    const base =
      entitlement.baseTotal ?? Number(entitlement.total || 0) - carriedNow;
    const outcome = resolveCarryForward({
      enabled,
      rule: rules.find((r) => r.leaveType === entitlement.leaveType),
      previousRemaining: previousRow?.remaining,
      baseTotal: base,
      leaveType: entitlement.leaveType,
      unit: entitlement.type === "weeks" ? "weeks" : "days",
      employee,
      leaveYearStart: yearStart,
    });

    // Never below what has already been spent out of the carried bucket.
    const used = Math.max(Number(entitlement.used) || 0, 0);
    const spentFromCarry = Math.min(used, carriedNow);
    const target = Math.max(outcome.days, spentFromCarry);
    if (target === carriedNow) continue;

    const before = { total: entitlement.total, remaining: entitlement.remaining };

    entitlement.carryForwarded = target;
    entitlement.baseTotal = base;
    entitlement.total = base + target;
    entitlement.remaining = Math.max(entitlement.total - used, 0);
    entitlement.carryForwardVia = outcome.via || "policy";

    changes.push({
      leaveType: entitlement.leaveType,
      from: carriedNow,
      to: target,
      before,
      after: { total: entitlement.total, remaining: entitlement.remaining },
      explanation: outcome.explanation,
      floored: target > outcome.days,
    });
  }

  if (!changes.length) return { changes: [], message: "already up to date" };

  for (const change of changes) {
    document.leaveHistory.push({
      updateAt: new Date(),
      updatedBy: "System",
      updatedByName: "System",
      role: "system",
      leaveType: change.leaveType,
      used: 0,
      oldTotal: change.before.total,
      newTotal: change.after.total,
      oldRemaining: change.before.remaining,
      newRemaining: change.after.remaining,
      reason:
        `Carry-forward recalculated: ${change.from} → ${change.to} day(s). ` +
        change.explanation +
        (change.floored
          ? " Held at the number already taken, which cannot be undone."
          : ""),
    });
  }

  document.markModified("leaveData");
  document.markModified("leaveHistory");
  await document.save();

  return {
    changes,
    message: changes
      .map((c) => `${c.leaveType}: ${c.from} → ${c.to} carried`)
      .join("; "),
  };
}

/**
 * Recompute one employee's carry-forward on an entitlement that already exists.
 *
 * THE GAP THIS FILLS. Carry-forward is worked out once, when the leave year is
 * generated — so changing who qualifies in October does not touch days granted
 * back in April, and the per-employee scan button skips anybody who already has
 * a record. Without this, narrowing a rule or setting somebody to "never carry"
 * would be a setting with no effect on the people it was aimed at until the next
 * leave year.
 *
 * WHAT IT WILL NOT DO: take back days already taken. If somebody carried ten
 * days, spent four, and is then ruled ineligible, the four are gone — they were
 * booked, approved and possibly worked around. The carried figure floors at what
 * was spent, exactly as an expiry does, and `total - used === remaining` holds
 * afterwards either way.
 *
 * @param {{ employeeId: string, leaveYear?: string }} input
 */
export async function recomputeCarryForward({ employeeId, leaveYear } = {}) {
  const refusal = await requireEntitlementAccess(employeeId);
  if (refusal) return refusal;

  try {
    await connect();
    const year = leaveYear || (await currentLeaveYear());

    const employee = await OfficeEmployeeModel.findById(employeeId)
      .select("name employeType department joinDate dayPerWeek carryForwardOverrides")
      .lean();
    if (!employee) return { success: false, message: "Employee not found" };

    const settings = await getLeaveSettings();
    const { start: yearStart } = boundsForLeaveYear(
      year,
      settings?.data?.leaveYearStartMonth
    );

    const result = await recomputeOne({ employee, year, settings, yearStart });
    if (!result) {
      return {
        success: false,
        message: `This employee has no entitlements for ${year} yet.`,
      };
    }
    if (!result.changes.length) {
      return { success: true, message: "Carry-forward is already up to date." };
    }

    return {
      success: true,
      message: result.message,
      data: JSON.stringify({ leaveYear: year, changes: result.changes }),
    };
  } catch (error) {
    console.log("recomputeCarryForward failed:", error);
    return { success: false, message: "Could not recalculate carry-forward" };
  }
}

/**
 * The same, for a list of employees.
 *
 * Exists because setting an exception for twenty people and then having to press
 * "Recalculate carry-over" on twenty separate entitlement sheets is the same
 * one-at-a-time problem the bulk picker was built to remove. The settings screen
 * calls this straight after a bulk change.
 *
 * Reads the company's settings and derives the leave year ONCE rather than per
 * employee, which is the whole reason recomputeOne() is split out.
 *
 * One employee's bad data does not stop the rest: each is caught and counted, so
 * nineteen succeeding is reported as nineteen rather than as a failure.
 *
 * @param {{ employeeIds: string|string[], leaveYear?: string }} input
 */
export async function recomputeCarryForwardForMany({
  employeeIds,
  leaveYear,
} = {}) {
  const ids = [
    ...new Set([].concat(employeeIds || []).map(String).filter(Boolean)),
  ];
  if (!ids.length) {
    return { success: false, message: "Choose at least one employee" };
  }

  // Every id checked before anything is written, for the same reason the bulk
  // exception write does it: half-applying is worse than refusing.
  for (const id of ids) {
    const refusal = await requireEntitlementAccess(id);
    if (refusal) return refusal;
  }

  try {
    await connect();
    const year = leaveYear || (await currentLeaveYear());

    const settings = await getLeaveSettings();
    const { start: yearStart } = boundsForLeaveYear(
      year,
      settings?.data?.leaveYearStartMonth
    );

    const employees = await OfficeEmployeeModel.find({
      _id: { $in: ids.map((id) => createObjectId(id)) },
    })
      .select("name employeType department joinDate dayPerWeek carryForwardOverrides")
      .lean();

    let updated = 0;
    let unchanged = 0;
    let noEntitlement = 0;
    let failed = 0;
    const detail = [];

    for (const employee of employees) {
      try {
        const result = await recomputeOne({
          employee,
          year,
          settings,
          yearStart,
        });
        if (!result) {
          noEntitlement++;
          continue;
        }
        if (!result.changes.length) {
          unchanged++;
          continue;
        }
        updated++;
        detail.push({ name: employee.name, changes: result.changes });
      } catch (error) {
        failed++;
        console.log(
          `recompute failed for ${employee.name}:`,
          error?.message
        );
      }
    }

    const parts = [];
    if (updated) parts.push(`${updated} updated`);
    if (unchanged) parts.push(`${unchanged} already correct`);
    if (noEntitlement) {
      parts.push(`${noEntitlement} with no entitlement for ${year}`);
    }
    if (failed) parts.push(`${failed} failed`);

    return {
      success: true,
      message: parts.length
        ? `Carry-over recalculated: ${parts.join(", ")}.`
        : "Nothing to recalculate.",
      data: JSON.stringify({
        leaveYear: year,
        updated,
        unchanged,
        noEntitlement,
        failed,
        detail,
      }),
    };
  } catch (error) {
    console.log("recomputeCarryForwardForMany failed:", error);
    return { success: false, message: "Could not recalculate carry-forward" };
  }
}

/**
 * Every company, one at a time. For the nightly job.
 *
 * Deliberately not exported as something a tenant's admin can call: it writes
 * across companies, so it is reached only from the cron route, which
 * authenticates with the cron secret.
 */
export async function expireCarryForwardForAllTenants({ on } = {}) {
  await connect();

  const companies = await escapeTenant(
    "carry-forward expiry: every company is swept",
    () =>
      CompanyModel.find({ delete: { $ne: true }, isActive: { $ne: false } })
        .select("_id name")
        .lean()
  );

  let employees = 0;
  let lapsedDays = 0;
  const failures = [];

  for (const company of companies) {
    try {
      const result = await runWithTenant(String(company._id), () =>
        expireForCurrentTenant({ on, actor: { system: true } })
      );
      employees += result.employees;
      lapsedDays += result.lapsedDays;
    } catch (error) {
      // One company's bad data must not stop the rest of the sweep.
      console.log(
        `carry-forward expiry failed for ${company.name}:`,
        error?.message
      );
      failures.push(String(company._id));
    }
  }

  return {
    success: true,
    companies: companies.length,
    employees,
    lapsedDays,
    failures,
  };
}
