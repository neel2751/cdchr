"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { getWorkingDate, toWorkingDate } from "@/lib/clockTime";
import { withAudit, recordAudit } from "@/lib/audit";
import { featureRefusal } from "@/lib/requireFeature";
import { getSiteScope, scopedSiteMatch, siteRefusal } from "@/lib/siteAccess";
import { getTenantTerms } from "@/lib/tenantTerms";
import { fillTerms } from "@/data/terminology";
import StandingAssignmentModel from "@/models/standingAssignmentModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import ProjectSiteModel from "@/models/siteProjectModel";

/**
 * Ongoing assignments: somebody on a site from a date, until a date or until
 * further notice — a student enrolled in a class for the year, a cleaner on a
 * contract. See models/standingAssignmentModel.js for why they exist beside
 * the day-by-day SiteAssignment, and lib/roster.js for how the two are read
 * together.
 *
 * The same rule as a day's assignment: the module must be on, and the caller
 * must manage the site (lib/siteAccess.js).
 */

/** Weekdays as 0 = Sunday … 6 = Saturday, de-duplicated; null if invalid. */
function cleanDays(days) {
  if (days === undefined || days === null || days === "") return [];
  const list = Array.isArray(days) ? days : [days];
  const numbers = list.map((d) => Number(d));
  if (numbers.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return null;
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/** The people these ids name, in this company, as `{ id: name }`. */
async function namesFor(ids) {
  const oids = ids.map((id) => createObjectId(id));
  const [site, office] = await Promise.all([
    EmployeModel.find({ _id: { $in: oids } }).select("firstName lastName").lean(),
    OfficeEmployeeModel.find({ _id: { $in: oids } }).select("name").lean(),
  ]);
  return Object.fromEntries([
    ...site.map((e) => [
      String(e._id),
      [e.firstName, e.lastName].filter(Boolean).join(" ") || "Unnamed",
    ]),
    ...office.map((e) => [String(e._id), e.name || "Unnamed"]),
  ]);
}

export const assignOngoing = withAudit(
  "StandingAssignment.assign",
  async ({ siteId, employee: employeeIds, startDate, endDate, days } = {}) => {
    try {
      const refusal = await featureRefusal("siteProjects");
      if (refusal) return refusal;

      const scope = await getSiteScope();
      const siteDenied = siteRefusal(scope, siteId, { write: true });
      if (siteDenied) return siteDenied;
      if (!isValidObjectId(siteId)) {
        return { success: false, message: "Choose a site" };
      }

      const ids = [...new Set(Array.isArray(employeeIds) ? employeeIds : [])];
      if (!ids.length || ids.some((id) => !isValidObjectId(id))) {
        return { success: false, message: "Select at least one person" };
      }

      const start = toWorkingDate(startDate);
      if (!start) return { success: false, message: "Choose a start date" };
      const end = endDate ? toWorkingDate(endDate) : null;
      if (endDate && !end) return { success: false, message: "Invalid end date" };
      if (end && end < start) {
        return { success: false, message: "The end date is before the start" };
      }
      const weekdays = cleanDays(days);
      if (!weekdays) return { success: false, message: "Invalid weekdays" };

      await connect();
      const terms = await getTenantTerms(scope.user.tenantId);

      const site = await ProjectSiteModel.findById(siteId).select("_id").lean();
      if (!site) {
        return { success: false, message: fillTerms("That {site} was not found", terms) };
      }
      const names = await namesFor(ids);
      const unknown = ids.filter((id) => !names[id]);
      if (unknown.length) {
        return { success: false, message: "Some of those people were not found" };
      }

      // One stretch per person per site at a time. A second overlapping one
      // would double them on the board; the existing one should be ended or
      // its dates changed instead.
      const overlapping = await StandingAssignmentModel.find({
        siteId: createObjectId(siteId),
        employeeId: { $in: ids.map((id) => createObjectId(id)) },
        isDeleted: { $ne: true },
        $and: [
          { $or: [{ endDate: null }, { endDate: { $gte: start } }] },
          ...(end ? [{ startDate: { $lte: end } }] : []),
        ],
      })
        .select("employeeId")
        .lean();
      const already = new Set(overlapping.map((r) => String(r.employeeId)));
      const toAdd = ids.filter((id) => !already.has(id));

      const assignedBy = createObjectId(scope.user._id);
      const created = toAdd.length
        ? await StandingAssignmentModel.insertMany(
            toAdd.map((id) => ({
              siteId: createObjectId(siteId),
              employeeId: createObjectId(id),
              startDate: start,
              endDate: end,
              days: weekdays,
              assignedBy,
            }))
          )
        : [];

      for (const row of created) {
        recordAudit({
          entityId: row._id,
          after: row.toObject(),
          description: `Ongoing assignment of ${names[String(row.employeeId)]} to site ${siteId} from ${start.toISOString().slice(0, 10)}${end ? ` to ${end.toISOString().slice(0, 10)}` : ""}`,
        });
      }

      const skipped = [...already].map((id) => names[id]);
      const parts = [];
      if (created.length) {
        parts.push(
          fillTerms(`${created.length} assigned to the {site}`, terms)
        );
      }
      if (skipped.length) {
        parts.push(`already assigned for those dates: ${skipped.join(", ")}`);
      }
      return {
        success: created.length > 0,
        message: parts.join("; ") || "Nothing to assign",
      };
    } catch (error) {
      console.log("assignOngoing error:", error?.message);
      return { success: false, message: "Something went wrong" };
    }
  },
  { module: "SiteAssignment" }
);

/**
 * End an ongoing assignment on `endDate` (their last day), today if none is
 * given. Ending it before it started cancels it.
 */
export const endOngoing = withAudit(
  "StandingAssignment.end",
  async ({ id, endDate } = {}) => {
    try {
      const refusal = await featureRefusal("siteProjects");
      if (refusal) return refusal;
      if (!isValidObjectId(id)) return { success: false, message: "Not found" };

      await connect();
      const row = await StandingAssignmentModel.findById(id).lean();
      if (!row || row.isDeleted) return { success: false, message: "Not found" };

      const scope = await getSiteScope();
      const siteDenied = siteRefusal(scope, row.siteId, { write: true });
      if (siteDenied) return siteDenied;

      const last = endDate ? toWorkingDate(endDate) : getWorkingDate();
      if (!last) return { success: false, message: "Invalid end date" };

      const cancelled = last < row.startDate;
      const update = cancelled
        ? { isDeleted: true, endedBy: createObjectId(scope.user._id), endedAt: new Date() }
        : { endDate: last, endedBy: createObjectId(scope.user._id), endedAt: new Date() };
      await StandingAssignmentModel.updateOne({ _id: row._id }, { $set: update });

      recordAudit({
        entityId: row._id,
        before: row,
        after: { ...row, ...update },
        description: cancelled
          ? `Cancelled ongoing assignment ${row._id} before it started`
          : `Ended ongoing assignment ${row._id} on ${last.toISOString().slice(0, 10)}`,
      });

      return {
        success: true,
        message: cancelled ? "Cancelled" : "Ended",
      };
    } catch (error) {
      console.log("endOngoing error:", error?.message);
      return { success: false, message: "Something went wrong" };
    }
  },
  { module: "SiteAssignment" }
);

/**
 * Ongoing assignments still running (or not yet started), for the sites the
 * caller manages — one site, or "All" of theirs.
 */
export async function getOngoingAssignments({ siteId = "All" } = {}) {
  try {
    const refusal = await featureRefusal("siteProjects");
    if (refusal) return refusal;

    const scope = await getSiteScope();
    if (!scope) return { success: false, message: "Not signed in" };
    if (scope.selfOnly) {
      return { success: false, message: "You do not have access to this" };
    }

    const match = {
      isDeleted: { $ne: true },
      $or: [{ endDate: null }, { endDate: { $gte: getWorkingDate() } }],
    };
    if (siteId && siteId !== "All") {
      const siteDenied = siteRefusal(scope, siteId);
      if (siteDenied) return siteDenied;
      if (!isValidObjectId(siteId)) return { success: false, message: "Invalid site" };
      match.siteId = createObjectId(siteId);
    } else {
      const mine = scopedSiteMatch(scope);
      if (mine) match.siteId = mine;
    }

    await connect();
    const rows = await StandingAssignmentModel.find(match)
      .sort({ startDate: -1 })
      .lean();
    const names = await namesFor([...new Set(rows.map((r) => String(r.employeeId)))]);
    const sites = Object.fromEntries(
      (
        await ProjectSiteModel.find({
          _id: { $in: [...new Set(rows.map((r) => String(r.siteId)))].map((s) => createObjectId(s)) },
        })
          .select("siteName")
          .lean()
      ).map((s) => [String(s._id), s.siteName])
    );

    return {
      success: true,
      data: JSON.stringify(
        rows.map((r) => ({
          _id: String(r._id),
          siteId: String(r.siteId),
          siteName: sites[String(r.siteId)] || "-",
          employeeId: String(r.employeeId),
          name: names[String(r.employeeId)] || "Unknown",
          startDate: r.startDate,
          endDate: r.endDate,
          days: r.days || [],
        }))
      ),
    };
  } catch (error) {
    console.log("getOngoingAssignments error:", error?.message);
    return { success: false, message: "Could not load ongoing assignments" };
  }
}
