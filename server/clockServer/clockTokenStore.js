/**
 * Reading and spending clock-in codes.
 *
 * Deliberately NOT a "use server" module. Everything exported from one of
 * those becomes an endpoint the browser can call by name, and these two must
 * not be: `consumeClockToken` burns a code, so exposing it would let anyone
 * signed in invalidate the code on a reception screen at will, or mark one
 * spent by an employee who never scanned it. They are internal helpers,
 * reachable only from the server actions that already decided a scan is
 * legitimate.
 *
 * `issueClockToken` in ./clockToken.js is the one piece of this that genuinely
 * is an action, because the reception screen has to call it.
 */
import jwt from "jsonwebtoken";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import ClockTokenModel from "@/models/clockTokenModel";

/**
 * Matches the lifetime the socket server used. Long enough to hold a phone up
 * to a screen, short enough that a photograph of one is worthless.
 */
export const TOKEN_TTL_SECONDS = 30;

const SECRET = process.env.NEXTAUTH_SECRET || "";

/** Sign a code. The jti is all that travels; the site is read back from the row. */
export function signClockToken(jti) {
  return jwt.sign({ jti }, SECRET, { expiresIn: `${TOKEN_TTL_SECONDS}s` });
}

/**
 * Is this code good, and what does it authorise?
 *
 * Read-only on purpose. Redemption is a separate step so that an action the
 * employee is not allowed to take — clocking in when already clocked in —
 * does not burn the code and send them back to reception for another one.
 *
 * Returns `{ ok, jti, siteId, message }`.
 */
export async function verifyClockToken(token) {
  const refuse = (message) => ({ ok: false, message });

  if (!token || typeof token !== "string") {
    return refuse("That code could not be read.");
  }

  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    // Expiry and tampering are deliberately the same answer: telling a
    // scanner which one it was is free information about the secret.
    return refuse("That code has expired. Ask for a new one.");
  }

  if (!payload?.jti) return refuse("That code could not be read.");

  await connect();

  // Tenant-scoped by the plugin, so a code minted by one company is invisible
  // to another even though the signature checks out — the signing secret is
  // shared across tenants, so this lookup is what actually keeps them apart.
  const row = await ClockTokenModel.findOne({ jti: payload.jti }).lean();
  if (!row) return refuse("That code has expired. Ask for a new one.");
  if (row.usedAt) return refuse("That code has already been used.");
  if (row.expiresAt <= new Date()) {
    return refuse("That code has expired. Ask for a new one.");
  }

  return {
    ok: true,
    jti: row.jti,
    locationId: row.locationId ? String(row.locationId) : null,
    siteId: row.siteId ? String(row.siteId) : null,
    message: null,
  };
}

/**
 * Spend the code, or find out someone else already did.
 *
 * The whole check lives in the filter. Two employees scanning the same screen
 * in the same second both pass verifyClockToken; only one of them gets a
 * document back from here.
 */
export async function consumeClockToken(jti, employeeId) {
  try {
    await connect();
    const claimed = await ClockTokenModel.findOneAndUpdate(
      { jti, usedAt: null, expiresAt: { $gt: new Date() } },
      {
        $set: {
          usedAt: new Date(),
          usedBy:
            employeeId && isValidObjectId(employeeId)
              ? createObjectId(employeeId)
              : null,
        },
      },
      { new: true },
    ).lean();

    if (!claimed) {
      return { ok: false, message: "That code has already been used." };
    }
    return {
      ok: true,
      locationId: claimed.locationId ? String(claimed.locationId) : null,
      siteId: claimed.siteId ? String(claimed.siteId) : null,
    };
  } catch (error) {
    console.log("Error consuming clock token:", error);
    return { ok: false, message: "Could not verify that code." };
  }
}
