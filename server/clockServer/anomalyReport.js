"use server";

import { connect } from "@/db/db";
import { getWorkingDate } from "@/lib/clockTime";
import ClockRecordModel from "@/models/clockInModel";
// Imported for its side effect as well as its use: `populate({ path:
// "locationId" })` below needs the ClockLocation schema registered with
// mongoose. Without this the report works right up until there is something
// to show, then throws "Schema hasn't been registered" — a populate with zero
// results never runs, so an empty report hides it.
import "@/models/clockLocationModel";
import ClockTagModel from "@/models/clockTagModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { getServerSideProps } from "../session/session";

/**
 * Things worth a human looking at.
 *
 * Each of the phases before this one produced a signal and then left it in the
 * database: shifts nobody clocked out of, breaks left open, clock-ins a rule
 * would have refused, tags whose taps keep arriving from somewhere they are
 * not. Individually they are all visible if you know where to look, which
 * means in practice nobody looks.
 *
 * This is the one screen that answers "is anything wrong this week", and it is
 * deliberately ordered by how much each thing costs if ignored: pay first,
 * then hardware, then rules.
 */

/** Takes no arguments — see the note on getClockLocations. */
export async function getClockAnomalies() {
  try {
    const { props } = await getServerSideProps();
    const role = props?.session?.user?.role;
    if (!["superAdmin", "admin"].includes(role)) {
      return { success: false, message: "Not authorized" };
    }

    await connect();

    const today = getWorkingDate();
    const since = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [needsReview, refused, tags] = await Promise.all([
      // 1. Attendance a manager has to settle before payroll. These are the
      //    expensive ones: an unclosed shift contributes nothing to somebody's
      //    hours, and an unfinished break deducts nothing from them.
      ClockRecordModel.find({
        date: { $gte: since },
        isDeleted: false,
        needsReview: true,
      })
        .select(
          "employeeId employeeType date clockIn clockOut reviewReason locationId " +
            "offlineCapturedAt offlineSyncedAt offlineDriftMinutes",
        )
        .populate({ path: "locationId", select: "name" })
        .sort({ date: -1 })
        .limit(100)
        .lean(),

      // 2. Clock-ins a rule would have turned away. While a location is only
      //    measuring these are free information; once it enforces they are
      //    people who could not start work.
      ClockRecordModel.aggregate([
        {
          $match: {
            date: { $gte: since },
            isDeleted: false,
            "clockInEvidence.wouldAllow": false,
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
            // Whether this is hypothetical or real depends entirely on the
            // mode, so the report has to say which.
            enforcing: {
              $first: {
                $gt: [
                  {
                    $size: {
                      $filter: {
                        input: { $ifNull: ["$location.methods", []] },
                        as: "m",
                        cond: { $eq: ["$$m.mode", "enforce"] },
                      },
                    },
                  },
                  0,
                ],
              },
            },
            count: { $sum: 1 },
            lastAt: { $max: "$date" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),

      // 3. A tag whose taps arrive from a different place than it is bound to
      //    is either cloned or was physically moved without anyone reassigning
      //    it. The tag alone cannot tell you that; the tag plus a position can.
      ClockTagModel.find({
        status: { $in: ["active", "suspended"] },
        lastSeenLocationId: { $ne: null },
        $expr: { $ne: ["$lastSeenLocationId", "$locationId"] },
      })
        .select("label uid status locationId lastSeenLocationId lastSeenAt")
        .populate({ path: "locationId", select: "name" })
        .populate({ path: "lastSeenLocationId", select: "name" })
        .limit(50)
        .lean(),
    ]);

    // Names, so a row reads as a person rather than an id.
    const ids = [...new Set(needsReview.map((r) => String(r.employeeId)))];
    const [office, site] = await Promise.all([
      OfficeEmployeeModel.find({ _id: { $in: ids } }).select("name").lean(),
      EmployeModel.find({ _id: { $in: ids } })
        .select("firstName lastName")
        .lean(),
    ]);
    const nameOf = new Map([
      ...office.map((e) => [String(e._id), e.name]),
      ...site.map((e) => [
        String(e._id),
        `${e.firstName || ""} ${e.lastName || ""}`.trim(),
      ]),
    ]);

    return {
      success: true,
      data: JSON.stringify({
        since: since.toISOString(),
        needsReview: needsReview.map((r) => ({
          _id: String(r._id),
          name: nameOf.get(String(r.employeeId)) || "Unknown",
          date: r.date,
          clockIn: r.clockIn,
          clockOut: r.clockOut,
          reason: r.reviewReason,
          location: r.locationId?.name || "—",
          // Separated from the reason text so the screen can sort and group on
          // it: a tap that reached us four hours late is a different
          // conversation from one that was ten minutes behind.
          offline: r.offlineCapturedAt
            ? { driftMinutes: r.offlineDriftMinutes ?? null }
            : null,
        })),
        refused: refused.map((r) => ({
          locationId: r._id ? String(r._id) : null,
          name: r.name || "Unassigned",
          enforcing: Boolean(r.enforcing),
          count: r.count,
          lastAt: r.lastAt,
        })),
        tagsElsewhere: tags.map((t) => ({
          _id: String(t._id),
          label: t.label,
          uid: t.uid,
          status: t.status,
          boundTo: t.locationId?.name || "—",
          seenAt: t.lastSeenLocationId?.name || "—",
          lastSeenAt: t.lastSeenAt,
        })),
      }),
    };
  } catch (error) {
    console.log("Error building the anomaly report:", error);
    return { success: false, message: "Could not build the report" };
  }
}
