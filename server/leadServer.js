"use server";

import { connect } from "@/db/db";
import LeadModel from "@/models/leadModel";
import QrCodeModel from "@/models/QrCodeModel";
import { getServerSideProps } from "./session/session";

export async function addLead(data, slug) {
  try {
    await connect();
    const qr = await QrCodeModel.findOne({ slug });
    if (!qr) return { success: false, message: "Invalid QR code" };

    const newLeadData = {
      qrCodeId: qr._id,
      agentId: qr.agentId,
      templateId: qr.templateId,
      data,
      name: data?.name || data?.fullName || "Unknown",
      email: data?.email || data?.emailAddress || "Unknown",
    };

    const newLead = await LeadModel.create(newLeadData);
    await QrCodeModel.findByIdAndUpdate(qr._id, { $inc: { scanCount: 1 } });
    if (newLead) {
      return { success: true, message: "Lead saved successfully" };
    }
    return {
      success: false,
      message: "Lead saving functionality is not implemented yet",
    };
  } catch (error) {
    console.log("Error saving lead:", error);
    return { success: false, message: "Failed to save lead" };
  }
}

export async function getLeadsByAgent() {
  try {
    const { props } = await getServerSideProps();
    const { _id: agentId } = props.session.user;
    await connect();
    const leads = await LeadModel.find({ agentId }).sort({ createdAt: -1 });
    return { success: true, data: JSON.stringify(leads) };
  } catch (error) {
    console.log("Error fetching leads:", error);
    return { success: false, message: "Failed to fetch leads" };
  }
}

export async function performanceOld() {
  try {
    const { props } = await getServerSideProps();
    const { _id: agentId } = props.session.user;
    await connect();

    const totalLeads = await LeadModel.countDocuments({ agentId });
    const contactedLeads = await LeadModel.countDocuments({
      agentId,
      status: "contacted",
    });
    const qualifiedLeads = await LeadModel.countDocuments({
      agentId,
      status: "qualified",
    });

    const report = {
      total: totalLeads,
      new: totalLeads - contactedLeads,
      qualified: qualifiedLeads,
      lost: totalLeads - qualifiedLeads - contactedLeads,
      marketableEmails: contactedLeads, // Assuming all contacted leads have marketable emails
    };

    console.log("Performance report:", report);

    return {
      success: true,
      data: JSON.stringify(report),
    };
  } catch (error) {
    console.log("Error fetching performance metrics:", error);
    return { success: false, message: "Failed to fetch performance metrics" };
  }
}
export async function performance() {
  try {
    await connect();
    const range = "30"; // days

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(range));

    const stats = await LeadModel.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          // Track the "Mixed" data for email marketing potential
          hasEmail: {
            $sum: { $cond: [{ $ifNull: ["$data.email", false] }, 1, 0] },
          },
        },
      },
    ]);

    // Transform into a frontend-friendly format
    const report = {
      total: stats.reduce((acc, curr) => acc + curr.count, 0),
      new: stats.find((s) => s._id === "new")?.count || 0,
      qualified: stats.find((s) => s._id === "qualified")?.count || 0,
      lost: stats.find((s) => s._id === "lost")?.count || 0,
      marketableEmails: stats.reduce((acc, curr) => acc + curr.hasEmail, 0),
    };

    return {
      success: true,
      data: JSON.stringify(report),
    };
  } catch (error) {
    console.log("Error fetching performance metrics:", error);
    return { success: false, message: "Failed to fetch performance metrics" };
  }
}

export async function updateLeadStatus({ leadId, newStatus }) {
  try {
    await connect();
    const validStatuses = ["new", "contacted", "qualified", "lost"];
    if (!validStatuses.includes(newStatus)) {
      return { success: false, message: "Invalid status value" };
    }

    const updatedLead = await LeadModel.findByIdAndUpdate(
      leadId,
      { status: newStatus },
      { new: true }
    );
    if (!updatedLead) {
      return { success: false, message: "Lead not found" };
    }
    return { success: true, message: "Lead status updated successfully" };
  } catch (error) {
    console.error("Error updating lead status:", error);
    return { success: false, message: "Failed to update lead status" };
  }
}

export async function exportMarketing() {
  await connect();

  // 1. Fetch leads that have potential for marketing (New or Qualified)
  // We exclude 'Lost' unless specified, to keep the list high-quality

  const pipeline = [
    {
      $match: {
        status: { $in: ["new", "qualified"] },
      },
    },
    {
      $lookup: {
        from: "qrcodes",
        localField: "qrCodeId",
        foreignField: "_id",
        as: "qrCodeData",
      },
    },
    {
      $project: {
        data: 1,
        status: 1,
        createdAt: 1,
        qrCodeId: { $arrayElemAt: ["$qrCodeData", 0] }, // Get the first matched QR code
      },
    },
  ];
  const leads = await LeadModel.aggregate(pipeline);
  // 2. The Normalizer: Extracting data from the "Mixed" object
  const normalizedLeads = leads
    .map((lead) => {
      const d = lead.data;
      return {
        Email: d.email || d.visitorEmail || d.Email || d.emailAddress || "",
        FirstName:
          d.firstName || d.fullName?.split(" ")[0] || d.Name || "Subscriber",
        LastName: d.lastName || d.fullName?.split(" ").slice(1).join(" ") || "",
        Phone: d.phone || d.mobile || d.contact || "",
        Source: lead.qrCodeId?.title || "Direct Scan",
        Status: lead.status,
        CapturedAt: lead.createdAt.toISOString().split("T")[0],
      };
    })
    .filter((lead) => lead.Email.includes("@")); // Only export if they have a valid email

  // // 3. Convert to CSV format
  // const headers = Object.keys(normalizedLeads[0] || {}).join(",");
  // const rows = normalizedLeads.map(lead =>
  //   Object.values(lead).map(value => `"${value}"`).join(",")
  // );
  // const csvContent = [headers, ...rows].join("\n");

  return {
    success: true,
    data: JSON.stringify(normalizedLeads),
  };
}
