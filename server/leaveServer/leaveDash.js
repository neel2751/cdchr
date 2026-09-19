"use server";
import { connect } from "@/db/db";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { getServerSideProps } from "../session/session";
import { createObjectId } from "@/lib/mongodb";
import { decrypt } from "@/lib/algo";
import { resolveEmployeeTarget } from "@/lib/employeeAccess";

/** decrypt() throws on a malformed token; a bad slug should just mean "me". */
function safeDecrypt(value) {
  if (!value) return null;
  try {
    return decrypt(value) || null;
  } catch {
    return null;
  }
}

/**
 * The five leave tiles.
 *
 * Two modes, and the difference matters:
 *
 *   leaveCount()                    the Leave Management overview. A super
 *                                   admin gets the company's figures *and*
 *                                   their own, ten tiles in all; everyone else
 *                                   gets their own five. Unchanged.
 *
 *   leaveCount({ slug, leaveYear }) one person, one leave year — the tiles
 *                                   above an employee's leave list.
 *
 * The second mode is new, and it exists because the first was being used for
 * both. On an employee's leave page that meant the tiles disagreed with the
 * list underneath them in two ways at once: they counted every leave year ever
 * while the list showed one, and for a super admin they counted the whole
 * company while the list showed one person. "Total 2" above a list of one
 * request in this year was both numbers being right about different questions.
 *
 * @param {{ slug?: string, leaveYear?: string }} [input] `slug` is the
 *   encrypted employee id the page was opened with; it is resolved through the
 *   usual access rule, so asking about somebody else without the permission
 *   counts you.
 */
export async function leaveCount(input) {
  // convert time to zero in date
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  try {
    const { props } = await getServerSideProps();
    const { role, _id: sessionId } = props?.session?.user;

    // Naming one employee switches this to the scoped mode. `undefined` is not
    // the same as "no employee": a page that passes a slug it has not loaded
    // yet must not silently fall back to company-wide figures.
    const scoped = input ? Object.hasOwn(input, "slug") : false;
    const { employeeId: targetId } = scoped
      ? await resolveEmployeeTarget(safeDecrypt(input.slug))
      : { employeeId: sessionId };

    const employeeId = targetId || sessionId;
    const userFilter = { employeeId: createObjectId(employeeId) };

    // Applied to every facet below, so a count and the list it sits above are
    // answering the same question.
    const yearFilter = input?.leaveYear ? { leaveYear: input.leaveYear } : {};
    await connect();
    // Count the number of Pending, Approved, Reject of total leave

    const pipeline = [
      {
        $facet: {
          //   total: [{ $count: "total" }], // Count total number of sites
          // Company-wide, and therefore suppressed once a single employee is
          // named — a person's own leave page has no business showing the
          // company's totals.
          total:
            role === "superAdmin" && !scoped
              ? [{ $match: yearFilter }, { $count: "total" }]
              : [
                  {
                    $match: { ...userFilter, ...yearFilter },
                  },
                  { $count: "total" },
                ],
          // on rejected we have to count with leaveDate is gone to today's date
          pending:
            role === "superAdmin" && !scoped
              ? [
                  {
                    $match: {
                      leaveStatus: "Pending",
                      leaveStartDate: { $gt: todayStart },
                      ...yearFilter,
                    },
                  },
                  { $count: "pending" },
                ]
              : [],
          rejected:
            role === "superAdmin" && !scoped
              ? [
                  { $match: { leaveStatus: "Rejected", ...yearFilter } },
                  { $count: "rejected" },
                ]
              : [],

          approved:
            role === "superAdmin" && !scoped
              ? [
                  { $match: { leaveStatus: "Approved", ...yearFilter } },
                  { $count: "approved" },
                ]
              : [],
          dateIsGone:
            role === "superAdmin" && !scoped
              ? [
                  {
                    $match: {
                      leaveStartDate: { $lte: todayStart },
                      leaveStatus: { $nin: ["Approved", "Rejected"] },
                      ...yearFilter,
                    },
                  },
                  { $count: "total" },
                ]
              : [],

          // Leave Count for own request
          ownTotal: [
            {
              $match: { ...userFilter, ...yearFilter },
            },
            { $count: "total" },
          ],
          ownPending: [
            {
              $match: {
                leaveStatus: "Pending", // Specifically count "Pending"
                leaveStartDate: { $gt: todayStart }, // With leaveStartDate in the past
                ...userFilter,
                ...yearFilter,
              },
            },
            { $count: "pending" },
          ],
          ownRejected: [
            {
              $match: {
                leaveStatus: "Rejected",
                ...userFilter,
                ...yearFilter,
              },
            },
            { $count: "rejected" },
          ],
          ownApproved: [
            { $match: { leaveStatus: "Approved", ...userFilter, ...yearFilter } },
            { $count: "approved" },
          ],
          ownDateIsGone: [
            {
              $match: {
                leaveStartDate: { $lte: todayStart }, // Only consider leaveStartDate in the past
                leaveStatus: { $nin: ["Approved", "Rejected"] }, // Exclude "Approved" documents
                ...userFilter,
                ...yearFilter,
              },
            },
            { $count: "total" }, // Total matching documents
          ],
        },
      },
    ];
    const result = await LeaveRequestModel.aggregate(pipeline);
    const {
      total,
      pending,
      rejected,
      approved,
      dateIsGone,
      ownTotal,
      ownPending,
      ownRejected,
      ownApproved,
      ownDateIsGone,
    } = result[0];
    const simplifiedResult = [
      { label: "Total", value: total[0]?.total || 0 },
      { label: "Approved", value: approved[0]?.approved || 0 },
      { label: "Pending", value: pending[0]?.pending || 0 },
      { label: "Rejected", value: rejected[0]?.rejected || 0 },
      { label: "Date is gone", value: dateIsGone[0]?.total || 0 },
    ];
    const ownSimplifiedResult = [
      { label: "Total", value: ownTotal[0]?.total || 0 },
      { label: "Pending", value: ownPending[0]?.pending || 0 },
      { label: "Rejected", value: ownRejected[0]?.rejected || 0 },
      { label: "Approved", value: ownApproved[0]?.approved || 0 },
      { label: "Date is gone", value: ownDateIsGone[0]?.total || 0 },
    ];
    return {
      success: true,
      data: JSON.stringify(
        role === "superAdmin" && !scoped
          ? [...simplifiedResult, ...ownSimplifiedResult]
          : ownSimplifiedResult
      ),
      message: "Leave count successfully",
    };
  } catch (error) {
    console.log(" Error in leaveCount function", error);
    return { success: false, message: " Error in leaveCount function" };
  }
}
