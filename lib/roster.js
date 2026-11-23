import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import SiteAssignmentModel from "@/models/siteAssignmentModel";
import StandingAssignmentModel from "@/models/standingAssignmentModel";

/**
 * Who is expected where, on a given day.
 *
 * Two kinds of assignment put somebody on a site: a day's assignment
 * (SiteAssignment — "Sam is on Elm Street today") and an ongoing one
 * (StandingAssignment — "Ada is in Year 9 Maths from 3 March, Mondays and
 * Wednesdays"). Everything that asks "was this person meant to be here" asks
 * this module, so the two can never disagree: the QR and NFC clock-in checks,
 * offline sync, the employee's own page and the site board.
 *
 * Deliberately NOT a "use server" module: it backs clock-in decisions, and
 * exporting it from a server-action file would publish it as an endpoint.
 *
 * Dates are working dates — UTC midnight of the day, as getWorkingDate()
 * returns and as both models store.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ongoing assignments covering `date`: started, not ended, and on one of
 * their weekdays (an empty list is every day).
 */
export function standingOnDate(date) {
  return {
    isDeleted: { $ne: true },
    startDate: { $lte: date },
    $and: [
      { $or: [{ endDate: null }, { endDate: { $gte: date } }] },
      { $or: [{ days: { $size: 0 } }, { days: date.getUTCDay() }] },
    ],
  };
}

/** Is this person on this site on this day, by either kind of assignment? */
export async function isRostered({ siteId, employeeId, date }) {
  if (!isValidObjectId(siteId) || !isValidObjectId(employeeId) || !date) {
    return false;
  }
  const site = createObjectId(siteId);
  const person = createObjectId(employeeId);

  const daily = await SiteAssignmentModel.findOne({
    assignDate: date,
    siteId: site,
    "assignedEmployees.employeeId": person,
  })
    .select("_id")
    .lean();
  if (daily) return true;

  const standing = await StandingAssignmentModel.findOne({
    siteId: site,
    employeeId: person,
    ...standingOnDate(date),
  })
    .select("_id")
    .lean();
  return Boolean(standing);
}

/**
 * The site somebody is on today, for the screen that shows them where to
 * clock in. A day's assignment wins — it is the more specific instruction —
 * then the ongoing one that started most recently.
 *
 * @returns {Promise<string|null>} a site id
 */
export async function rosteredSiteFor({ employeeId, date }) {
  if (!isValidObjectId(employeeId) || !date) return null;
  const person = createObjectId(employeeId);

  const daily = await SiteAssignmentModel.findOne({
    assignDate: date,
    "assignedEmployees.employeeId": person,
  })
    .select("siteId")
    .lean();
  if (daily?.siteId) return String(daily.siteId);

  const standing = await StandingAssignmentModel.findOne({
    employeeId: person,
    ...standingOnDate(date),
  })
    .sort({ startDate: -1 })
    .select("siteId")
    .lean();
  return standing?.siteId ? String(standing.siteId) : null;
}

/**
 * Everybody with an ongoing assignment touching [start, end], optionally on
 * one set of sites — for queries that list people rather than days.
 *
 * Weekdays are not applied here: someone enrolled Mondays only is still on
 * the class's books for a week that contains a Monday, and a range is asked
 * for as a whole.
 *
 * @returns {Promise<string[]>} employee ids
 */
export async function standingEmployeeIds({ start, end, siteMatch }) {
  const rows = await StandingAssignmentModel.find({
    isDeleted: { $ne: true },
    startDate: { $lte: end },
    $or: [{ endDate: null }, { endDate: { $gte: start } }],
    ...(siteMatch ? { siteId: siteMatch } : {}),
  })
    .select("employeeId")
    .lean();
  return [...new Set(rows.map((r) => String(r.employeeId)))];
}

/**
 * Aggregation stages that add ongoing assignments to a SiteAssignment
 * pipeline, one document per site per covered day, in SiteAssignment's own
 * shape — so the stages after them cannot tell the two apart except by
 * `standing: true`.
 *
 * Place it straight after the pipeline's first `$match`. It must be a
 * top-level stage: lib/tenantPlugin.js scopes a top-level `$unionWith` to the
 * caller's company, and would not see one nested inside a `$facet`.
 *
 * @param {{ start: Date, end: Date, siteMatch?: any, employeeId?: string }} args
 */
export function standingAsDailyStages({ start, end, siteMatch, employeeId }) {
  return [
    {
      $unionWith: {
        coll: StandingAssignmentModel.collection.name,
        pipeline: [
          {
            $match: {
              isDeleted: { $ne: true },
              startDate: { $lte: end },
              $or: [{ endDate: null }, { endDate: { $gte: start } }],
              ...(siteMatch ? { siteId: siteMatch } : {}),
              ...(employeeId && isValidObjectId(employeeId)
                ? { employeeId: createObjectId(employeeId) }
                : {}),
            },
          },
          // The part of the stretch inside the range asked for, one row per day.
          {
            $addFields: {
              _from: { $max: ["$startDate", start] },
              _to: { $min: [{ $ifNull: ["$endDate", end] }, end] },
            },
          },
          {
            $addFields: {
              _offsets: {
                $range: [
                  0,
                  {
                    $toInt: {
                      $add: [
                        {
                          $round: [
                            { $divide: [{ $subtract: ["$_to", "$_from"] }, DAY_MS] },
                            0,
                          ],
                        },
                        1,
                      ],
                    },
                  },
                ],
              },
            },
          },
          { $unwind: "$_offsets" },
          {
            $addFields: {
              assignDate: {
                $add: ["$_from", { $multiply: ["$_offsets", DAY_MS] }],
              },
            },
          },
          // Only its weekdays. $dayOfWeek counts Sunday as 1; `days` as 0.
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: [{ $size: { $ifNull: ["$days", []] } }, 0] },
                  {
                    $in: [
                      { $subtract: [{ $dayOfWeek: "$assignDate" }, 1] },
                      "$days",
                    ],
                  },
                ],
              },
            },
          },
          {
            $project: {
              siteId: 1,
              assignDate: 1,
              standing: { $literal: true },
              standingId: "$_id",
              assignedEmployees: [
                {
                  employeeId: "$employeeId",
                  assignedBy: "$assignedBy",
                  assignedAt: "$createdAt",
                  isLocked: { $literal: false },
                },
              ],
            },
          },
        ],
      },
    },
  ];
}
