"use server";

/**
 * Individual exceptions to the company's carry-forward rules, per leave type.
 *
 * WHY THESE LIVE ON THE EMPLOYEE AND NOT IN THE RULE. It is tempting to let a
 * rule name the people it applies to, which would put everything on one screen.
 * It would also create two places that can disagree about one employee — a rule
 * listing them and another rule excluding them — with no way to say which wins.
 * And a rule with three people's names in it is not a policy; it is three
 * decisions wearing a policy's clothes, and the next person to read it cannot
 * tell which.
 *
 * So the rule answers "who, by default", and the employee carries their own
 * exceptions (`carryForwardOverrides`). These actions exist so those can be set
 * from the settings screen as well as from the employee's own record — because
 * that is where somebody is standing when they think of it.
 *
 * WHY PER LEAVE TYPE. Because the rules are. A company can carry annual leave
 * and company sick days under different limits, and "this person never carries
 * annual leave" says nothing about their sick days. One setting covering
 * everything silently applied a decision about one type to all of them.
 */

import { connect } from "@/db/db";
import { logAuditDirect } from "@/lib/audit";
import { requireEntitlementAccess } from "@/lib/employeeAccess";
import { createObjectId } from "@/lib/mongodb";
import { overrideFor } from "@/lib/carryForward";
import { recomputeCarryForwardForMany } from "./carryExpiryServer";
import { getLeaveSettings } from "@/server/leaveSettingServer";
import { getServerSideProps } from "@/server/session/session";
import LeaveCategoryModel from "@/models/leaveCategoryModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import RoleTypesModel from "@/models/roleTypeModel";

const MODES = ["default", "always", "never"];

/** The leave year a recompute reported on, for a message that skipped it. */
const leaveYearLabelOf = (applied) => applied?.leaveYear || "the current leave year";

/**
 * The exceptions, one row per employee and leave type.
 *
 * Only the exceptions, not everybody: the point of the list is to be short and
 * reviewable. A company with four hundred staff and two exceptions should see
 * two rows, which is also the honest picture of what has been decided by hand.
 *
 * `leaveTypes` comes back alongside so the screen can offer the types that
 * actually carry forward, rather than every type the company has.
 */
export async function getCarryForwardExceptions() {
  const refusal = await requireEntitlementAccess();
  if (refusal) return refusal;

  try {
    await connect();

    const employees = await OfficeEmployeeModel.find({
      isActive: true,
      delete: false,
      "carryForwardOverrides.0": { $exists: true },
    })
      .select("name employeType department carryForwardOverrides")
      .sort({ name: 1 })
      .lean();

    // Department names, so a row reads as a person rather than an id.
    const departments = await RoleTypesModel.find({ delete: false })
      .select("roleTitle")
      .lean();
    const departmentName = new Map(
      departments.map((row) => [String(row._id), row.roleTitle])
    );

    const settings = await getLeaveSettings();
    const rules = settings?.data?.carryForwardRules || [];
    const carryingTypes = rules
      .filter((rule) => rule?.allowed === true)
      .map((rule) => rule.leaveType);

    // Every type the company has, so an exception can be read back even for a
    // type whose rule was since switched off.
    const categories = await LeaveCategoryModel.find({ isDeleted: false })
      .select("leaveType")
      .lean();
    const allTypes = categories.map((row) => row.leaveType).filter(Boolean);

    const rows = [];
    for (const employee of employees) {
      const person = {
        employeeId: String(employee._id),
        name: employee.name,
        employeType: employee.employeType || null,
        department: departmentName.get(String(employee.department)) || null,
      };

      const overrides = Array.isArray(employee.carryForwardOverrides)
        ? employee.carryForwardOverrides
        : [];

      for (const override of overrides) {
        rows.push({
          ...person,
          leaveType: override.leaveType,
          mode: override.mode,
          // So the screen can say when an exception is pointed at a type that is
          // not carrying forward at all, where it has no effect.
          typeCarries: carryingTypes.includes(override.leaveType),
        });
      }
    }

    return {
      success: true,
      data: JSON.stringify({
        rows,
        // Types with a live rule first; the rest are still selectable so an
        // exception can be set up before its rule is switched on.
        leaveTypes: [
          ...carryingTypes,
          ...allTypes.filter((type) => !carryingTypes.includes(type)),
        ],
        carryingTypes,
      }),
    };
  } catch (error) {
    console.log("getCarryForwardExceptions failed:", error);
    return { success: false, message: "Could not load the exceptions" };
  }
}


/**
 * Put employees on, or take them off, an exception for one leave type.
 *
 * TAKES A LIST, NOT ONE NAME. A company of forty giving the exception to twenty
 * of them is the ordinary case, and twenty round trips through a dropdown is not
 * a workflow anybody finishes — they give up half way and the setting ends up
 * half applied, which is worse than not having it at all. So the screen selects
 * as many people as it likes and this applies the lot.
 *
 * `mode: "default"` removes the exception — it is how a row is deleted, because
 * "follow the policy" is a real state and not the absence of one.
 *
 * APPLIES IT STRAIGHT AWAY, by default. Carry-forward is worked out once, when
 * the leave year is generated, so a change made in October touches nothing that
 * was granted in April. Leaving that to a second, separate press was the right
 * instinct about destructiveness and the wrong answer in practice: setting the
 * exception for twenty people and then visiting twenty entitlement sheets is the
 * same one-at-a-time problem the bulk picker exists to remove, so it does not get
 * done and the setting looks broken.
 *
 * It is safe to do here because the recompute is not a blunt overwrite: it never
 * takes back days already taken, it writes a history entry per change explaining
 * itself, and the result says exactly how many balances moved. `applyNow: false`
 * is still available for somebody who wants to stage a change.
 *
 * @param {Object} input
 * @param {string|string[]} input.employeeIds one id or many
 * @param {string} input.leaveType
 * @param {"default"|"always"|"never"} input.mode
 * @param {boolean} [input.applyNow] recalculate the current leave year too
 */
export async function setCarryForwardMode({
  employeeIds,
  leaveType,
  mode,
  applyNow = true,
} = {}) {
  // A single id is accepted as well as a list — the remove button on one row has
  // no reason to wrap it. Deduplicated, because a picker can offer the same
  // person twice and twenty writes to one record is not an improvement.
  const ids = [
    ...new Set([].concat(employeeIds || []).map(String).filter(Boolean)),
  ];

  if (!ids.length) {
    return { success: false, message: "Choose at least one employee" };
  }
  if (!MODES.includes(mode)) {
    return { success: false, message: "Unknown carry-forward setting" };
  }
  if (!leaveType || typeof leaveType !== "string") {
    return { success: false, message: "Choose which leave type this applies to" };
  }

  // Checked for every id BEFORE anything is written: the permission does not
  // vary per employee, but an id that is not a valid ObjectId should stop the
  // whole request rather than half of it.
  for (const id of ids) {
    const refusal = await requireEntitlementAccess(id);
    if (refusal) return refusal;
  }

  try {
    await connect();

    // Checked against the company's own types, so an exception cannot be stored
    // against a name nothing will ever match.
    const category = await LeaveCategoryModel.findOne({
      leaveType,
      isDeleted: false,
    })
      .select("leaveType")
      .lean();
    if (!category) {
      return { success: false, message: `${leaveType} is not a leave type here` };
    }

    const employees = await OfficeEmployeeModel.find({
      _id: { $in: ids.map((id) => createObjectId(id)) },
    })
      .select("name carryForwardOverrides")
      .lean();

    if (!employees.length) {
      return { success: false, message: "None of those employees were found" };
    }

    const changed = [];
    const unchanged = [];

    for (const employee of employees) {
      const before = overrideFor(employee, leaveType);
      if (before === mode) {
        unchanged.push(employee.name);
        continue;
      }

      const existing = Array.isArray(employee.carryForwardOverrides)
        ? employee.carryForwardOverrides.filter(
            (row) => row?.leaveType && row.leaveType !== leaveType
          )
        : [];
      const next =
        mode === "default" ? existing : [...existing, { leaveType, mode }];

      // The whole array is replaced rather than pushed to: Mongo cannot $pull
      // and $push the same array in one update, and two updates would leave a
      // window where the employee has neither setting.
      await OfficeEmployeeModel.updateOne(
        { _id: employee._id },
        { $set: { carryForwardOverrides: next } }
      );

      changed.push({ id: String(employee._id), name: employee.name, before });
    }

    if (changed.length) {
      const { props } = await getServerSideProps();
      const user = props?.session?.user;
      // One entry for the batch, not one per person: the decision was a single
      // act, and twenty audit rows for one press is an audit nobody reads. Every
      // name is in the metadata.
      await logAuditDirect({
        actor: user
          ? { _id: user._id, name: user.name, email: user.email, role: user.role }
          : { system: true },
        action: "Leave.carryForwardOverride",
        module: "Leave",
        tenantId: user?.tenantId,
        entityId: changed.length === 1 ? changed[0].id : undefined,
        description:
          `${leaveType} carry-forward set to "${mode}" for ` +
          `${changed.length} employee(s): ` +
          changed.map((row) => row.name).join(", "),
        metadata: {
          leaveType,
          to: mode,
          employees: changed.map((row) => ({
            id: row.id,
            name: row.name,
            from: row.before,
          })),
        },
      });
    }

    if (!changed.length) {
      return {
        success: true,
        data: JSON.stringify({ changed: 0, unchanged: unchanged.length }),
        message:
          unchanged.length === 1
            ? "That is already their setting."
            : `That is already the setting for all ${unchanged.length}.`,
      };
    }

    // Apply it to the leave year they are actually in, so the exception is not a
    // setting that appears to do nothing. Only the people who changed: recomputing
    // the ones who already had it would be work with no result.
    let applied = null;
    if (applyNow) {
      const result = await recomputeCarryForwardForMany({
        employeeIds: changed.map((row) => row.id),
      });
      applied = result?.data ? JSON.parse(result.data) : null;
    }

    const settings = await getLeaveSettings();
    const rule = (settings?.data?.carryForwardRules || []).find(
      (row) => row.leaveType === leaveType
    );
    const typeCarries =
      Boolean(settings?.data?.carryForwardEnabled) && rule?.allowed === true;

    const one = changed.length === 1;
    const who = one ? changed[0].name : `${changed.length} employees`;
    const wording = {
      always: `${who} will always carry ${leaveType} forward.`,
      never: `${who} will never carry ${leaveType} forward.`,
      default: `${who} now follow${one ? "s" : ""} the company rule for ${leaveType}.`,
    };

    // What actually happened to the balances, said plainly. "14 set" with no
    // mention of balances is how somebody concludes the feature is broken.
    const appliedNote = !applyNow
      ? ` Not applied to ${leaveYearLabelOf(applied)} — use "Recalculate carry-over" on ${
          one ? "their entitlement" : "their entitlements"
        } when you are ready.`
      : applied?.updated
        ? ` ${applied.updated} entitlement${applied.updated === 1 ? "" : "s"} updated for ${applied.leaveYear}.`
        : applied?.noEntitlement
          ? ` Nothing to update — ${applied.noEntitlement} ${
              applied.noEntitlement === 1 ? "has" : "have"
            } no entitlement for ${applied.leaveYear} yet.`
          : " No balances needed changing.";

    return {
      success: true,
      data: JSON.stringify({
        changed: changed.length,
        unchanged: unchanged.length,
        applied,
      }),
      message:
        wording[mode] +
        (unchanged.length ? ` ${unchanged.length} already had it.` : "") +
        // Honest about the one way this can still appear to do nothing.
        (mode === "always" && !typeCarries
          ? ` Note ${leaveType} has no carry-forward rule at the moment, so nothing will carry until one is set.`
          : appliedNote),
    };
  } catch (error) {
    console.log("setCarryForwardMode failed:", error);
    return { success: false, message: "Could not change that setting" };
  }
}
