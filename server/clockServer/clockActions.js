/**
 * Writing a clock action, once, for every way of proving you are there.
 *
 * NOT a "use server" module — it is the shared middle of the QR path and the
 * NFC path, both of which are actions in their own right.
 *
 * The two differ only at the ends. A QR scan verifies a rotating code and
 * spends it; a tag tap resolves a sticker and records the sighting. Everything
 * between — which record, is this action legal against it, what evidence, and
 * the four guarded writes — is identical, and duplicating it would mean the
 * next fix to the break state machine landing in one copy and not the other.
 */
import { headers } from "next/headers";

import { connect } from "@/db/db";
import { createObjectId } from "@/lib/mongodb";
import { checkClockAction } from "@/lib/clockRules";
import { getClientIp } from "@/lib/clientIp";
import { evaluateLocation } from "@/lib/locationPolicy";
import ClockRecordModel from "@/models/clockInModel";
import { getClockRules } from "@/server/settingsServer/workSettings";

/**
 * Why someone was turned away, in words they can act on.
 *
 * "Refused by policy" tells a person standing at a gate nothing. Naming the
 * check, and what to do about it, is the difference between a phone call to
 * the office and a shrug.
 */
function refusalMessage(failed) {
  if (failed?.method === "geofence") {
    return (
      "You do not appear to be at this location. If you are, check that " +
      "location access is on for this site, then try again — or ask your " +
      "manager to record it."
    );
  }
  if (failed?.method === "network") {
    return (
      "This can only be used on the office network. Connect to the office " +
      "Wi-Fi and try again, or ask your manager to record it."
    );
  }
  return "This clock-in could not be confirmed here. Ask your manager to record it.";
}

/**
 * Perform one clock action at one location.
 *
 * @param employeeId    the session's employee
 * @param employeeType  "Employee" | "OfficeEmployee"
 * @param location      a ClockLocation document
 * @param siteId        the ProjectSite behind it, if any (still written to the
 *                      record so nothing reading `siteId` breaks mid-migration)
 * @param action        clockIn | breakIn | breakOut | clockOut
 * @param date          the working day, UTC midnight
 * @param currentTime   "HH:mm" in UK time
 * @param evidence      partial clockInEvidence — the caller adds what only it
 *                      knows (a token jti, a tag id), this adds the rest
 * @param onBeforeWrite optional. Runs after every check has passed and before
 *                      the write. Return `{ ok:false, message }` to abort —
 *                      this is where a QR code is spent, so a refused action
 *                      does not cost the employee their code.
 */
export async function performClockAction({
  employeeId,
  employeeType,
  location,
  siteId = null,
  action,
  date,
  currentTime,
  evidence: partialEvidence = {},
  onBeforeWrite,
}) {
  await connect();

  // The one record this acts on. Keyed on the location, matching the unique
  // index — `siteId: null` used to mean "the office", which made two offices
  // one place.
  //
  // isDeleted matters too: a soft-deleted record used to still match, so once
  // one had been deleted the employee could never clock in again that day.
  const recordFilter = {
    employeeId: createObjectId(employeeId),
    date,
    locationId: location._id,
    isDeleted: false,
  };

  let existingRecord = await ClockRecordModel.findOne(recordFilter);

  // ─────────────────────────────────────────────────────────────────────
  // A SHIFT THAT MOVED.
  //
  // Somebody clocks in on the office QR code, drives to a site, finishes
  // there and taps the site's NFC tag on the way home. The record they need
  // is at the OFFICE, and a lookup keyed on this location finds nothing — so
  // the tap was refused with "You must clock in first", leaving them with an
  // open shift they cannot close and no way to fix it from where they stood.
  //
  // A person is on one shift at a time, wherever they started it. So if there
  // is no record here and one is open elsewhere today, that open one IS the
  // shift and this action belongs to it.
  //
  // This also answers the other half correctly without a special case: a tap
  // meaning "clock in" at the site finds the open office record, and
  // checkClockAction says "You are already clocked in" — which is true, and
  // is what somebody mid-shift should be told.
  //
  // A finished shift is deliberately NOT picked up, so an employee who
  // clocked out at the office can still start a genuine second shift at a
  // site later the same day.
  let shiftMovedFrom = null;
  if (!existingRecord) {
    const openElsewhere = await ClockRecordModel.findOne({
      employeeId: createObjectId(employeeId),
      date,
      isDeleted: false,
      clockIn: { $type: "string", $ne: "" },
      $or: [{ clockOut: null }, { clockOut: { $exists: false } }],
    });
    if (openElsewhere) {
      existingRecord = openElsewhere;
      shiftMovedFrom = openElsewhere.locationId;
    }
  }

  const rules = await getClockRules();

  // Is this action legal against the record as it stands? Every rule this used
  // to check compared two "HH:mm" strings by subtracting them, which is NaN,
  // so none of them ever refused anything. See lib/clockRules.js.
  const verdict = checkClockAction(existingRecord, action, currentTime, rules);
  if (!verdict.ok) return { success: false, message: verdict.message };

  // What we know about where this happened. Recorded on every clock-in and
  // judged on none of them yet — Phase B. getClientIp, not the raw header:
  // Caddy appends to whatever the client sent, so the first entry is a value
  // the caller picked. See lib/clientIp.js.
  let evidence = { ...partialEvidence, recordedAt: new Date() };
  try {
    evidence.ip = getClientIp(await headers()) || undefined;
  } catch {
    // No request context (a script, a test). Not a reason to refuse anyone.
  }

  const policy = evaluateLocation(location, evidence);
  evidence = { ...evidence, checks: policy.checks, wouldAllow: policy.wouldAllow };

  // Phase D: a location with a method set to `enforce` now actually refuses.
  //
  // Three things keep this from stranding anybody, and all three matter:
  //
  //   - `enforcing` is false unless a human switched a method to enforce. A
  //     location that is only measuring still records everything and refuses
  //     nothing, which is where every location starts.
  //   - `wouldAllow` is true whenever nothing could be judged (no position, no
  //     address). A control that cannot tell must never be the reason someone
  //     cannot start work — see lib/locationPolicy.js.
  //   - A manager can still record the attendance from the admin screen. That
  //     path is deliberately not gated on this; it is the override, and an
  //     enforced rule without one is a rule that stops work.
  //
  // Clocking OUT is never refused on location. Someone who has clocked in has
  // already been admitted, and refusing to let them close the day would leave
  // an open shift for the nightly job to flag — punishing them for standing in
  // the wrong place at going-home time.
  if (policy.enforcing && !policy.wouldAllow && action !== "clockOut") {
    const failed = policy.checks.find((c) => c.verdict === "fail");
    return {
      success: false,
      message: refusalMessage(failed),
      refusedBy: failed?.method || "location",
    };
  }

  if (onBeforeWrite) {
    const gate = await onBeforeWrite({ evidence, policy });
    if (gate && gate.ok === false) {
      return { success: false, message: gate.message };
    }
  }

  const siteOid = siteId ? createObjectId(siteId) : null;

  // Every write below carries its precondition in the filter rather than
  // trusting the read above. Two taps a second apart both reach this point
  // with the same `existingRecord`; letting Mongo settle it means the loser
  // changes nothing instead of writing a second time over the first.
  if (action === "clockIn") {
    const created = await ClockRecordModel.updateOne(
      recordFilter,
      {
        $setOnInsert: {
          ...recordFilter,
          siteId: siteOid,
          employeeType,
          locationType: siteOid ? "site" : "office",
          clockIn: currentTime,
          status: "checked-in",
          breaks: [],
          clockInEvidence: evidence,
        },
      },
      { upsert: true },
    );

    if (!created.upsertedCount) {
      return { success: false, message: "You are already clocked in." };
    }
    return { success: true, message: "Clocked In", employeeId };
  }

  if (action === "breakIn") {
    const opened = await ClockRecordModel.updateOne(
      {
        _id: existingRecord._id,
        clockOut: null,
        // No break may already be open. `breakOut: null` matches both an
        // explicit null and a missing field, which is how an open break is
        // stored.
        breaks: {
          $not: { $elemMatch: { breakIn: { $ne: null }, breakOut: null } },
        },
      },
      {
        $push: { breaks: { breakIn: currentTime } },
        $set: { status: "on-break" },
      },
    );
    if (!opened.modifiedCount) {
      return { success: false, message: "You must break out first." };
    }
    return { success: true, message: "Break In", employeeId };
  }

  if (action === "breakOut") {
    const closed = await ClockRecordModel.updateOne(
      {
        _id: existingRecord._id,
        clockOut: null,
        breaks: { $elemMatch: { breakIn: { $ne: null }, breakOut: null } },
      },
      { $set: { "breaks.$[open].breakOut": currentTime, status: "checked-in" } },
      { arrayFilters: [{ "open.breakIn": { $ne: null }, "open.breakOut": null }] },
    );
    if (!closed.modifiedCount) {
      return { success: false, message: "You must break in first." };
    }
    return { success: true, message: "Break Out", employeeId };
  }

  if (action === "clockOut") {
    // Someone who forgot to break back in is still allowed to go home. Their
    // break is NOT closed at the clock-out time — a break opened at 12:00 and
    // a clock-out at 17:00 would become a five-hour break, costing them the
    // whole afternoon's pay for a forgotten tap. Nor is it closed at some
    // invented length. It is left open, the record is flagged, and a manager
    // settles it before payroll.
    const openBreak = (existingRecord.breaks || []).find(
      (b) => b?.breakIn && !b?.breakOut,
    );

    const finished = await ClockRecordModel.updateOne(
      { _id: existingRecord._id, clockOut: null },
      {
        $set: {
          clockOut: currentTime,
          status: "clocked-out",
          // Where they actually finished, when that is not where they
          // started. The hours stay on the record they belong to — the shift
          // began at the first place — but "clocked out at Elm Street" is the
          // difference between a report somebody can read and one that looks
          // wrong.
          ...(shiftMovedFrom &&
          String(shiftMovedFrom) !== String(location._id)
            ? {
                clockOutLocationId: location._id,
                clockOutEvidence: evidence,
              }
            : {}),
          ...(openBreak
            ? {
                needsReview: true,
                reviewReason: `A break started at ${openBreak.breakIn} was never ended.`,
              }
            : {}),
        },
      },
    );
    if (!finished.modifiedCount) {
      return { success: false, message: "You have already clocked out today." };
    }

    return {
      success: true,
      message: openBreak
        ? `Clocked Out — your break from ${openBreak.breakIn} was never ended, so your manager will confirm it.`
        : "Clocked Out",
      employeeId,
    };
  }

  return { success: false, message: "Unknown action." };
}
