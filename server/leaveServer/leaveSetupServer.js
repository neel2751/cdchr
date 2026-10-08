"use server";

/**
 * Setting leave up, once, when a company arrives.
 *
 * A company that has just registered has a LeaveSetting document it never asked
 * for — `getLeaveSettings()` conjures one with April defaults the first time
 * anything reads it — and no LeaveCategory rows at all. That combination is
 * quietly broken rather than visibly empty:
 *
 *   · The leave year start month is the date every entitlement and every
 *     booking is measured from, and it was decided for them. A company running
 *     January–December finds out when the balances are wrong.
 *   · With no categories, generateDefaultLeaves() falls through to a hard-coded
 *     safety net, so employees do get numbers — but the Category screen is
 *     empty, none of it can be edited, and addOneCommonLeaveToOneEmployee()
 *     refuses every request with "Leave Category not find on admin category".
 *     The leave types existed in the code and not in the company.
 *
 * So the question is asked instead: which month, and which types. Then the
 * entitlements are built from the answer, for everybody already on the list —
 * which on day one is the founder, and after a staff import is everybody.
 *
 * WHAT COUNTS AS ALREADY SET UP
 * `configuredAt` is the flag, but a company that has been running for years has
 * a null one and must not be sent to a setup screen. Existing categories are
 * taken as proof that somebody set leave up before this screen existed, and the
 * flag is back-filled the first time we look. See loadSetupState() below.
 */

import { connect } from "@/db/db";
import { logAuditDirect } from "@/lib/audit";
import { boundsForLeaveYear, explainAnnualLeave } from "@/lib/leaveEntitlement";
import { getLeaveYearString } from "@/helper/getLeaveYearString";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import {
  HALF_DAY_EXPLANATION,
  LEAVE_TYPE_CATALOGUE,
  LEAVE_YEAR_MONTHS,
  REQUIRED_LEAVE_KEYS,
  leaveTypeByKey,
} from "@/data/leaveTypes";
import CommonLeaveModel from "@/models/commonLeaveModel";
import LeaveCategoryModel from "@/models/leaveCategoryModel";
import LeaveSettingModel from "@/models/leaveSettingModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { getServerSideProps } from "@/server/session/session";
import { generateNewLeaveYearForAllEmployees } from "./countLeaveServer";

/**
 * A signed-in caller, for the two readers that are not decisions.
 *
 * Needed because loadSetupState() *writes* — it creates the LeaveSetting
 * document if there is none — and every exported action here is an addressable
 * endpoint, so without this an unauthenticated caller could provoke that write
 * with no tenant in context.
 */
async function requireSession() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { error: { success: false, message: "Not signed in" } };
  return { user };
}

/** Only a super admin decides a company's leave year. */
async function requireSuperAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { error: { success: false, message: "Not signed in" } };
  if (user.role !== "superAdmin") {
    return {
      error: {
        success: false,
        message: "Only a super admin can change leave settings",
      },
    };
  }
  return { user };
}

/**
 * The settings document, plus whether a human ever chose what is in it.
 *
 * Back-fills `configuredAt` for a company that was already running: categories
 * on file mean somebody set leave up the old way, and asking them to do it again
 * would be asking them to re-answer a question they have been living with.
 */
async function loadSetupState() {
  await connect();

  let settings = await LeaveSettingModel.findOne();
  if (!settings) {
    settings = await LeaveSettingModel.create({
      leaveYearStartMonth: 4,
      carryForwardEnabled: false,
    });
  }

  const categories = await LeaveCategoryModel.find({ isDeleted: false })
    .select("leaveType total isPaid isHide isEditable isActive")
    .lean();

  if (!settings.configuredAt && categories.length > 0) {
    settings.configuredAt = settings.createdAt || new Date();
    await settings.save();
  }

  return { settings, categories };
}

/**
 * What the setup screen needs to draw itself.
 *
 * Includes the count of staff who have no entitlement for the current leave
 * year, because that number is the whole point of the screen after an import:
 * forty people on the list and forty with no leave is the state somebody has to
 * be able to see and fix in one press.
 */
export async function getLeaveSetupState() {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  try {
    const { settings, categories } = await loadSetupState();

    const startMonth = settings.leaveYearStartMonth || 4;
    const leaveYear = getLeaveYearString(new Date(), startMonth);
    const { start, end } = boundsForLeaveYear(leaveYear, startMonth);

    // The same eligibility the entitlement generator uses, so the number shown
    // and the number acted on cannot disagree.
    const eligible = await OfficeEmployeeModel.countDocuments({
      isActive: true,
      delete: false,
      joinDate: { $ne: null },
      dayPerWeek: { $exists: true, $ne: null },
      employeType: { $exists: true, $ne: "" },
    });

    const withEntitlement = await CommonLeaveModel.countDocuments({
      leaveYear,
    });

    const existingNames = new Set(categories.map((c) => c.leaveType));

    return {
      success: true,
      data: JSON.stringify({
        configured: Boolean(settings.configuredAt),
        configuredAt: settings.configuredAt || null,
        leaveYearStartMonth: startMonth,
        leaveYear,
        leaveYearStart: start,
        leaveYearEnd: end,
        months: LEAVE_YEAR_MONTHS,
        halfDayExplanation: HALF_DAY_EXPLANATION,
        requiredKeys: REQUIRED_LEAVE_KEYS,
        // The catalogue, annotated with what this company already has — so a
        // company coming back to add a type is not offered its own types again
        // as if they were new.
        catalogue: LEAVE_TYPE_CATALOGUE.map((type) => ({
          ...type,
          exists: existingNames.has(type.leaveType),
        })),
        // Types they added themselves, which the screen must not imply it will
        // touch.
        ownTypes: categories
          .map((c) => c.leaveType)
          .filter(
            (name) => !LEAVE_TYPE_CATALOGUE.some((t) => t.leaveType === name)
          ),
        staff: {
          eligible,
          withEntitlement: Math.min(withEntitlement, eligible),
          missing: Math.max(eligible - withEntitlement, 0),
        },
      }),
    };
  } catch (error) {
    console.log("getLeaveSetupState failed:", error);
    return { success: false, message: "Could not load the leave setup" };
  }
}

/**
 * Save the company's leave year and create the leave types it chose.
 *
 * Idempotent on the types: a type already on file is left exactly as it is
 * rather than reset to the catalogue's figure, because by the time somebody
 * comes back to this screen they may well have changed it on purpose.
 *
 * Changing the leave year start month is allowed here, and deliberately warned
 * about rather than blocked — a company that has just registered and picked the
 * wrong month must be able to correct it, and one with a year of bookings
 * behind it needs to understand that the twelve months everything is measured
 * against are moving. `generateEntitlements` is what rebuilds the balances
 * afterwards.
 *
 * @param {Object} input
 * @param {number} input.leaveYearStartMonth 1–12
 * @param {string[]} input.leaveTypeKeys keys from data/leaveTypes.js
 * @param {boolean} [input.generateEntitlements] build balances for all staff
 */
export async function completeLeaveSetup({
  leaveYearStartMonth,
  leaveTypeKeys = [],
  generateEntitlements = true,
} = {}) {
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  const month = Number(leaveYearStartMonth);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { success: false, message: "Choose the month your leave year starts" };
  }

  try {
    const { settings } = await loadSetupState();

    // The required types go in whether or not they were sent. They are not a
    // preference: the entitlement generator and the leave request screens both
    // assume Annual, Sick and Unpaid exist, and maternity and paternity are
    // statutory rights that a company cannot opt out of recording.
    const keys = [...new Set([...REQUIRED_LEAVE_KEYS, ...leaveTypeKeys])];

    const created = [];
    const skipped = [];

    for (const key of keys) {
      const type = leaveTypeByKey(key);
      // A key we do not recognise is ignored rather than trusted — this is a
      // whitelist, and `leaveType` is the name every entitlement row is matched
      // against, so an arbitrary string here would create a category nothing
      // could ever fill.
      if (!type) continue;

      const exists = await LeaveCategoryModel.findOne({
        leaveType: type.leaveType,
        isDeleted: false,
      });
      if (exists) {
        skipped.push(type.leaveType);
        continue;
      }

      await LeaveCategoryModel.create({
        leaveType: type.leaveType,
        total: type.total,
        // Stored as strings on this schema, matching what handleLeaveCategory
        // writes from the form — `isPaid: "Paid"` becomes a truthy string, and
        // the readers compare against both forms. Written the same way here so
        // a category created at setup and one created by hand behave alike.
        isPaid: type.isPaid ? "Paid" : "Unpaid",
        isHide: type.isHidden ? "Hide" : "Show",
        note: type.note,
        // The four computed types are not free-form: their figures come from
        // the contract or from statute, so they are locked against editing.
        isEditable: !type.computed,
        isActive: true,
        isDeleted: false,
      });
      created.push(type.leaveType);
    }

    const monthChanged = settings.leaveYearStartMonth !== month;
    const previousMonth = settings.leaveYearStartMonth;

    settings.leaveYearStartMonth = month;
    if (!settings.configuredAt) settings.configuredAt = new Date();
    settings.configuredBy = isValidObjectId(user._id)
      ? createObjectId(user._id)
      : undefined;
    await settings.save();

    let entitlements = null;
    if (generateEntitlements) {
      // Runs after the settings are saved, never before: it reads the start
      // month back out to decide which leave year it is filling.
      const result = await generateNewLeaveYearForAllEmployees();
      entitlements = result?.data ? JSON.parse(result.data) : null;
    }

    const leaveYear = getLeaveYearString(new Date(), month);

    await logAuditDirect({
      actor: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      action: "Leave.setup",
      module: "Leave",
      tenantId: user.tenantId,
      description:
        `Leave set up: year starts in month ${month}` +
        (monthChanged && previousMonth
          ? ` (was ${previousMonth})`
          : "") +
        `, ${created.length} leave types created` +
        (entitlements
          ? `, entitlements built for ${entitlements.created} employees`
          : ""),
      metadata: {
        leaveYearStartMonth: month,
        previousLeaveYearStartMonth: monthChanged ? previousMonth : undefined,
        created,
        skipped,
        entitlements,
      },
    });

    return {
      success: true,
      message: "Leave is set up",
      data: JSON.stringify({
        leaveYear,
        leaveYearStartMonth: month,
        monthChanged,
        created,
        skipped,
        entitlements,
      }),
    };
  } catch (error) {
    console.log("completeLeaveSetup failed:", error);
    return { success: false, message: "Could not save the leave setup" };
  }
}

/**
 * Build the current leave year's entitlements for everybody who has none.
 *
 * A thin wrapper over generateNewLeaveYearForAllEmployees() that refuses to run
 * before the company has chosen its leave year. Without that guard the button
 * would cheerfully generate a whole company's balances against the April
 * default and then have to be undone by hand: an entitlement, once created for
 * a leave year, is skipped by every subsequent sync.
 *
 * This is the button the staff import points at.
 */
export async function generateEntitlementsForEveryone() {
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  try {
    const { settings } = await loadSetupState();
    if (!settings.configuredAt) {
      return {
        success: false,
        message:
          "Set your leave year and leave types up first — entitlements are " +
          "measured from them.",
      };
    }

    const result = await generateNewLeaveYearForAllEmployees();
    if (!result?.success) return result;

    const summary = result?.data ? JSON.parse(result.data) : null;

    await logAuditDirect({
      actor: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      action: "Leave.generateEntitlements",
      module: "Leave",
      tenantId: user.tenantId,
      description:
        `Built ${summary?.created ?? 0} leave entitlements for ` +
        `${summary?.leaveYear ?? "the current leave year"} ` +
        `(${summary?.skipped ?? 0} already had one)`,
      metadata: summary || undefined,
    });

    return result;
  } catch (error) {
    console.log("generateEntitlementsForEveryone failed:", error);
    return { success: false, message: "Could not build the entitlements" };
  }
}

/**
 * What each employee's annual leave would come to, without writing anything.
 *
 * Entitlement is the number an employee will argue with you about, and after an
 * import there are hundreds of them arriving at once. A count of "40 created"
 * is not something anybody can check; one row per person showing the join date,
 * the contracted week and the arithmetic that produced the figure is.
 *
 * Also the honest way to present a pro-rata rule: somebody who joined in
 * October and is offered 16 days instead of 28 needs to see why on the same
 * screen, not raise a ticket about it a week later.
 *
 * @param {{ month?: number, limit?: number }} [options] `month` previews a leave
 *   year start month that has not been saved yet, which is what makes the
 *   dropdown on the setup screen answerable.
 */
export async function previewEntitlements({ month, limit = 200 } = {}) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  try {
    const { settings } = await loadSetupState();

    const candidate = Number(month);
    const startMonth =
      Number.isInteger(candidate) && candidate >= 1 && candidate <= 12
        ? candidate
        : settings.leaveYearStartMonth || 4;

    const leaveYear = getLeaveYearString(new Date(), startMonth);
    const { start, end } = boundsForLeaveYear(leaveYear, startMonth);

    const employees = await OfficeEmployeeModel.find({
      isActive: true,
      delete: false,
    })
      .select("name joinDate dayPerWeek endDate employeType")
      .sort({ joinDate: 1 })
      .limit(Math.min(Number(limit) || 200, 500))
      .lean();

    const existing = await CommonLeaveModel.find({ leaveYear })
      .select("employeeId")
      .lean();
    const alreadyHave = new Set(existing.map((row) => String(row.employeeId)));

    const rows = employees.map((employee) => {
      const eligible = Boolean(
        employee.joinDate && employee.dayPerWeek && employee.employeType
      );
      const workedOut = eligible
        ? explainAnnualLeave({
            joinDate: employee.joinDate,
            dayPerWeek: employee.dayPerWeek,
            leaveYearStart: start,
            leaveYearEnd: end,
          })
        : null;

      return {
        _id: String(employee._id),
        name: employee.name,
        joinDate: employee.joinDate || null,
        dayPerWeek: employee.dayPerWeek || null,
        eligible,
        // What stops them being counted, said plainly — "not eligible" on its
        // own sends somebody hunting through an employee record for the field.
        blockedBy: eligible
          ? null
          : [
              !employee.joinDate && "no start date",
              !employee.dayPerWeek && "no days per week",
              !employee.employeType && "no employment type",
            ]
              .filter(Boolean)
              .join(", "),
        annualLeave: workedOut?.days ?? null,
        fullYear: workedOut?.full ?? null,
        proRated: workedOut?.proRated ?? false,
        explanation: workedOut?.explanation ?? null,
        hasEntitlement: alreadyHave.has(String(employee._id)),
      };
    });

    return {
      success: true,
      data: JSON.stringify({
        leaveYear,
        leaveYearStart: start,
        leaveYearEnd: end,
        leaveYearStartMonth: startMonth,
        rows,
        totals: {
          shown: rows.length,
          eligible: rows.filter((row) => row.eligible).length,
          proRated: rows.filter((row) => row.proRated).length,
          blocked: rows.filter((row) => !row.eligible).length,
          alreadyHave: rows.filter((row) => row.hasEntitlement).length,
        },
      }),
    };
  } catch (error) {
    console.log("previewEntitlements failed:", error);
    return { success: false, message: "Could not work out the entitlements" };
  }
}

/**
 * Whether leave is set up, for screens that only need to know that.
 *
 * Read by the staff import, which has to warn that imported employees will land
 * without any entitlement — and by the leave landing page, which sends a company
 * that has not done this to the setup screen rather than to a dashboard of
 * zeroes.
 */
export async function getLeaveConfiguredState() {
  const { error } = await requireSession();
  if (error) return error;

  try {
    const { settings } = await loadSetupState();
    const startMonth = settings.leaveYearStartMonth || 4;
    return {
      success: true,
      data: JSON.stringify({
        configured: Boolean(settings.configuredAt),
        leaveYearStartMonth: startMonth,
        leaveYear: getLeaveYearString(new Date(), startMonth),
      }),
    };
  } catch (error) {
    console.log("getLeaveConfiguredState failed:", error);
    // Fails open as "configured": a screen that cannot read this must not
    // accuse a working company of having no leave set up.
    return {
      success: true,
      data: JSON.stringify({ configured: true, leaveYearStartMonth: 4 }),
    };
  }
}
