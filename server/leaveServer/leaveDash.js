"use server";

import { connect } from "@/db/db";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { getServerSideProps } from "../session/session";
import mongoose from "mongoose";

// Count the number of Pending, Approved, Reject of total leave
export async function leaveCount() {
  // convert time to zero in date
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  try {
    const { props } = await getServerSideProps();
    const { role, _id: employeeId } = props?.session?.user;
    const userFilter = { employeeId: new mongoose.Types.ObjectId(employeeId) };
    await connect();
    // Count the number of Pending, Approved, Reject of total leave

    const pipeline = [
      {
        $facet: {
          //   total: [{ $count: "total" }], // Count total number of sites
          total:
            role === "superAdmin"
              ? [{ $count: "total" }]
              : [
                  {
                    $match: userFilter,
                  },
                  { $count: "total" },
                ], // Only for super admin
          // on rejected we have to count with leaveDate is gone to today's date
          pending:
            role === "superAdmin"
              ? [
                  {
                    $match: {
                      leaveStatus: "Pending",
                      leaveStartDate: { $gt: todayStart },
                    },
                  },
                  { $count: "pending" },
                ]
              : [],
          rejected:
            role === "superAdmin"
              ? [
                  { $match: { leaveStatus: "Rejected" } },
                  { $count: "rejected" },
                ]
              : [],

          approved:
            role === "superAdmin"
              ? [
                  { $match: { leaveStatus: "Approved" } },
                  { $count: "approved" },
                ]
              : [],
          dateIsGone:
            role === "superAdmin"
              ? [
                  {
                    $match: {
                      leaveStartDate: { $lte: todayStart },
                      leaveStatus: { $nin: ["Approved", "Rejected"] },
                    },
                  },
                  { $count: "total" },
                ]
              : [],

          // Leave Count for own request
          ownTotal: [
            {
              $match: userFilter,
            },
            { $count: "total" },
          ],
          ownPending: [
            {
              $match: {
                leaveStatus: "Pending", // Specifically count "Pending"
                leaveStartDate: { $gt: todayStart }, // With leaveStartDate in the past
                ...userFilter,
              },
            },
            { $count: "pending" },
          ],
          ownRejected: [
            {
              $match: {
                leaveStatus: "Rejected",
                ...userFilter,
              },
            },
            { $count: "rejected" },
          ],
          ownApproved: [
            { $match: { leaveStatus: "Approved", ...userFilter } },
            { $count: "approved" },
          ],
          ownDateIsGone: [
            {
              $match: {
                leaveStartDate: { $lte: todayStart }, // Only consider leaveStartDate in the past
                leaveStatus: { $nin: ["Approved", "Rejected"] }, // Exclude "Approved" documents
                ...userFilter,
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
        role === "superAdmin"
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
