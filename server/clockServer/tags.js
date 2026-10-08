"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";
import { getClockTime, getWorkingDate } from "@/lib/clockTime";
import ClockLocationModel from "@/models/clockLocationModel";
import ClockTagModel from "@/models/clockTagModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import SiteAssignmentModel from "@/models/siteAssignmentModel";
import { getServerSideProps } from "../session/session";
import { performClockAction } from "./clockActions";
import {
  normaliseUid,
  recordSighting,
  recordUnknownTag,
  resolveTag,
} from "./clockTagStore";

/**
 * Clocking in by tapping a tag, and managing the tags themselves.
 *
 * The tap is the whole point of this phase: a £1 sticker on a cabin door needs
 * no power, no network at the location and — unlike a QR screen — nobody
 * standing there to hold it. That is what makes a two-person site workable.
 */

async function requireSuperAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { ok: false, message: "Not signed in" };
  if (user.role !== "superAdmin") return { ok: false, message: "Not authorized" };
  return { ok: true, user };
}

/* ------------------------------------------------------------------ tapping */

/**
 * What should the employee see after tapping this tag?
 *
 * Read-only: it resolves the tag and reports what state it is in, so the
 * /clock page can show the right thing — clock actions, an enrolment prompt
 * for a super admin, or a plain explanation.
 */
export async function inspectTag({ uid, picc, cmac } = {}) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user?._id) return { success: false, message: "Not signed in" };

    const resolved = await resolveTag(uid, { picc, cmac });

    // A tag nobody has registered is not an error — it is how a new tag gets
    // enrolled. Only a super admin's tap creates the row, or an employee
    // tapping a stray tag would fill the list with other people's hardware.
    if (resolved.status === "unknown" && user.role === "superAdmin") {
      const created = await recordUnknownTag(uid, { byName: user.name });
      return {
        success: true,
        data: JSON.stringify({
          state: "enrol",
          uid: created?.uid || normaliseUid(uid),
          message: "New tag. Choose where it is mounted.",
        }),
      };
    }

    if (!resolved.ok) {
      return {
        success: true,
        data: JSON.stringify({
          state: resolved.status,
          uid: resolved.uid || null,
          message: resolved.message,
        }),
      };
    }

    const location = await ClockLocationModel.findById(resolved.tag.locationId)
      .select("name kind projectSiteId")
      .lean();

    return {
      success: true,
      data: JSON.stringify({
        state: "ready",
        uid: resolved.tag.uid,
        tagLabel: resolved.tag.label,
        location: location
          ? { _id: String(location._id), name: location.name, kind: location.kind }
          : null,
      }),
    };
  } catch (error) {
    console.log("Error inspecting a tag:", error);
    return { success: false, message: "Could not read that tag" };
  }
}

/**
 * Clock in or out by tapping a tag.
 *
 * The tag is the proof of presence, in place of the QR code's rotating token.
 * Everything after that is shared with the scan path — see
 * server/clockServer/clockActions.js.
 */
export async function storeClockTimeByTag(
  uid,
  action,
  clientEvidence = {},
  signature = {},
) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId || !action) {
      return { success: false, message: "Invalid request" };
    }
    if (!isValidObjectId(employeeId)) {
      return { success: false, message: "Invalid Employee Id" };
    }

    const resolved = await resolveTag(uid, {
      picc: signature?.picc,
      cmac: signature?.cmac,
    });
    if (!resolved.ok) return { success: false, message: resolved.message };

    const tag = resolved.tag;
    const location = await ClockLocationModel.findById(tag.locationId).lean();
    if (!location?._id) {
      return { success: false, message: "This tag is not set up to a location yet." };
    }

    const officeEmployee = await OfficeEmployeeModel.findById(employeeId);
    const employeeType = officeEmployee ? "OfficeEmployee" : "Employee";
    if (!officeEmployee) {
      const siteEmployee = await EmployeModel.findById(employeeId).select("_id");
      if (!siteEmployee) return { success: false, message: "Employee not found" };
    }

    const date = getWorkingDate();
    const currentTime = getClockTime();

    // Tapping a tag at a gate proves you were there; it does not prove you
    // were meant to be. A site's tag is only good for someone rostered to that
    // site that day.
    if (location.projectSiteId) {
      const rostered = await SiteAssignmentModel.findOne({
        assignDate: date,
        siteId: location.projectSiteId,
        "assignedEmployees.employeeId": createObjectId(employeeId),
      })
        .select("_id")
        .lean();
      if (!rostered) {
        return {
          success: false,
          message: "You are not assigned to this site today. Speak to your manager.",
        };
      }
    } else if (!officeEmployee) {
      return {
        success: false,
        message: "This tag is for office staff. Use the tag at your site.",
      };
    }

    const result = await performClockAction({
      employeeId,
      employeeType,
      location,
      siteId: location.projectSiteId || null,
      action,
      date,
      currentTime,
      evidence: {
        method: "nfc",
        coords: clientEvidence?.coords || undefined,
        deviceId: clientEvidence?.deviceId || undefined,
        tagId: String(tag._id),
        tagCounter: resolved.counter ?? undefined,
      },
    });

    // Recorded even when the action was refused: "this tag was tapped from
    // twenty miles away" is worth knowing whether or not the clock-in landed.
    await recordSighting(tag._id, {
      counter: resolved.counter,
      employeeId,
      seenAtLocationId: location._id,
    });

    return result;
  } catch (error) {
    console.log("Error storing clock time by tag:", error);
    return { success: false, message: "Could not record that tap" };
  }
}

/* --------------------------------------------------------------- managing */

/**
 * Every tag. Takes no arguments — `useFetchSelectQuery` passes its AbortSignal
 * as the first argument, and reading a property off that throws on the server.
 */
export async function getClockTags() {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const rows = await ClockTagModel.find({ status: { $ne: "retired" } })
      .sort({ status: 1, label: 1 })
      .populate({ path: "locationId", select: "name kind" })
      .populate({ path: "lastSeenLocationId", select: "name" })
      .lean();

    return { success: true, data: JSON.stringify(rows) };
  } catch (error) {
    console.log("Error loading tags:", error);
    return { success: false, message: "Could not load tags" };
  }
}

/**
 * Bind a tag to a location, or move it to a different one.
 *
 * **Not retroactive.** Clock records written before the move keep the location
 * they were written with — they are a record of where somebody actually was.
 * Rewriting them would re-attribute historical attendance, and therefore pay
 * and CIS, to a site the work never happened on.
 */
export const assignClockTag = withAudit(
  "ClockTag.assign",
  async ({ id, uid, locationId, label, reason } = {}) => {
    try {
      const auth = await requireSuperAdmin();
      if (!auth.ok) return { success: false, message: auth.message };
      if (!locationId || !isValidObjectId(locationId)) {
        return { success: false, message: "Choose a location" };
      }

      await connect();

      const location = await ClockLocationModel.findById(
        createObjectId(locationId),
      )
        .select("name isActive")
        .lean();
      if (!location || location.isActive === false) {
        return { success: false, message: "That location is not available" };
      }

      const query = id
        ? { _id: createObjectId(id) }
        : { uid: normaliseUid(uid) || "__none__" };
      const tag = await ClockTagModel.findOne(query);
      if (!tag) return { success: false, message: "Tag not found" };
      if (tag.status === "retired") {
        return { success: false, message: "A retired tag cannot be reassigned" };
      }

      const before = tag.toObject();
      const moving = String(tag.locationId || "") !== String(location._id);

      tag.locationId = location._id;
      tag.status = "active";
      if (label?.trim()) tag.label = label.trim();
      tag.assignedBy = createObjectId(auth.user._id);
      tag.assignedByName = auth.user.name;
      tag.assignedAt = new Date();
      tag.history.push({
        fromLocationId: before.locationId || null,
        toLocationId: location._id,
        fromStatus: before.status,
        toStatus: "active",
        at: new Date(),
        byName: auth.user.name,
        reason: reason?.trim() || (moving ? "Moved" : "Assigned"),
      });
      await tag.save();

      recordAudit({
        entityId: tag._id,
        before,
        after: tag.toObject(),
        description: `${moving ? "Moved" : "Assigned"} tag "${tag.label}" to ${location.name}`,
      });

      return {
        success: true,
        message: moving
          ? `Moved to ${location.name}. Attendance already recorded stays where it was.`
          : `Assigned to ${location.name}`,
      };
    } catch (error) {
      console.log("Error assigning a tag:", error);
      return { success: false, message: "Could not assign that tag" };
    }
  },
  { module: "ClockTag" },
);

/**
 * Switch a tag off, or back on.
 *
 * Suspension has to be instant and reversible — it is what a manager reaches
 * for when a tag goes missing on a Friday afternoon and nobody yet knows
 * whether it was stolen. Retirement is final: the UID is never re-enrollable.
 */
export const setClockTagStatus = withAudit(
  "ClockTag.status",
  async ({ id, status, reason } = {}) => {
    try {
      const auth = await requireSuperAdmin();
      if (!auth.ok) return { success: false, message: auth.message };
      if (!id || !isValidObjectId(id)) {
        return { success: false, message: "Invalid tag" };
      }
      if (!["active", "suspended", "retired"].includes(status)) {
        return { success: false, message: "Invalid status" };
      }

      await connect();
      const tag = await ClockTagModel.findById(createObjectId(id));
      if (!tag) return { success: false, message: "Tag not found" };
      if (tag.status === "retired") {
        return { success: false, message: "A retired tag cannot be changed" };
      }
      if (status === "active" && !tag.locationId) {
        return { success: false, message: "Assign it to a location first" };
      }

      const before = tag.toObject();
      tag.status = status;
      tag.history.push({
        fromLocationId: tag.locationId || null,
        toLocationId: tag.locationId || null,
        fromStatus: before.status,
        toStatus: status,
        at: new Date(),
        byName: auth.user.name,
        reason: reason?.trim() || status,
      });
      await tag.save();

      recordAudit({
        entityId: tag._id,
        before,
        after: tag.toObject(),
        description: `Tag "${tag.label}" set to ${status}`,
      });

      return { success: true, message: `Tag ${status}` };
    } catch (error) {
      console.log("Error setting tag status:", error);
      return { success: false, message: "Could not update that tag" };
    }
  },
  { module: "ClockTag" },
);
