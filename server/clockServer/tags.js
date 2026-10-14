"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";
import { getClockTime, getWorkingDate } from "@/lib/clockTime";
import { tapStage } from "@/lib/clockRules";
import ClockLocationModel from "@/models/clockLocationModel";
import ClockTagModel from "@/models/clockTagModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import SiteAssignmentModel from "@/models/siteAssignmentModel";
import { getClockRules } from "../settingsServer/workSettings";
import { getServerSideProps } from "../session/session";
import { findActionRecord, performClockAction } from "./clockActions";
import {
  normaliseUid,
  recordRefusedTap,
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
export async function inspectTag({ uid, ctr, picc, cmac } = {}) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user?._id) return { success: false, message: "Not signed in" };

    const resolved = await resolveTag(uid, { picc, cmac, counter: ctr });

    // A CHIP THAT SIGNS ITSELF IS NOT ENROLLED BY TAPPING IT.
    //
    // A tap carrying picc and cmac is an NTAG 424 DNA mirroring its encrypted
    // UID and a signature over it. Those are only checkable against the key the
    // chip holds, and that key lives on the order it was provisioned against,
    // not in the customer's company — so enrolling here would create a ClockTag
    // with no keyRef, and resolveTag skips signature checking entirely when
    // there is no key. The tag would start working, with its replay protection
    // silently switched off: the one property a 424 costs extra for.
    //
    // So it is refused, and the sentence says who can finish it. The honest
    // answer, because the customer cannot fix this from any screen they have.
    if (resolved.status === "unknown" && picc && cmac) {
      return {
        success: true,
        data: JSON.stringify({
          state: "unregistered",
          uid: normaliseUid(uid),
          message:
            "This tag was programmed but never registered. Whoever supplied " +
            "it has to record its id before it can be used — it cannot be set " +
            "up from here, because its security key is held with the order.",
        }),
      };
    }

    // A tag with nowhere to be is a super admin's job, and the tap is where
    // they are standing — in front of the door it is stuck to.
    //
    // TWO STATES REACH THE SAME PICKER, which they did not before. "unknown"
    // is a stray tag being adopted. "unassigned" is the normal end of
    // provisioning: a tag we wrote, keyed and verified arrives at the customer
    // bound to no location, and the only screen that could bind it was a
    // settings page three menus deep. Tapping it — the obvious thing to do,
    // while holding the phone against it — gave a dead "this tag cannot be
    // used", which is a strange thing to tell the one person who can fix it.
    const needsLocation =
      resolved.status === "unknown" || resolved.status === "unassigned";
    if (needsLocation && user.role === "superAdmin") {
      // Only the unknown case creates anything. An unassigned tag already
      // exists, and recording it again would overwrite the keyRef that
      // provisioning attached — the one thing that makes its taps verifiable.
      const tagUid =
        resolved.status === "unknown"
          ? (await recordUnknownTag(uid, { byName: user.name }))?.uid ||
            normaliseUid(uid)
          : resolved.tag.uid;

      return {
        success: true,
        data: JSON.stringify({
          state: "enrol",
          uid: tagUid,
          existing: resolved.status === "unassigned",
          label: resolved.tag?.label || "",
          message:
            resolved.status === "unassigned"
              ? "This tag is ready but not placed yet. Choose where it is mounted."
              : "New tag. Choose where it is mounted.",
        }),
      };
    }

    if (!resolved.ok) {
      // Kept, so "the tag does not work" is answerable. A tap that never
      // arrived and a tap that arrived and was turned away have the same
      // symptom and completely different fixes; without this, telling them
      // apart means guessing. Where there is no tag row to attach it to, the
      // raw value goes to the log instead — it is the whole evidence.
      if (resolved.tag?._id) {
        await recordRefusedTap(resolved.tag._id, {
          reason: resolved.status,
          rawTag: uid,
          hadSignature: Boolean(picc && cmac),
          byName: user.name,
        });
      } else {
        console.log(
          `[tag] refused tap: status=${resolved.status} tag=${JSON.stringify(
            String(uid ?? "").slice(0, 120)
          )} signed=${Boolean(picc && cmac)}`
        );
      }

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

    // WHAT THIS TAP MEANS, decided here rather than on the screen.
    //
    // A chip carries no intent — it is the same URL every time — so the tap has
    // to work out for itself whether it is the start of a shift, the end of a
    // break or the end of the day. That answer depends on the record, which
    // lives here; the screen used to render all four actions and let the write
    // refuse three of them, which is how somebody who had not clocked in was
    // offered End Break. See lib/clockRules.js tapStage.
    //
    // Best-effort: a stage that cannot be worked out leaves `tap` null and the
    // screen falls back to offering the actions, because a tap that shows
    // nothing is worse than a tap that asks.
    let tap = null;
    try {
      const { record } = await findActionRecord({
        employeeId: user._id,
        date: getWorkingDate(),
        locationId: location?._id || resolved.tag.locationId,
      });
      tap = tapStage(record, getClockTime(), await getClockRules());
    } catch (error) {
      console.log("Could not work out what this tap means:", error?.message);
    }

    return {
      success: true,
      data: JSON.stringify({
        state: "ready",
        uid: resolved.tag.uid,
        tagLabel: resolved.tag.label,
        location: location
          ? { _id: String(location._id), name: location.name, kind: location.kind }
          : null,
        tap,
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
      counter: signature?.ctr,
    });
    if (!resolved.ok) {
      // Same reasoning as inspectTag: a refused tap that leaves no trace is
      // why "it does not work" took days to answer.
      if (resolved.tag?._id) {
        await recordRefusedTap(resolved.tag._id, {
          reason: resolved.status,
          rawTag: uid,
          hadSignature: Boolean(signature?.picc && signature?.cmac),
          byName: props?.session?.user?.name,
        });
      }
      return { success: false, message: resolved.message };
    }

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
        // Whether the chip proved itself, kept with the record rather than
        // inferred later from the tag. A tag can be switched between signing
        // and not signing, so the tag's setting today says nothing about what
        // a tap last March proved — and "was this record backed by a signature"
        // is exactly the question a disputed timesheet asks.
        tagSigned: resolved.signed === true,
        // And whether this tap was single-use. Without a counter the chip
        // sends the same URL every time, so the record cannot claim to be one
        // physical tap — it could be a reload of an earlier one. Stored beside
        // tagSigned for the same reason: the tag's setting today says nothing
        // about what a tap last March could prove.
        tagCounted: resolved.counted === true,
      },
    });

    // Recorded even when the action was refused: "this tag was tapped from
    // twenty miles away" is worth knowing whether or not the clock-in landed.
    await recordSighting(tag._id, {
      counter: resolved.counter,
      // Spent whether or not the action landed. A tap is one use of the tag,
      // and letting a refused attempt hand the URL back would mean a refusal
      // could be retried from the browser instead of from the wall.
      nonce: resolved.nonce,
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
      // Never the key reference, for the same reason the provisioning queue
      // excludes it: it is sealed, not plaintext, but a settings screen has no
      // use for it and a sealed blob plus a leaked master key is a working tag.
      .select("-keyRef -usedTapIds")
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
      // Moving means it was somewhere BEFORE. Comparing "" against the new id
      // made every first assignment a move, so a tag fresh out of its packet
      // was reported as "Moved to London Office. Attendance already recorded
      // stays where it was." — about a tag that has never recorded anything,
      // and the one sentence that would matter if it had.
      const moving =
        Boolean(before.locationId) &&
        String(before.locationId) !== String(location._id);

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
