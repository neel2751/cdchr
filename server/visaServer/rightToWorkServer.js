"use server";

// Right-to-work checks for office and site employees.
//
// A check is recorded from a row action, never from the employee form: it is an
// event with its own date and evidence, and the form would only ever hold the
// last one. Recording appends to `rightToWorkChecks` so the full history is
// kept, and lets HR update the visa in the same step — in practice the reason
// they are rechecking is that the visa was renewed or switched.

import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";
import { getServerSideProps } from "../session/session";
import { logVisaExpiryChange } from "./visaAudit";
import { RTW_DOCUMENT_TYPES, sortRightToWorkChecks } from "@/lib/rightToWork";

// employeeType -> the model and the field holding the visa expiry on it.
const EMPLOYEE_TYPES = {
  OfficeEmploye: { Model: OfficeEmployeeModel, visaField: "visaEndDate" },
  Employe: { Model: EmployeModel, visaField: "eVisaExp" },
};

const VALID_DOCUMENT_TYPES = new Set(RTW_DOCUMENT_TYPES.map((d) => d.value));

const MAX_NOTE_LENGTH = 500;

const employeeName = (employee) =>
  employee?.name ||
  [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") ||
  "Employee";

/** Parse a date input, returning undefined for blank and null for invalid. */
const parseDate = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Admin / super-admin session, or null. */
async function getPrivilegedUser() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user || !["admin", "superAdmin"].includes(user.role)) return null;
  return user;
}

/**
 * Record a right-to-work check, optionally updating the visa it was checked
 * against in the same action.
 *
 * @param {Object} p
 * @param {string} p.employeeId
 * @param {"OfficeEmploye"|"Employe"} [p.employeeType]
 * @param {string|Date} p.checkedAt          When the check was carried out
 * @param {string} [p.documentType]          One of RTW_DOCUMENT_TYPES
 * @param {string} [p.shareCode]
 * @param {string} [p.note]
 * @param {boolean} [p.visaUpdated]          True when the visa also changed
 * @param {string|Date} [p.visaStartDate]    New visa start (when visaUpdated)
 * @param {string|Date} [p.visaEndDate]      New visa expiry (when visaUpdated)
 * @param {string} [p.immigrationCategory]   New visa category (when visaUpdated)
 */
export const recordRightToWorkCheck = withAudit(
  "RightToWork.recorded",
  async ({
    employeeId,
    employeeType = "OfficeEmploye",
    checkedAt,
    documentType,
    shareCode,
    note,
    visaUpdated = false,
    visaStartDate,
    visaEndDate,
    immigrationCategory,
  } = {}) => {
    try {
      const user = await getPrivilegedUser();
      if (!user) return { success: false, message: "Not authorized" };
      if (!isValidObjectId(employeeId)) {
        return { success: false, message: "Invalid employee" };
      }

      const config = EMPLOYEE_TYPES[employeeType];
      if (!config) return { success: false, message: "Invalid employee type" };

      const checkDate = parseDate(checkedAt);
      if (!checkDate) {
        return { success: false, message: "Please provide a valid check date" };
      }
      // A check cannot have happened tomorrow. Compared against end of today so
      // a date-only input never trips on the time component.
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      if (checkDate > endOfToday) {
        return {
          success: false,
          message: "The check date cannot be in the future",
        };
      }

      if (documentType && !VALID_DOCUMENT_TYPES.has(documentType)) {
        return { success: false, message: "Invalid document type" };
      }
      if (note && String(note).length > MAX_NOTE_LENGTH) {
        return {
          success: false,
          message: `Notes must be ${MAX_NOTE_LENGTH} characters or fewer`,
        };
      }

      await connect();
      const { Model, visaField } = config;
      const employee = await Model.findOne({
        _id: createObjectId(employeeId),
        delete: { $ne: true },
      }).exec();
      if (!employee) return { success: false, message: "Employee not found" };

      const previousVisaEnd = employee[visaField];
      const previousLastCheck = employee.lastRightToWorkCheckDate || null;
      const name = employeeName(employee);

      // Apply the visa change first, so the snapshot stored on the check is the
      // permission the check actually covers.
      if (visaUpdated) {
        const newVisaEnd = parseDate(visaEndDate);
        if (!newVisaEnd) {
          return {
            success: false,
            message: "Please provide a valid new visa expiry date",
          };
        }
        const newVisaStart = parseDate(visaStartDate);
        if (newVisaStart === null) {
          return {
            success: false,
            message: "Please provide a valid visa start date",
          };
        }
        if (newVisaStart && newVisaEnd <= newVisaStart) {
          return {
            success: false,
            message: "The visa expiry must be after the visa start date",
          };
        }
        employee[visaField] = newVisaEnd;
        if (newVisaStart) employee.visaStartDate = newVisaStart;
        if (immigrationCategory) {
          employee.immigrationCategory = immigrationCategory;
        }
      }

      const check = {
        checkedAt: checkDate,
        visaEndDate: employee[visaField] || undefined,
        documentType: documentType || undefined,
        shareCode: shareCode ? String(shareCode).trim() : undefined,
        note: note ? String(note).trim() : undefined,
        checkedBy: { _id: user._id, name: user.name, email: user.email },
      };

      employee.rightToWorkChecks.push(check);
      // Keep the denormalised pointer on the newest check by date, not by the
      // order entries were added — a back-dated check must not overwrite it.
      const latest = sortRightToWorkChecks(employee.rightToWorkChecks)[0];
      employee.lastRightToWorkCheckDate = latest?.checkedAt || checkDate;

      const saved = await employee.save();

      recordAudit({
        entityId: employeeId,
        module: "Visa",
        before: {
          lastRightToWorkCheckDate: previousLastCheck,
          [visaField]: previousVisaEnd || null,
        },
        after: {
          lastRightToWorkCheckDate: saved.lastRightToWorkCheckDate,
          [visaField]: saved[visaField] || null,
        },
        description: `Recorded right-to-work check for ${name}${
          visaUpdated ? " (visa details updated)" : ""
        }`,
      });

      if (visaUpdated) {
        await logVisaExpiryChange({
          before: previousVisaEnd,
          after: saved[visaField],
          employeeType,
          entityId: employeeId,
          name,
        });
      }

      return {
        success: true,
        message: visaUpdated
          ? "Right-to-work check recorded and visa details updated"
          : "Right-to-work check recorded",
      };
    } catch (error) {
      console.log("recordRightToWorkCheck error", error);
      return { success: false, message: "Failed to record the check" };
    }
  },
  { module: "Visa" },
);

/**
 * Full right-to-work history for one employee, newest first. Used by the
 * profile page, which does not carry the list payload.
 */
export async function getRightToWorkHistory({
  employeeId,
  employeeType = "OfficeEmploye",
}) {
  try {
    const user = await getPrivilegedUser();
    if (!user) return { success: false, message: "Not authorized" };
    if (!isValidObjectId(employeeId)) {
      return { success: false, message: "Invalid employee" };
    }
    const config = EMPLOYEE_TYPES[employeeType];
    if (!config) return { success: false, message: "Invalid employee type" };

    await connect();
    const { Model, visaField } = config;
    const employee = await Model.findById(createObjectId(employeeId))
      .select(`rightToWorkChecks immigrationType ${visaField}`)
      .lean();
    if (!employee) return { success: false, message: "Employee not found" };

    return {
      success: true,
      data: JSON.stringify({
        checks: sortRightToWorkChecks(employee.rightToWorkChecks),
        immigrationType: employee.immigrationType,
        visaEndDate: employee[visaField] || null,
      }),
    };
  } catch (error) {
    console.log("getRightToWorkHistory error", error);
    return { success: false, message: "Failed to load the check history" };
  }
}
