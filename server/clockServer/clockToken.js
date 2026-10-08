"use server";

import { randomUUID } from "node:crypto";
import qrcode from "qrcode";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import ClockLocationModel from "@/models/clockLocationModel";
import ClockTokenModel from "@/models/clockTokenModel";
import { getServerSideProps } from "../session/session";
import { TOKEN_TTL_SECONDS, signClockToken } from "./clockTokenStore";
import {
  ensureDefaultLocation,
  resolveOrCreateLocationForSite,
} from "./clockLocationStore";

/**
 * Putting a clock-in code on a reception screen.
 *
 * The code says one thing: *someone was in front of this screen, at this site,
 * within the last thirty seconds*. It does not say who — that is the scanning
 * employee's own session — and it does not say what they are doing. The
 * reception screen mints a code with no action in it at all, because the
 * employee chooses the action on their own device afterwards; that choice is
 * bounded by the record's own state (you cannot clock in twice, or break out
 * without breaking in) rather than by the code.
 *
 * What the code must therefore carry, and what was previously taken on trust
 * from the client, is the *site*. Reading it from the redeemed row is the
 * difference between "I scanned the code at the Elm Street gate" and "I typed
 * Elm Street into a request from my sofa".
 *
 * Reading and spending codes lives in ./clockTokenStore.js, which is not a
 * "use server" module — those functions must not be callable from a browser.
 */

const QR_OPTIONS = {
  errorCorrectionLevel: "M",
  margin: 1,
  width: 220,
};

/** Roles that may put a clock-in code on screen. */
const CAN_ISSUE = new Set(["reception", "admin", "superAdmin"]);

/**
 * Put a new code on the reception screen.
 *
 * @param siteId the site this screen stands at, or null/undefined for an
 *               office reception — which is what makes a scan against it an
 *               office record rather than a site one.
 */
export async function issueClockToken({ siteId = null, locationId = null } = {}) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user?._id) return { success: false, message: "Not signed in" };
    if (!CAN_ISSUE.has(user.role)) {
      return { success: false, message: "Not authorized to display a code" };
    }
    if (siteId && !isValidObjectId(siteId)) {
      return { success: false, message: "Invalid site" };
    }
    if (locationId && !isValidObjectId(locationId)) {
      return { success: false, message: "Invalid location" };
    }

    await connect();

    // Which place is this screen standing in?
    //
    // A caller naming a location wins; a site screen resolves through its
    // site; and only a screen that names neither falls back to the default
    // office. That fallback used to be the *only* behaviour for an office,
    // which is why a second office could never receive a clock-in.
    let location = null;
    if (locationId) {
      location = await ClockLocationModel.findOne({
        _id: createObjectId(locationId),
        isActive: true,
      }).lean();
      if (!location) {
        return { success: false, message: "That location is not available" };
      }
    } else if (siteId) {
      location = await resolveOrCreateLocationForSite(siteId);
    } else {
      location = await ensureDefaultLocation();
    }

    if (!location?._id) {
      return { success: false, message: "No clock-in location is set up yet" };
    }

    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

    // The row first: a signed token whose row does not exist is unredeemable,
    // which fails closed. The reverse would leave a redeemable row for a token
    // nobody holds.
    await ClockTokenModel.create({
      jti,
      locationId: location._id,
      // Derived from the location rather than taken from the caller, so the
      // two can never disagree about where the code was displayed.
      siteId: location.projectSiteId || null,
      issuedBy: createObjectId(user._id),
      issuedByName: user.name,
      expiresAt,
    });

    const token = signClockToken(jti);
    const qrDataUrl = await qrcode.toDataURL(token, QR_OPTIONS);

    return {
      success: true,
      data: JSON.stringify({
        token,
        qrDataUrl,
        expiresAt: expiresAt.toISOString(),
        ttlSeconds: TOKEN_TTL_SECONDS,
        locationName: location.name,
      }),
    };
  } catch (error) {
    console.log("Error issuing clock token:", error);
    return { success: false, message: "Could not generate a code" };
  }
}
