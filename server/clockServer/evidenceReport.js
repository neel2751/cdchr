"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { getWorkingDate } from "@/lib/clockTime";
import { getClientIp } from "@/lib/clientIp";
import { headers } from "next/headers";
import ClockRecordModel from "@/models/clockInModel";
import { getServerSideProps } from "../session/session";

/**
 * What turning a rule on would have cost.
 *
 * Phase B records every clock-in's evidence and judges none of it. This is the
 * half that makes that worth doing: it reads the recorded verdicts back and
 * answers the question anyone is actually going to ask before flipping a
 * switch — *"if I enforce this, who stops being able to clock in?"*
 *
 * The candidate radii are the point of the geofence section. Choosing 150m
 * because it sounds about right is how a site with poor GPS ends up with two
 * people standing outside a cabin at 7am unable to start. Choosing it because
 * "250m would have admitted 99% of the last month's scans here, 150m would
 * have admitted 71%" is a decision.
 */

/** Radii to test against, in metres. */
const CANDIDATE_RADII = [50, 100, 150, 250, 500, 1000];

/**
 * The last 30 days. Takes no arguments for the same reason
 * getClockLocations does — see the note there. A date range belongs on
 * `useFetchQuery`, which passes `params`; `useFetchSelectQuery` passes the
 * query's AbortSignal, and reading a property off that throws on the server.
 */
export async function getClockEvidenceReport() {
  try {
    const { props } = await getServerSideProps();
    const role = props?.session?.user?.role;
    if (!["superAdmin", "admin"].includes(role)) {
      return { success: false, message: "Not authorized" };
    }

    await connect();

    const today = getWorkingDate();
    const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const end = today;

    const rows = await ClockRecordModel.aggregate([
      {
        $match: {
          date: { $gte: start, $lte: end },
          isDeleted: false,
          "clockInEvidence.recordedAt": { $exists: true },
        },
      },
      {
        $lookup: {
          from: "clocklocations",
          localField: "locationId",
          foreignField: "_id",
          as: "location",
        },
      },
      { $unwind: { path: "$location", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$locationId",
          name: { $first: "$location.name" },
          kind: { $first: "$location.kind" },
          scans: { $sum: 1 },
          // A scan an enforcing location would have turned away.
          wouldRefuse: {
            $sum: { $cond: [{ $eq: ["$clockInEvidence.wouldAllow", false] }, 1, 0] },
          },
          // No usable evidence at all — permission denied, no fix, no address.
          // Worth separating: it is a coverage problem, not a policy one.
          noEvidence: {
            $sum: {
              $cond: [
                { $eq: [{ $size: { $ifNull: ["$clockInEvidence.checks", []] } }, 0] },
                1,
                0,
              ],
            },
          },
          withPosition: {
            $sum: {
              $cond: [
                { $ifNull: ["$clockInEvidence.coords.lat", false] },
                1,
                0,
              ],
            },
          },
          checks: { $push: "$clockInEvidence.checks" },
          distances: {
            $push: {
              $let: {
                vars: {
                  fence: {
                    $first: {
                      $filter: {
                        input: { $ifNull: ["$clockInEvidence.checks", []] },
                        as: "c",
                        cond: { $eq: ["$$c.method", "geofence"] },
                      },
                    },
                  },
                },
                in: "$$fence.distanceMetres",
              },
            },
          },
          accuracies: { $push: "$clockInEvidence.coords.accuracyMetres" },
        },
      },
      { $sort: { scans: -1 } },
      { $limit: 200 },
    ]);

    const report = rows.map((row) => {
      // Per-method tallies, flattened out of the per-record arrays.
      const methods = {};
      for (const perRecord of row.checks || []) {
        for (const check of perRecord || []) {
          const m = (methods[check.method] ||= {
            pass: 0,
            fail: 0,
            unknown: 0,
            mode: check.mode,
          });
          if (check.verdict in m) m[check.verdict] += 1;
        }
      }

      const distances = (row.distances || [])
        .filter((d) => Number.isFinite(d))
        .sort((a, b) => a - b);

      // "A radius of X would have admitted Y% of the scans we actually saw."
      const radiusOptions = distances.length
        ? CANDIDATE_RADII.map((radius) => ({
            radius,
            admitted: distances.filter((d) => d <= radius).length,
            percent: Math.round(
              (distances.filter((d) => d <= radius).length / distances.length) *
                100,
            ),
          }))
        : [];

      const accuracies = (row.accuracies || [])
        .filter((a) => Number.isFinite(a))
        .sort((a, b) => a - b);

      return {
        locationId: row._id ? String(row._id) : null,
        name: row.name || "Unassigned",
        kind: row.kind || "office",
        scans: row.scans,
        wouldRefuse: row.wouldRefuse,
        noEvidence: row.noEvidence,
        withPosition: row.withPosition,
        methods,
        distance: distances.length
          ? {
              count: distances.length,
              min: distances[0],
              median: distances[Math.floor(distances.length / 2)],
              max: distances[distances.length - 1],
            }
          : null,
        // The median matters more than the best fix: half of this location's
        // scans are worse than this, and a radius has to live with that.
        medianAccuracyMetres: accuracies.length
          ? accuracies[Math.floor(accuracies.length / 2)]
          : null,
        radiusOptions,
      };
    });

    return {
      success: true,
      data: JSON.stringify({
        from: start.toISOString(),
        to: end.toISOString(),
        locations: report,
      }),
    };
  } catch (error) {
    console.log("Error building the clock evidence report:", error);
    return { success: false, message: "Could not build the report" };
  }
}

/**
 * Set a location's geofence, and the mode its methods run in.
 *
 * Kept next to the report on purpose: the figure should be chosen from the
 * numbers above, on the same screen, rather than typed in somewhere else from
 * memory.
 */
export async function setLocationPolicy({
  id,
  geofence,
  networks,
  methods,
  requireAll,
} = {}) {
  try {
    const { props } = await getServerSideProps();
    if (props?.session?.user?.role !== "superAdmin") {
      return { success: false, message: "Not authorized" };
    }
    if (!id || !isValidObjectId(id)) {
      return { success: false, message: "Invalid location" };
    }

    const { default: ClockLocationModel } = await import(
      "@/models/clockLocationModel"
    );
    await connect();

    const changes = {};
    if (geofence !== undefined) {
      if (geofence === null) {
        changes.geofence = undefined;
      } else {
        const lat = Number(geofence.lat);
        const lng = Number(geofence.lng);
        const radius = Number(geofence.radiusMetres);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          return { success: false, message: "Latitude must be between -90 and 90" };
        }
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
          return {
            success: false,
            message: "Longitude must be between -180 and 180",
          };
        }
        if (!Number.isFinite(radius) || radius < 10 || radius > 5000) {
          return {
            success: false,
            message: "Radius must be between 10 and 5000 metres",
          };
        }
        changes.geofence = { lat, lng, radiusMetres: radius };
      }
    }
    if (networks !== undefined) {
      changes.networks = (networks || []).map((n) => String(n).trim()).filter(Boolean);
    }
    if (methods !== undefined) {
      const TYPES = ["deviceQr", "network", "geofence", "nfc", "rollCall"];
      const MODES = ["off", "shadow", "enforce"];
      const cleaned = [];
      for (const m of methods || []) {
        if (!TYPES.includes(m?.type)) {
          return { success: false, message: `Unknown method "${m?.type}"` };
        }
        if (!MODES.includes(m?.mode)) {
          return { success: false, message: `Unknown mode "${m?.mode}"` };
        }
        // "off" is the absence of a rule, not a rule. Storing it would make
        // evaluateLocation iterate entries it then skips, and make "is
        // anything configured here" a harder question than it needs to be.
        if (m.mode !== "off") cleaned.push({ type: m.type, mode: m.mode });
      }
      changes.methods = cleaned;
    }
    if (requireAll !== undefined) changes.requireAll = Boolean(requireAll);

    await ClockLocationModel.updateOne(
      { _id: createObjectId(id) },
      { $set: changes },
    );

    return { success: true, message: "Location updated" };
  } catch (error) {
    console.log("Error setting location policy:", error);
    return { success: false, message: "Could not save" };
  }
}

/**
 * The address this browser is reaching us from.
 *
 * Nobody knows their office's public IP, and looking it up on a what-is-my-ip
 * site gives *that* site's view — which is the same answer only if nothing
 * sits between. This reports the hop our own proxy observed, which is exactly
 * the value the network check will compare against.
 *
 * `/32` and `/128` are offered as the default suggestion: a single address is
 * the honest starting point, and widening it to a range is a decision someone
 * should make knowingly.
 */
export async function getMyClientIp() {
  try {
    const { props } = await getServerSideProps();
    if (!["superAdmin", "admin"].includes(props?.session?.user?.role)) {
      return { success: false, message: "Not authorized" };
    }

    const ip = getClientIp(await headers());
    if (!ip) {
      return { success: false, message: "Could not read your address" };
    }

    return {
      success: true,
      data: JSON.stringify({
        ip,
        suggestion: ip.includes(":") ? `${ip}/128` : `${ip}/32`,
      }),
    };
  } catch (error) {
    console.log("Error reading the client IP:", error);
    return { success: false, message: "Could not read your address" };
  }
}
