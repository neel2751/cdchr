"use server";

import { connect } from "@/db/db";
import { recordAudit, withAudit } from "@/lib/audit";
import {
  getEmployeeManageAccess,
  pickSelfEditableFields,
  resolveEmployeeTarget,
} from "@/lib/employeeAccess";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { REQUESTABLE_FIELDS } from "@/lib/profileFields";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import ProfileChangeRequestModel from "@/models/profileChangeRequestModel";

/**
 * Change requests: an employee asks, HR decides.
 *
 * Every action here resolves whose record it is acting on from the session —
 * none of them takes an employee id from the caller. An employee reaches only
 * their own requests; deciding one needs a staff-management permission.
 */

/**
 * Save the handful of fields on your own record that are yours to change.
 *
 * Deliberately not handleOfficeEmployee. That action is built for the HR form:
 * it runs the payload through buildOfficeEmployeePayload(), which fills in
 * `country` from `immigrationType` — and this screen sends one section at a
 * time, so neither field is present and a non-UK employee's country would be
 * reset to United Kingdom every time they edited their address. It also takes
 * the caller's word for the id, which here is never needed.
 *
 * The whitelist applies to everybody, HR included. On this page a super admin
 * is an employee looking at their own record, the same as anyone else; the full
 * edit lives on the employee record, where it is an HR act with a history.
 */
export const updateMyProfile = withAudit(
  "OfficeEmployee.selfUpdate",
  async (values) => {
    if (!values || typeof values !== "object") {
      return { success: false, message: "Nothing to save" };
    }

    try {
      const { user } = await resolveEmployeeTarget();
      if (!user?._id) return { success: false, message: "Not signed in" };

      const payload = pickSelfEditableFields(values);
      if (Object.keys(payload).length === 0) {
        return { success: false, message: "Nothing here is yours to change" };
      }

      await connect();
      const employee = await OfficeEmployeeModel.findById(user._id);
      if (!employee) return { success: false, message: "Record not found" };

      const before = employee.toObject();
      Object.assign(employee, payload);
      await employee.save();

      recordAudit({
        entityId: String(employee._id),
        before,
        after: employee.toObject(),
        description: `Updated their own contact details`,
      });

      return { success: true, message: "Saved" };
    } catch (error) {
      console.log("Error saving own profile:", error?.message);
      return { success: false, message: "Could not save" };
    }
  },
  { module: "OfficeEmployee" }
);

/** The stored string turned back into what the field actually holds. */
function coerceValue(field, raw) {
  const meta = REQUESTABLE_FIELDS[field];
  if (!meta) return undefined;
  if (raw === "" || raw === null || raw === undefined) return null;

  if (meta.type === "date") {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (meta.type === "number") {
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  }
  return String(raw);
}

/** What the record holds now, as a string, for the "before" column. */
function readCurrent(employee, field) {
  const value = employee?.[field];
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Raise a request against your own record.
 *
 * The employee is the session user, always — the form has no id to send. The
 * "before" value is read from the database rather than accepted from the
 * client, so the queue shows HR what is actually stored and not what a stale
 * page thought was stored.
 */
export async function requestProfileChange(data) {
  if (!data?.field) return { success: false, message: "No field named" };

  const meta = REQUESTABLE_FIELDS[data.field];
  if (!meta) {
    return { success: false, message: "That field cannot be requested" };
  }

  const { user } = await resolveEmployeeTarget();
  if (!user?._id) return { success: false, message: "Not signed in" };

  const newValue = meta.noteOnly ? "" : String(data.newValue ?? "").trim();
  const reason = String(data.reason ?? "").trim();

  if (!meta.noteOnly && !newValue) {
    return { success: false, message: "Enter the value it should be" };
  }
  if (meta.noteOnly && !reason) {
    return { success: false, message: "Tell HR what needs changing" };
  }

  try {
    await connect();

    const employee = await OfficeEmployeeModel.findById(user._id).lean();
    if (!employee) return { success: false, message: "Record not found" };

    const existing = await ProfileChangeRequestModel.findOne({
      employeeId: createObjectId(user._id),
      field: data.field,
      status: "pending",
    }).lean();
    if (existing) {
      return {
        success: false,
        message: `You already have a request for ${meta.label} waiting with HR`,
      };
    }

    const current = meta.noteOnly ? "" : readCurrent(employee, data.field);

    await ProfileChangeRequestModel.create({
      employeeId: createObjectId(user._id),
      employeeName: employee?.name || user?.name || "",
      field: data.field,
      label: meta.label,
      oldValue: current,
      newValue,
      reason,
    });

    return { success: true, message: "Sent to HR" };
  } catch (error) {
    console.log("Error raising profile change request:", error?.message);
    return { success: false, message: "Could not send the request" };
  }
}

/** Your own requests, newest first. */
export async function getMyProfileChangeRequests() {
  try {
    const { user } = await resolveEmployeeTarget();
    if (!user?._id) return { success: false, message: "Not signed in" };

    await connect();
    const rows = await ProfileChangeRequestModel.find({
      employeeId: createObjectId(user._id),
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return { success: true, data: JSON.stringify(rows) };
  } catch (error) {
    console.log("Error reading profile change requests:", error?.message);
    return { success: false, message: "Could not load your requests" };
  }
}

/** Withdraw one of your own, while it is still waiting. */
export async function cancelProfileChangeRequest(id) {
  if (!isValidObjectId(id)) return { success: false, message: "Unknown request" };
  try {
    const { user } = await resolveEmployeeTarget();
    if (!user?._id) return { success: false, message: "Not signed in" };

    await connect();
    // Scoped by employeeId as well as id: without it, any id would do.
    const updated = await ProfileChangeRequestModel.findOneAndUpdate(
      {
        _id: createObjectId(id),
        employeeId: createObjectId(user._id),
        status: "pending",
      },
      { status: "cancelled" },
      { new: true }
    );
    if (!updated) {
      return { success: false, message: "That request is no longer waiting" };
    }
    return { success: true, message: "Request withdrawn" };
  } catch (error) {
    console.log("Error cancelling profile change request:", error?.message);
    return { success: false, message: "Could not withdraw the request" };
  }
}

/** The HR queue. */
export async function getProfileChangeRequests(params) {
  try {
    const { canManage } = await getEmployeeManageAccess();
    if (!canManage) return { success: false, message: "Not allowed" };

    await connect();
    const status = params?.status || "pending";
    const filter = status === "all" ? {} : { status };

    const rows = await ProfileChangeRequestModel.find(filter)
      .sort({ status: 1, createdAt: -1 })
      .limit(200)
      .lean();

    return { success: true, data: JSON.stringify(rows) };
  } catch (error) {
    console.log("Error reading the change request queue:", error?.message);
    return { success: false, message: "Could not load the queue" };
  }
}

/** How many are waiting — for a badge, cheap enough to poll. */
export async function countPendingProfileChangeRequests() {
  try {
    const { canManage } = await getEmployeeManageAccess();
    if (!canManage) return { success: true, data: JSON.stringify({ count: 0 }) };

    await connect();
    const count = await ProfileChangeRequestModel.countDocuments({
      status: "pending",
    });
    return { success: true, data: JSON.stringify({ count }) };
  } catch (error) {
    console.log("Error counting change requests:", error?.message);
    return { success: true, data: JSON.stringify({ count: 0 }) };
  }
}

/**
 * Approve or reject one.
 *
 * Approving writes the value onto the employee's record here rather than
 * handing it to handleOfficeEmployee: that action rebuilds a whole payload from
 * a form, and this has one field. Going through it would mean constructing a
 * fake form submission and hoping nothing else on the record moved.
 *
 * Note-only requests (bank details, NI) have nothing to write. Approving one
 * means "done, I have dealt with it" — the value itself was typed on the
 * employee's record, where it is protected.
 */
export const decideProfileChangeRequest = withAudit(
  "ProfileChangeRequest.decide",
  async ({ id, decision, note } = {}) => {
    if (!isValidObjectId(id)) {
      return { success: false, message: "Unknown request" };
    }
    if (decision !== "approved" && decision !== "rejected") {
      return { success: false, message: "Decide approve or reject" };
    }

    try {
      const { user, canManage } = await getEmployeeManageAccess();
      if (!canManage) return { success: false, message: "Not allowed" };

      await connect();
      const request = await ProfileChangeRequestModel.findOne({
        _id: createObjectId(id),
        status: "pending",
      });
      if (!request) {
        return { success: false, message: "That request is no longer waiting" };
      }

      const meta = REQUESTABLE_FIELDS[request.field];
      if (!meta) {
        return { success: false, message: "That field no longer exists" };
      }

      if (decision === "approved" && !meta.noteOnly) {
        const value = coerceValue(request.field, request.newValue);
        if (value === undefined) {
          return {
            success: false,
            message: `"${request.newValue}" is not a valid ${meta.label}`,
          };
        }

        const employee = await OfficeEmployeeModel.findById(request.employeeId);
        if (!employee) {
          return { success: false, message: "That employee no longer exists" };
        }

        // Email is the sign-in identifier, so it carries the same uniqueness
        // rule the edit form enforces. Approving a duplicate would lock two
        // people out of one account rather than fail loudly.
        if (request.field === "email") {
          const taken = await OfficeEmployeeModel.findOne({
            email: String(value).toLowerCase(),
            delete: false,
            _id: { $ne: employee._id },
          }).lean();
          if (taken) {
            return { success: false, message: "That email is already in use" };
          }
        }

        const before = employee.toObject();
        employee[request.field] =
          request.field === "email" ? String(value).toLowerCase() : value;
        await employee.save();

        recordAudit({
          entityId: String(employee._id),
          before,
          after: employee.toObject(),
          description: `Approved ${meta.label} change for ${
            employee.name || employee._id
          }`,
        });
      }

      request.status = decision;
      request.decidedBy = { _id: user._id, name: user.name || "" };
      request.decidedAt = new Date();
      request.decisionNote = String(note || "").trim();
      await request.save();

      return {
        success: true,
        message: decision === "approved" ? "Applied" : "Rejected",
      };
    } catch (error) {
      console.log("Error deciding profile change request:", error?.message);
      return { success: false, message: "Could not save the decision" };
    }
  },
  { module: "OfficeEmployee" }
);
