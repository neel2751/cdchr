"use server";

import IssueTicketModel from "@/models/issueTicketModel";
import { getServerSideProps } from "../session/session";

export async function getIssueToken(filterData) {
  const { props } = await getServerSideProps();
  const userId = props?.session?.user?._id;
  const superAdmin = props?.session?.user?.role === "superAdmin" ? true : false;
  const sanitizedSearch = filterData?.query?.trim() || ""; // Ensure search is a string
  // const searchRegex = new RegExp(sanitizedSearch, "i"); // Create a case-ins ensitive regex
  const validPage = parseInt(filterData?.page || 1);
  const validLimit = parseInt(filterData?.pageSize || 10);
  const skip = (validPage - 1) * validLimit;
  const userIdFilter = superAdmin ? {} : { userId };
  const query = {};
  if (sanitizedSearch) {
    query.$or = [
      { title: { $regex: sanitizedSearch, $options: "i" } },
      { description: { $regex: sanitizedSearch, $options: "i" } },
    ];
  }
  try {
    const issueTickets = await IssueTicketModel.find({
      ...userIdFilter,
      ...query,
    })
      .populate("userId", "name")
      .skip(skip)
      .limit(validLimit)
      .sort({ createdAt: -1 });
    const totalIssueTickets = await IssueTicketModel.countDocuments(query);

    return {
      data: JSON.stringify(issueTickets),
      totalCount: totalIssueTickets,
    };
  } catch (error) {
    console.error(error);
    return { data: JSON.stringify([]), totalCount: 0 };
  }
}

export async function generateTicket(data) {
  try {
    const { props } = await getServerSideProps();
    const userId = props?.session?.user?._id;
    if (!userId) return { success: false, message: "User not logged in" };
    const trackingId = crypto.randomUUID();
    const dbData = {
      ...data,
      userId,
      trackingId,
    };
    const ticket = await IssueTicketModel.create(dbData);
    if (!ticket) return { success: false, message: "Failed to create ticket" };
    return { success: true, message: "Ticket created successfully" };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Failed to create ticket" };
  }
}
