"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { getClockTime, getWorkingDate, toWorkingDate } from "@/lib/clockTime";
import ClockLocationModel from "@/models/clockLocationModel";
import ClockRecordModel from "@/models/clockInModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import SiteAssignmentModel from "@/models/siteAssignmentModel";
import { getServerSideProps } from "../session/session";
import { performClockAction } from "./clockActions";
import { recordSighting, resolveTag } from "./clockTagStore";

/**
 * Replaying clock actions taken with no signal.
 *
 * The hard part is not the queue. It is that a queued tap carries a time the
 * phone chose, and every other time in this system is derived on the server
 * precisely so it cannot be. Someone can wind their clock back and queue a
 * seven o'clock start at nine.
 *
 * Three things are done about that, and none of them is "trust it":
 *
 *   BOUNDED. A tap claiming to be older than MAX_OFFLINE_AGE_HOURS, or in the
 *   future at all, is refused outright. A day is long enough for a genuine
 *   dead-signal shift and short enough that nobody backfills a week.
 *
 *   FLAGGED, always. Every record made this way carries needsReview, whatever
 *   its drift, so it reaches the Needs Attention report and a human confirms
 *   it. Not an accusation — a confirmation.
 *
 *   RECORDED. The claimed time, the moment it actually arrived, and the gap
 *   between them are all stored, so "clocked in at 07:00, reached us at 09:14"
 *   is a thing an admin can read rather than infer.
 *
 * What is NOT weakened: the tag still has to verify. An NTAG 424 DNA chip
 * signs and counts offline exactly as it does online, so a queued tap arrives
 * with a real signature and a real counter. Offline changes when we heard
 * about a tap, not whether it happened.
 */

/** A day: long enough for a real outage, short enough to stop backfilling. */
const MAX_OFFLINE_AGE_HOURS = 24;

/** Clocks are never exactly right. A few minutes either way is not a claim. */
const TOLERATED_FUTURE_MINUTES = 5;

/** The most entries one sync may carry, so a bad client cannot flood a write. */
const MAX_BATCH = 50;

function describeDrift(minutes) {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h} hour${h === 1 ? "" : "s"}`;
}

/**
 * Replay a batch of queued taps.
 *
 * Returns one result per entry, in order, so the client knows which to drop.
 * A refusal is still a decision: the client clears those too, or a tap the
 * server has already said no to would be retried for ever.
 */
export async function syncOfflineTaps(entries = []) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId || !isValidObjectId(employeeId)) {
      return { success: false, message: "Not signed in" };
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return { success: true, results: [] };
    }
    if (entries.length > MAX_BATCH) {
      return { success: false, message: "Too many queued actions at once" };
    }

    await connect();

    const officeEmployee = await OfficeEmployeeModel.findById(employeeId);
    const employeeType = officeEmployee ? "OfficeEmployee" : "Employee";
    if (!officeEmployee) {
      const siteEmployee = await EmployeModel.findById(employeeId).select("_id");
      if (!siteEmployee) {
        return { success: false, message: "Employee not found" };
      }
    }

    const syncedAt = new Date();
    const results = [];

    // Oldest first. Out of order, a later tap's counter would land before an
    // earlier one's and the earlier would then read as a replay.
    const ordered = [...entries].sort(
      (a, b) => new Date(a.capturedAt || 0) - new Date(b.capturedAt || 0),
    );

    for (const entry of ordered) {
      results.push(
        await replayOne({ entry, employeeId, employeeType, officeEmployee, syncedAt }),
      );
    }

    return { success: true, results };
  } catch (error) {
    console.log("Error syncing offline taps:", error);
    return { success: false, message: "Could not sync those clock actions" };
  }
}

async function replayOne({ entry, employeeId, employeeType, officeEmployee, syncedAt }) {
  const refuse = (message) => ({ success: false, message });

  const { uid, action, capturedAt, evidence = {}, signature = {} } = entry || {};
  if (!uid || !action) return refuse("That queued action could not be read.");

  const claimed = capturedAt ? new Date(capturedAt) : null;
  if (!claimed || Number.isNaN(claimed.getTime())) {
    return refuse("That queued action had no usable time.");
  }

  // --- the bound -----------------------------------------------------------
  const driftMs = syncedAt.getTime() - claimed.getTime();
  const driftMinutes = Math.round(driftMs / 60000);

  if (driftMinutes < -TOLERATED_FUTURE_MINUTES) {
    // A clock-in from the future is not a signal problem.
    return refuse("That clock action is dated in the future and was not saved.");
  }
  if (driftMinutes > MAX_OFFLINE_AGE_HOURS * 60) {
    return refuse(
      `That clock action is more than ${MAX_OFFLINE_AGE_HOURS} hours old and was not saved. Ask your manager to record it.`,
    );
  }

  // --- the tag still has to be real ---------------------------------------
  const resolved = await resolveTag(uid, {
    picc: signature?.picc,
    cmac: signature?.cmac,
  });
  if (!resolved.ok) return refuse(resolved.message);

  const location = await ClockLocationModel.findById(resolved.tag.locationId).lean();
  if (!location?._id) return refuse("That tag is not set up to a location.");

  // --- rostered, on the day they say they worked ---------------------------
  const date = toWorkingDate(claimed) || getWorkingDate();
  if (location.projectSiteId) {
    const rostered = await SiteAssignmentModel.findOne({
      assignDate: date,
      siteId: location.projectSiteId,
      "assignedEmployees.employeeId": createObjectId(employeeId),
    })
      .select("_id")
      .lean();
    if (!rostered) {
      return refuse("You were not assigned to this site that day.");
    }
  } else if (!officeEmployee) {
    return refuse("That tag is for office staff.");
  }

  // The time the action is recorded at is the one the phone claimed — that is
  // the whole point of queueing it — expressed as UK wall-clock.
  const currentTime = getClockTime(claimed);

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
      coords: evidence?.coords || undefined,
      deviceId: evidence?.deviceId || undefined,
      tagId: String(resolved.tag._id),
      tagCounter: resolved.counter ?? undefined,
    },
  });

  await recordSighting(resolved.tag._id, {
    counter: resolved.counter,
    employeeId,
    seenAtLocationId: location._id,
  });

  // --- the flag ------------------------------------------------------------
  //
  // Applied after the write and to whichever record the action touched, so a
  // break or a clock-out flags the same day's record rather than creating a
  // parallel one. Always, regardless of drift: the point is that a human
  // confirms a time nobody could verify, not that a big number is suspicious.
  if (result.success) {
    await ClockRecordModel.updateOne(
      {
        employeeId: createObjectId(employeeId),
        date,
        locationId: location._id,
        isDeleted: false,
      },
      {
        $set: {
          needsReview: true,
          reviewReason:
            `Recorded offline and synced later: the device said ` +
            `${currentTime}, and it reached us ${describeDrift(Math.max(0, driftMinutes))} afterwards.`,
          offlineCapturedAt: claimed,
          offlineSyncedAt: syncedAt,
          offlineDriftMinutes: Math.max(0, driftMinutes),
        },
      },
    );
  }

  return result;
}
