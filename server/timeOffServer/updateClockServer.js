"use server";
import {
  createObjectId,
  isValidObjectId,
  withTransaction,
} from "@/lib/mongodb";
import SiteAssignmentModel from "@/models/siteAssignmentModel";
import { getServerSideProps } from "../session/session";
import ClockRecordModel from "@/models/clockInModel";
import { connect } from "@/db/db";

import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import { calculateDurationNew, formatMinutesNew } from "@/lib/utils";
import { getClockTime, getWorkingDate, toWorkingDate } from "@/lib/clockTime";
import { validateShift } from "@/lib/clockRules";
import { deriveClockStatus } from "@/lib/clockStatus";
import { getClockRules } from "@/server/settingsServer/workSettings";
import { canManageAttendance } from "@/server/clockServer/clockAuth";
import { resolveOrCreateLocationForSite } from "@/server/clockServer/clockLocationStore";
import { withAudit, recordAudit } from "@/lib/audit";
import { logCsvExport } from "@/server/auditServer/exportAudit";

/**
 * The two values `ClockRecord.employeeType` is allowed to hold.
 *
 * Callers have historically passed "site"/"office" (the location wording) as
 * well as the model names, and the report only matches "OfficeEmployee" — so
 * both spellings are accepted and anything else becomes null rather than being
 * written through.
 */
function normaliseEmployeeType(value) {
  switch (value) {
    case "OfficeEmployee":
    case "office":
      return "OfficeEmployee";
    case "Employee":
    case "site":
      return "Employee";
    default:
      return null;
  }
}

/**
 * Find an employee in whichever collection holds them.
 *
 * Returns `{ type, name }` with the enum value the clock record wants, or
 * nulls when the id matches neither — a missing name is cosmetic in the audit
 * log, so this never throws.
 */
async function resolveEmployee(employeeId) {
  const empty = { type: null, name: "" };
  if (!employeeId || !isValidObjectId(employeeId)) return empty;

  try {
    const oid = createObjectId(employeeId);

    const office = await OfficeEmployeeModel.findById(oid)
      .select("name")
      .lean();
    if (office) return { type: "OfficeEmployee", name: office.name || "" };

    const site = await EmployeModel.findById(oid)
      .select("firstName lastName")
      .lean();
    if (site) {
      return {
        type: "Employee",
        name: `${site.firstName || ""} ${site.lastName || ""}`.trim(),
      };
    }

    return empty;
  } catch {
    return empty;
  }
}

export const updateClockManuallyByIdNew = withAudit(
  "Clock.update",
  async ({
    id = null,
    employeeId,
    siteId = null,
    date,
    clockIn,
    clockOut,
    breaks = [], // now supports multiple breaks
    actions = [],
    employeeType = null,
  }) => {
    try {
      await connect();

    // These times feed pay. Until now this action had no authorisation at all:
    // a server action is an HTTP endpoint, and the only thing resembling a gate
    // was a role array on a menu entry, which gates a link and nothing else.
    const permitted = await canManageAttendance();
    if (!permitted.ok) {
      return { success: false, message: permitted.reason };
    }

    if (!id && (!employeeId || !date)) {
      return {
        success: false,
        message: "Either Clock ID or (employeeId + date) is required",
      };
    }

    if (siteId && !isValidObjectId(siteId)) {
      return { success: false, message: "Invalid siteId" };
    }

    const updateFields = {};

    // set individual fields if provided
    if (clockIn !== undefined) updateFields.clockIn = clockIn;
    if (clockOut !== undefined) updateFields.clockOut = clockOut;
    // `status` is deliberately NOT taken from the caller. It is a cache of
    // clockIn/clockOut/breaks, and it is recomputed from the merged result
    // below — see lib/clockStatus.js for why five writers each having their
    // own vocabulary stopped being survivable.

    // `Array.isArray` rather than `length > 0`: the old condition meant an
    // empty array was ignored, so deleting the last break row in the editor
    // silently saved nothing and the break came back on the next render.
    if (Array.isArray(breaks)) {
      updateFields.breaks = breaks
        .map((b) => ({
          breakIn:
            typeof b?.breakIn === "string" ? b.breakIn.trim() : b?.breakIn,
          breakOut:
            typeof b?.breakOut === "string" ? b.breakOut.trim() : b?.breakOut,
        }))
        // Ignore fully empty rows from UI editors
        .filter((b) => Boolean(b.breakIn || b.breakOut));
    }

    // `employeeType` is what the attendance report splits office staff from
    // site staff on, and this used to overwrite it on every edit with whatever
    // the caller passed — defaulting to "site", which is not one of the two
    // values the report looks for. Editing an office employee's times silently
    // dropped them out of the office bucket. The enum is also unenforced here:
    // findOneAndUpdate does not run validators, so the bad value stuck.
    //
    // Now: an unrecognised value is ignored rather than written, and the type
    // is only ever *set on insert*, resolved from the employee themselves.
    const requestedType = normaliseEmployeeType(employeeType);

    const updateQuery = { $set: updateFields };
    if (actions?.length > 0) {
      updateQuery.$push = { actions: { $each: actions } };
    }

    // The day the record belongs to, read the same way everywhere else. The
    // caller's value used to go through `new Date(date)` unchecked, so a
    // date-only string picked up the server's timezone offset.
    const normalizedDate = id ? null : toWorkingDate(date);
    if (!id && !normalizedDate) {
      return { success: false, message: "Invalid date" };
    }

    // An insert has to know the employee before it writes, because that is
    // what decides employeeType — looking them up beats trusting the caller,
    // which is what put "site" in the field in the first place. An edit can
    // wait until after, where the record's own employeeId is available as a
    // fallback. Either way it is one lookup.
    const employeeForInsert = id ? null : await resolveEmployee(employeeId);

    // The place, resolved the same way the scanner resolves it, so a record
    // created by an admin and one created by a scan land on the same location.
    const location = id ? null : await resolveOrCreateLocationForSite(siteId);
    if (!id && !location?._id) {
      return { success: false, message: "That site has no clock-in location." };
    }

    // Read the record first, so the edit can be judged as a whole shift rather
    // than field by field. An admin changing only the clock out still needs
    // the stored clock in and breaks for "does this hang together".
    const beforeDoc = id
      ? await ClockRecordModel.findById(createObjectId(id)).lean()
      : await ClockRecordModel.findOne({
          employeeId: createObjectId(employeeId),
          date: normalizedDate,
          locationId: location._id,
          isDeleted: false,
        }).lean();

    // 👉 ADD DUPLICATE CHECK HERE 👇👇👇
    if (!id && beforeDoc) {
      return {
        success: false,
        message: "Clock record for this employee on this date already exists.",
      };
    }
    // 👉 END DUPLICATE CHECK

    if (id && !beforeDoc) {
      return { success: false, message: "Clock record not found" };
    }

    // What the record will look like once this update lands. Validating the
    // merge rather than the payload is the only way a partial edit can be
    // checked at all: `{ clockOut: "08:00" }` says nothing on its own.
    const resulting = {
      clockIn:
        updateFields.clockIn !== undefined
          ? updateFields.clockIn
          : beforeDoc?.clockIn,
      clockOut:
        updateFields.clockOut !== undefined
          ? updateFields.clockOut
          : beforeDoc?.clockOut,
      breaks:
        updateFields.breaks !== undefined
          ? updateFields.breaks
          : beforeDoc?.breaks || [],
    };

    const rules = await getClockRules();
    const { ok, errors } = validateShift(
      resulting,
      {
        date: beforeDoc?.date || normalizedDate,
        today: getWorkingDate(),
        now: getClockTime(),
      },
      rules,
    );
    if (!ok) {
      // Every problem at once: an admin fixing a row should not have to save
      // four times to be told about four things.
      return { success: false, message: errors.join(". ") };
    }

    const derivedStatus = deriveClockStatus(resulting);
    if (derivedStatus) updateFields.status = derivedStatus;

    let updatedDoc;

    if (id) {
      // update by ID directly
      updatedDoc = await ClockRecordModel.findByIdAndUpdate(
        createObjectId(id),
        updateQuery,
        { new: true },
      );
    } else {
      // update or insert by employeeId + date (+ optional siteId)
      const query = {
        employeeId: createObjectId(employeeId),
        date: normalizedDate,
        locationId: location._id,
      };

      const insertType = employeeForInsert?.type || requestedType;

      updatedDoc = await ClockRecordModel.findOneAndUpdate(
        query,
        {
          ...updateQuery,
          $setOnInsert: {
            employeeId: createObjectId(employeeId),
            date: normalizedDate,
            locationId: location._id,
            ...(siteId ? { siteId: createObjectId(siteId) } : { siteId: null }),
            ...(insertType ? { employeeType: insertType } : {}),
          },
        },
        { new: true, upsert: true },
      );
    }

    if (!updatedDoc) {
      return { success: false, message: "Failed to update or create record" };
    }

    const empIdForName = employeeId || updatedDoc?.employeeId;
    const employee = employeeForInsert ?? (await resolveEmployee(empIdForName));
    const employeeName = employee.name;
    const auditType =
      updatedDoc.employeeType || employee.type || "attendance";

    recordAudit({
      entityId: updatedDoc._id,
      before: beforeDoc,
      after: updatedDoc.toObject ? updatedDoc.toObject() : updatedDoc,
      description: `${id ? "Edited" : "Created"} ${auditType} attendance time for ${
        employeeName || empIdForName
      }`,
    });

    return {
      success: true,
      message: id
        ? "Clock record updated successfully"
        : "Clock record created successfully",
      // data: updatedDoc,
    };
    } catch (err) {
      console.error("Error in updateClockManuallyById:", err);
      return { success: false, message: "Error updating or creating clock" };
    }
  },
  { module: "Clock" },
);

export const moveEmployeeToNewSite = withAudit(
  "SiteAssignment.moveEmployee",
  async ({ employeeId, toSiteId, date }) => {
    // Moving someone between sites rewrites which job their hours land on, so
    // it needs the same permission as editing the hours themselves.
    const permitted = await canManageAttendance();
    if (!permitted.ok) {
      return { success: false, message: permitted.reason };
    }

    let movedFromSiteId = null;
    const result = await withTransaction(async (session) => {
    const { props } = await getServerSideProps();
    const movedBy = props?.session?.user?._id;
    const assignDate = new Date(date);
    const eid = createObjectId(employeeId);
    const toSid = createObjectId(toSiteId);

    // Step 1: Find current assignment based on employeeId and date
    const fromAssignment = await SiteAssignmentModel.findOne({
      assignDate,
      "assignedEmployees.employeeId": eid,
    }).session(session);

    if (!fromAssignment) {
      throw new Error("Employee is not assigned on this date.");
    }

    const fromSiteId = fromAssignment.siteId;
    movedFromSiteId = fromSiteId;
    const assignedEmployee = fromAssignment.assignedEmployees.find((e) =>
      e.employeeId.equals(eid),
    );

    if (assignedEmployee?.isLocked) {
      throw new Error("Employee is locked (already clocked in), cannot move.");
    }

    // Step 2: Check if already assigned to target site
    const toAssignmentExists = await SiteAssignmentModel.findOne({
      siteId: toSid,
      assignDate,
      "assignedEmployees.employeeId": eid,
    }).session(session);

    if (toAssignmentExists) {
      throw new Error(
        "Employee is already assigned to the target site on this date.",
      );
    }
    // Step 3: Remove employee from the current site assignment
    await SiteAssignmentModel.updateOne(
      { siteId: fromSiteId, assignDate },
      { $pull: { assignedEmployees: { employeeId: eid } } },
      { session },
    );

    // Step 4: Add to new site (safe insert/update)
    const existingTargetDoc = await SiteAssignmentModel.findOne({
      siteId: toSid,
      assignDate,
    }).session(session);

    if (existingTargetDoc) {
      await SiteAssignmentModel.updateOne(
        { siteId: toSid, assignDate },
        {
          $push: {
            assignedEmployees: {
              employeeId: eid,
              assignedBy: movedBy,
              assignedAt: new Date(),
              isLocked: false,
            },
          },
        },
        { session },
      );
    } else {
      const newAssignment = new SiteAssignmentModel({
        siteId: toSid,
        assignDate,
        assignedEmployees: [
          {
            employeeId: eid,
            assignedBy: movedBy,
            assignedAt: new Date(),
            isLocked: false,
          },
        ],
      });
      await newAssignment.save({ session });
    }

    // Step 5: Verify move
    const afterMoveCheck = await SiteAssignmentModel.findOne({
      siteId: toSid,
      assignDate,
      "assignedEmployees.employeeId": eid,
    }).session(session);

    if (!afterMoveCheck) {
      throw new Error("Failed to move employee to target site.");
    }

    // Step 6: move any clock record for that day to the new site.
    //
    // This wrote to `siteclocks`, which nothing has read or written since the
    // app moved to clockrecords — so moving an employee left their actual
    // clock record pointing at the old site, and their hours stayed on the
    // wrong job. Scoped to live records: a deleted one should stay where it
    // was, as a record of what happened.
    await ClockRecordModel.updateMany(
      { employeeId: eid, date: assignDate, isDeleted: false },
      { $set: { siteId: toSid } },
      { session },
    );
    return { success: true, message: "Employee moved successfully." };
    });

    if (result?.success) {
      recordAudit({
        entityId: employeeId,
        before: { employeeId, siteId: movedFromSiteId, date },
        after: { employeeId, siteId: toSiteId, date },
        description: `Moved employee ${employeeId} from site ${movedFromSiteId} to site ${toSiteId} on ${date}`,
      });
    }

    return result;
  },
  { module: "SiteAssignment" },
);

export async function reportAllAttendanceData() {
  try {
    await connect();

    // 1. Fetch all clock records
    const logs = await ClockRecordModel.find({ isDeleted: false }).lean();

    // 2. Fetch both employee types to build a master name map
    const [fieldStaff, officeStaff] = await Promise.all([
      EmployeModel.find({}, "firstName").lean(),
      OfficeEmployeeModel.find({}, "name").lean(),
    ]);

    const nameMap = {};
    fieldStaff.forEach((e) => (nameMap[e._id.toString()] = e.firstName));
    officeStaff.forEach((e) => (nameMap[e._id.toString()] = e.name));

    // let grandShiftMinutes = 0;
    // let grandBreakMinutes = 0;
    // let grandWorkMinutes = 0;

    // 3. Define CSV Headers
    const headers = [
      "Employee Name",
      "Type",
      "Location Type",
      "Date",
      "Clock In",
      "Breaks (In-Out)",
      "Clock Out",
      "Total Shift Time",
      "Total Break Time",
      "Final Work Hours",
      "Status",
    ];

    // 4. Format the Rows
    const rows = logs.map((log) => {
      const name = nameMap[log.employeeId?.toString()] || "Unknown";

      const shiftMinutes = calculateDurationNew(log.clockIn, log.clockOut);

      let totalBreakMinutes = 0;
      if (log.breaks && log.breaks.length > 0) {
        log.breaks.forEach((b) => {
          totalBreakMinutes += calculateDurationNew(b.breakIn, b.breakOut);
        });
      }

      const finalWorkMinutes = shiftMinutes - totalBreakMinutes;

      // grandShiftMinutes += shiftMinutes;
      // grandBreakMinutes += totalBreakMinutes;
      // grandWorkMinutes += finalWorkMinutes;

      // Flatten the breaks array into a single string for the CSV cell
      // e.g., "12:00-12:30 | 15:00-15:15"
      const breaksString = log.breaks
        ? log.breaks
            .map((b) => `${b.breakIn || ""}-${b.breakOut || ""}`)
            .join(" | ")
        : "";

      return [
        `"${name}"`, // Wrapped in quotes in case of commas in names
        log.employeeType,
        log.locationType,
        log.date ? new Date(log.date).toISOString().split("T")[0] : "",
        log.clockIn,
        `"${breaksString}"`, // Wrapped in quotes to handle the "|" or potential commas
        log.clockOut || "",
        formatMinutesNew(shiftMinutes),
        formatMinutesNew(totalBreakMinutes),
        formatMinutesNew(finalWorkMinutes),
        log.status || "",
      ];
    });

    // const totalRow = [
    //   "TOTAL",
    //   "",
    //   "",
    //   "",
    //   "",
    //   "",
    //   "",
    //   formatMinutesNew(grandShiftMinutes),
    //   formatMinutesNew(grandBreakMinutes),
    //   formatMinutesNew(grandWorkMinutes),
    //   "",
    // ];

    // 5. Build CSV Content
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.join(",")),
      // totalRow.join(","),
    ].join("\n");

    // 6. Return Response
    await logCsvExport({
      source: "attendanceExportAll",
      label: "All attendance",
      rowCount: rows.length,
    });
    return {
      success: true,
      data: csvContent,
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: "Failed to export attendance data",
    };
  }
}

