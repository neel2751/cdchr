"use server";
import { getServerSideProps } from "../session/session";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { connect } from "@/db/db";
import { getClockTime, getWorkingDate } from "@/lib/clockTime";
import {
  consumeClockToken,
  verifyClockToken,
} from "@/server/clockServer/clockTokenStore";
import SiteAssignmentModel from "@/models/siteAssignmentModel";
import { resolveOrCreateLocationForSite } from "@/server/clockServer/clockLocationStore";
import ClockLocationModel from "@/models/clockLocationModel";
import { performClockAction } from "@/server/clockServer/clockActions";

/**
 * The working day and wall-clock time to record a scan against.
 *
 * `date` is UTC midnight of the UK calendar day — the same value every other
 * clock query uses. It used to be a "YYYY-MM-DD" string built by round-tripping
 * UK parts through a server-local Date, which shifted the day either side of
 * midnight; see lib/clockTime.js.
 */
export async function getCurrentTimeAndDate() {
  try {
    return {
      success: true,
      date: getWorkingDate(),
      currentTime: getClockTime(),
    };
  } catch (error) {
    console.error("Error getting UK time:", error);
    return { success: false, message: "Error getting current UK time" };
  }
}

/**
 * May this employee clock in against the place this code was displayed?
 *
 * A site code needs a roster entry for that site on that day — the same
 * assignment `canEmployeeClockToday` reads to decide which site to show the
 * employee, asked the other way round. An office code needs the scanner to be
 * office staff, since a site worker has no business on the office clock.
 */
async function canClockAtLocation({
  employeeId,
  siteId,
  date,
  isOfficeEmployee,
}) {
  if (!siteId) {
    if (!isOfficeEmployee) {
      return {
        ok: false,
        message: "This code is for office staff. Use the code at your site.",
      };
    }
    return { ok: true };
  }

  const assigned = await SiteAssignmentModel.findOne({
    assignDate: date,
    siteId: createObjectId(siteId),
    "assignedEmployees.employeeId": createObjectId(employeeId),
  })
    .select("_id")
    .lean();

  if (!assigned) {
    return {
      ok: false,
      message: "You are not assigned to this site today. Speak to your manager.",
    };
  }
  return { ok: true };
}

/**
 * Record a scan.
 *
 * The site is no longer a parameter. It used to be — the caller passed the
 * token, the site and the action, and only the token's *signature* was ever
 * checked; its payload was discarded. So the site an employee clocked in at
 * was simply whatever their browser claimed, and any unexpired token signed
 * with the app secret unlocked any site. Now the site comes from the code that
 * was scanned, and the code is spent when it is used.
 *
 * The action stays a parameter, deliberately. The reception screen mints a
 * code with no action in it — employees pick what they are doing on their own
 * device — and the action is not a privilege: what someone may do next is
 * fixed by the state of their own record, which checkClockAction enforces.
 */
export async function storeClockTimeNew(token, action, clientEvidence = {}) {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    if (!employeeId || !action)
      return { success: false, message: "Invalid request" };
    if (!isValidObjectId(employeeId))
      return { success: false, message: "Invalid Employee Id" };

    // Checked but not yet spent: a refused action should not cost the employee
    // their code and a trip back to reception.
    const code = await verifyClockToken(token);
    if (!code.ok) return { success: false, message: code.message };

    const codeSiteId = code.siteId;
    const codeLocationId = code.locationId;

    // 1 Detect Employee Type
    let employeeType = "null";
    const officeEmployee = await OfficeEmployeeModel.findById(employeeId);
    if (officeEmployee) employeeType = "OfficeEmployee";
    else employeeType = "Employee";

    if (!employeeType) return { success: false, message: "Employee not found" };

    const { success, date, currentTime } = await getCurrentTimeAndDate();
    if (!success) return { success: false, message: "Error getting time" };

    // The place this happened, taken from the code rather than inferred.
    //
    // Inferring it from the siteId is what made a second office unreachable:
    // an office code carries no site, so every office scan resolved to the
    // default office whichever building the screen was actually standing in.
    // Codes issued before this change have no locationId, so the old inference
    // stays as the fallback and they keep working until they expire — which,
    // at thirty seconds, is almost immediately.
    const location = codeLocationId
      ? await ClockLocationModel.findById(createObjectId(codeLocationId)).lean()
      : await resolveOrCreateLocationForSite(codeSiteId);
    if (!location?._id) {
      return { success: false, message: "This code is not set up to a location." };
    }

    // Scanning the code at a gate proves you were there; it does not prove you
    // were meant to be. A site code is only good for someone rostered to that
    // site that day, which is the same assignment the employee's own screen
    // reads to decide what to show them.
    const permitted = await canClockAtLocation({
      employeeId,
      siteId: location.projectSiteId || null,
      date,
      isOfficeEmployee: Boolean(officeEmployee),
    });
    if (!permitted.ok) return { success: false, message: permitted.message };

    // Everything from here is shared with the NFC path — see
    // server/clockServer/clockActions.js. The code is spent in onBeforeWrite,
    // i.e. last, so a refused action does not cost the employee their code and
    // a trip back to reception.
    return await performClockAction({
      employeeId,
      employeeType,
      location,
      siteId: codeSiteId,
      action,
      date,
      currentTime,
      evidence: {
        method: "deviceQr",
        coords: clientEvidence?.coords || undefined,
        deviceId: clientEvidence?.deviceId || undefined,
        tokenJti: code.jti,
      },
      onBeforeWrite: async () => {
        // One code is one scan, so a photograph of the reception screen is
        // worth nothing to the second person to try it. Two employees who
        // genuinely scan the same code in the same second both get here; only
        // one wins this update.
        const spent = await consumeClockToken(code.jti, employeeId);
        return spent.ok ? { ok: true } : { ok: false, message: spent.message };
      },
    });
  } catch (error) {
    console.error("Error storing clock time:", error);
    return { success: false, message: "Error storing clock time" };
  }
}
