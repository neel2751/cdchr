import { connect } from "@/db/db";
import LoginAttemptModel from "@/models/loginAttemptModel";

// After MAX_ATTEMPTS failures inside WINDOW_MS, the key is locked for LOCK_MS.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_MS = 15 * 60 * 1000; // 15 minutes

function makeKey(email, ip) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  return `${normalizedEmail}|${ip || "unknown"}`;
}

/**
 * Returns whether a login attempt is currently allowed for this email/IP pair.
 * Fails open (allows the attempt) on any infrastructure error so a database
 * problem can never lock everyone out.
 *
 * @returns {Promise<{ allowed: boolean, retryAfterSec?: number }>}
 */
export async function checkLoginRateLimit(email, ip) {
  try {
    await connect();
    const key = makeKey(email, ip);
    const record = await LoginAttemptModel.findOne({ key }).lean();

    if (record?.lockedUntil && new Date(record.lockedUntil) > new Date()) {
      const retryAfterSec = Math.ceil(
        (new Date(record.lockedUntil).getTime() - Date.now()) / 1000
      );
      return { allowed: false, retryAfterSec };
    }
    return { allowed: true };
  } catch (error) {
    console.log("Rate limit check error:", error?.message);
    return { allowed: true };
  }
}

/**
 * Records a failed login attempt and locks the key once the threshold is hit.
 * The counting window resets if the previous window has elapsed.
 */
export async function recordFailedLogin(email, ip) {
  try {
    await connect();
    const key = makeKey(email, ip);
    const now = new Date();
    const record = await LoginAttemptModel.findOne({ key });

    if (!record) {
      await LoginAttemptModel.create({
        key,
        email: (email || "").trim().toLowerCase(),
        ip,
        count: 1,
        firstAttemptAt: now,
        lastAttemptAt: now,
      });
      return;
    }

    const windowExpired =
      now.getTime() - new Date(record.firstAttemptAt).getTime() > WINDOW_MS;
    const count = windowExpired ? 1 : record.count + 1;

    const update = {
      count,
      lastAttemptAt: now,
      ...(windowExpired ? { firstAttemptAt: now, lockedUntil: null } : {}),
    };
    if (count >= MAX_ATTEMPTS) {
      update.lockedUntil = new Date(now.getTime() + LOCK_MS);
    }

    await LoginAttemptModel.updateOne({ key }, { $set: update });
  } catch (error) {
    console.log("Rate limit record error:", error?.message);
  }
}

/** Clears the counter for this email/IP pair after a successful login. */
export async function clearLoginAttempts(email, ip) {
  try {
    await connect();
    const key = makeKey(email, ip);
    await LoginAttemptModel.deleteOne({ key });
  } catch (error) {
    console.log("Rate limit clear error:", error?.message);
  }
}

/**
 * Returns a map of { lowercasedEmail: lockedUntil } for the supplied emails
 * that are currently locked out. Used to surface locked accounts in admin lists.
 */
export async function getLockedEmails(emails = []) {
  try {
    await connect();
    const list = (emails || [])
      .map((e) => (e || "").trim().toLowerCase())
      .filter(Boolean);
    if (!list.length) return {};

    const now = new Date();
    const docs = await LoginAttemptModel.find({
      email: { $in: list },
      lockedUntil: { $gt: now },
    })
      .select("email lockedUntil")
      .lean();

    const map = {};
    for (const d of docs) {
      const current = map[d.email];
      if (!current || new Date(d.lockedUntil) > new Date(current)) {
        map[d.email] = d.lockedUntil;
      }
    }
    return map;
  } catch (error) {
    console.log("getLockedEmails error:", error?.message);
    return {};
  }
}

/** Clears all failed-attempt / lockout records for an account (across all IPs). */
export async function clearLockByEmail(email) {
  try {
    await connect();
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized) return;
    await LoginAttemptModel.deleteMany({ email: normalized });
  } catch (error) {
    console.log("clearLockByEmail error:", error?.message);
  }
}
