"use server";

import { connect } from "@/db/db";
import ScreenViewModel from "@/models/screenViewModel";
import { createObjectId } from "@/lib/mongodb";
import { permissionRefusal } from "@/lib/actionAccess";
import { getServerSideProps } from "../session/session";

/**
 * Recording which screens get opened, and reading it back.
 *
 * The companion to exportAudit.js, which records an export. This records a
 * visit, because the two questions are different and only the first was
 * answerable: with no export ever recorded in production, every screen looked
 * equally unused, which is why nobody could say whether Filter Attendance was
 * abandoned or simply quiet while it was throwing on every call.
 *
 * Storage and the per-day dedupe are described on models/screenViewModel.js.
 */

/** How far a path may be from a screen before it is not worth distinguishing. */
const MAX_PATH_LENGTH = 120;

/** The areas worth recording. A path outside them is ignored, not stored. */
const LOGGED_PREFIXES = ["/admin", "/employee", "/hr"];

/**
 * A pathname reduced to the screen it represents.
 *
 * Record ids have to come off or every employee detail page becomes its own
 * "screen" and the report answers nothing. Ids reach these URLs in two shapes:
 * raw 24-character hex, and the long opaque strings lib/algo produces — the
 * same two shapes switchDestination() in lib/roleHome.js trims, for the same
 * reason.
 *
 * Private: this file is "use server", where every export is a public endpoint,
 * and a string helper has no business being one.
 */
function normaliseScreenPath(value) {
  if (!value || typeof value !== "string") return "";

  // Query strings and fragments describe a filter, not a screen.
  const bare = value.split("?")[0].split("#")[0].trim();
  if (!bare.startsWith("/")) return "";
  if (!LOGGED_PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`))) {
    return "";
  }

  const segments = bare.split("/").filter(Boolean);
  const kept = segments.filter((segment) => {
    if (/^[0-9a-f]{24}$/i.test(segment)) return false;
    if (/^[A-Za-z0-9%+/=_-]{24,}$/.test(segment)) return false;
    return true;
  });

  const path = `/${kept.join("/")}`;
  return path.length > MAX_PATH_LENGTH ? path.slice(0, MAX_PATH_LENGTH) : path;
}

/** Today, as the same UTC day key the rest of the codebase uses. */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Record that the signed-in person opened a screen.
 *
 * Everything except the path comes from the session. The path is the only thing
 * the caller supplies and it is normalised before it is stored, so the worst a
 * forged call can do is claim a visit to a screen in this app — which is the
 * same thing navigating there would record, by the same person.
 *
 * Best-effort in every direction: it returns rather than throws, and the
 * component that calls it ignores the result. Usage statistics must never be
 * the reason a page fails to render.
 */
export async function logScreenView(rawPath) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user?._id) return { success: false };

    const path = normaliseScreenPath(rawPath);
    if (!path) return { success: false };

    await connect();
    const now = new Date();

    // Upsert, not insert: one row per person per screen per day, with a count.
    await ScreenViewModel.updateOne(
      { employeeId: createObjectId(user._id), path, day: todayKey() },
      {
        $inc: { count: 1 },
        // Refreshed on every visit so a renamed or re-roled account reads
        // correctly in the report without a migration.
        $set: {
          lastAt: now,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        $setOnInsert: { firstAt: now },
      },
      { upsert: true }
    );

    return { success: true };
  } catch (error) {
    console.log("logScreenView skipped:", error?.message);
    return { success: false };
  }
}

/**
 * Which screens have been opened, by how many people, and when last.
 *
 * Super admin only — it is every colleague's movement around the app, which is
 * a different thing from the screens any one of them may open.
 */
export async function getScreenUsage({ days = 90 } = {}) {
  const denied = await permissionRefusal();
  if (denied) return denied;

  try {
    await connect();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await ScreenViewModel.aggregate([
      { $match: { lastAt: { $gte: since } } },
      {
        $group: {
          _id: "$path",
          views: { $sum: "$count" },
          people: { $addToSet: "$employeeId" },
          lastAt: { $max: "$lastAt" },
          firstAt: { $min: "$firstAt" },
        },
      },
      {
        $project: {
          _id: 0,
          path: "$_id",
          views: 1,
          people: { $size: "$people" },
          lastAt: 1,
          firstAt: 1,
        },
      },
      { $sort: { lastAt: -1 } },
    ]);

    return { success: true, data: JSON.stringify(rows), days };
  } catch (error) {
    console.log("getScreenUsage error:", error?.message);
    return { success: false, message: "Could not read screen usage" };
  }
}
