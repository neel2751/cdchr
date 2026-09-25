"use server";

import { connect } from "@/db/db";
import { getWorkingDate } from "@/lib/clockTime";
import { CLOCK_STATUS } from "@/lib/clockStatus";
import ClockLocationModel from "@/models/clockLocationModel";
import ClockRecordModel from "@/models/clockInModel";
import EmployeModel from "@/models/employeModel";
import LeaveRequestModel from "@/models/leaveRequestModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import { getServerSideProps } from "../session/session";

/**
 * Who is at work right now.
 *
 * The question an attendance system exists to answer, and the dashboard did
 * not ask it: it showed three headcount cards and a chart that was commented
 * out. Staff totals are a fact about the payroll; this is a fact about today,
 * and it is the one somebody opens a dashboard at nine in the morning for.
 *
 * Counted from the clock records rather than derived on the client, because
 * the client would need every employee's record to do it — which is the
 * attendance board, and that is a different screen with a different cost.
 */

/** Everything the dashboard shows is this company's. */
async function requireAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return { ok: false, message: "Not signed in" };
  if (!["superAdmin", "admin"].includes(user.role)) {
    return { ok: false, message: "Not authorized" };
  }
  return { ok: true, user };
}

export async function getAttendancePulse() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return { success: false, message: auth.message };

    await connect();
    const today = getWorkingDate();
    const tomorrow = new Date(today.getTime() + 86400000);

    const [byStatus, byLocation, onLeave, headcount, needsReview, stillOpen] =
      await Promise.all([
        // Today's records, grouped by the status the model already derives.
        ClockRecordModel.aggregate([
          { $match: { date: today, isDeleted: false } },
          { $group: { _id: "$status", n: { $sum: 1 } } },
        ]),

        // Where those people are. The thing per-location clock records made
        // possible and nothing surfaced — before this, every office was
        // `siteId: null` and a company with two of them had one
        // indistinguishable blur.
        //
        // Only people currently AT a place: somebody who finished at two
        // o'clock is not at the site any more, and counting them would make
        // this a record of who visited rather than who is there.
        ClockRecordModel.aggregate([
          {
            $match: {
              date: today,
              isDeleted: false,
              status: { $in: [CLOCK_STATUS.CHECKED_IN, CLOCK_STATUS.ON_BREAK] },
            },
          },
          {
            $group: {
              _id: "$locationId",
              working: {
                $sum: {
                  $cond: [{ $eq: ["$status", CLOCK_STATUS.CHECKED_IN] }, 1, 0],
                },
              },
              onBreak: {
                $sum: {
                  $cond: [{ $eq: ["$status", CLOCK_STATUS.ON_BREAK] }, 1, 0],
                },
              },
            },
          },
        ]),

        // Approved leave covering today. Counted by distinct employee: one
        // person with two approved requests touching today is one absence,
        // not two.
        LeaveRequestModel.aggregate([
          {
            $match: {
              leaveStatus: "Approved",
              leaveDates: { $elemMatch: { $gte: today, $lt: tomorrow } },
            },
          },
          { $group: { _id: "$employeeId" } },
          { $count: "n" },
        ]),

        // Who could be in at all. Both populations, because they clock in
        // through different screens but are one company on a dashboard.
        Promise.all([
          OfficeEmployeeModel.countDocuments({
            isActive: true,
            delete: { $ne: true },
          }),
          EmployeModel.countDocuments({
            isActive: true,
            delete: { $ne: true },
          }),
        ]),

        ClockRecordModel.countDocuments({
          date: today,
          isDeleted: false,
          needsReview: true,
        }),

        // Shifts from an earlier day that were never closed. The nightly job
        // flags these; showing the count is what turns a flag into something
        // somebody acts on.
        ClockRecordModel.countDocuments({
          date: { $lt: today },
          isDeleted: false,
          clockIn: { $type: "string", $ne: "" },
          $or: [{ clockOut: null }, { clockOut: { $exists: false } }],
        }),
      ]);

    const count = (status) =>
      byStatus.find((row) => row._id === status)?.n || 0;

    const working = count(CLOCK_STATUS.CHECKED_IN);
    const onBreak = count(CLOCK_STATUS.ON_BREAK);
    const finished = count(CLOCK_STATUS.CLOCKED_OUT);
    const absent = onLeave[0]?.n || 0;
    const staff = headcount[0] + headcount[1];

    // Never negative. A company mid-migration can have more records today than
    // it has active staff — somebody clocked in and was then deactivated — and
    // "-2 not in yet" is a number nobody can act on.
    const notIn = Math.max(0, staff - working - onBreak - finished - absent);

    // Names for the places. A separate read rather than a $lookup because
    // ClockLocation is tenant-scoped and a lookup inside an aggregation does
    // not carry the scope — see lib/tenantPlugin.js.
    const places = await ClockLocationModel.find({
      _id: { $in: byLocation.map((row) => row._id).filter(Boolean) },
    })
      .select("name kind projectSiteId")
      .lean();
    const nameOf = new Map(places.map((p) => [String(p._id), p]));

    const locations = byLocation
      .map((row) => {
        const place = nameOf.get(String(row._id));
        return {
          id: String(row._id),
          // A location that has been archived still has people on it today.
          // Better an honest placeholder than a blank row.
          name: place?.name || "Somewhere no longer listed",
          kind: place?.projectSiteId ? "site" : "office",
          working: row.working,
          onBreak: row.onBreak,
          total: row.working + row.onBreak,
        };
      })
      .sort((a, b) => b.total - a.total);

    return {
      success: true,
      data: JSON.stringify({
        working,
        onBreak,
        finished,
        onLeave: absent,
        notIn,
        staff,
        locations,
        needsReview,
        stillOpen,
      }),
    };
  } catch (error) {
    console.log("Error building the attendance pulse:", error?.message);
    return { success: false, message: "Could not load today's attendance" };
  }
}
