"use server";

import { connect } from "@/db/db";
import VisitorModel from "@/models/visitorModel";

export async function handleOrUpdateVisitor(data) {
  if (
    !data ||
    !data.visitorName ||
    !data.visitorEmail ||
    !data.visitorPhone ||
    !data.visitorType ||
    !data.visitorPurpose
  ) {
    return { success: false, message: "Invalid data provided" };
  }

  try {
    await connect();

    const visitorEmail = data.visitorEmail.trim().toLowerCase();
    const visitorPhone = data.visitorPhone.trim();

    const existingVisitor = await VisitorModel.findOne({
      $or: [{ visitorEmail }, { visitorPhone }],
    });

    // === CASE 1: Update existing visitor purpose by _id (admin update case) ===
    if (data.purposeId) {
      const updated = await VisitorModel.updateOne(
        {
          "visitorPurpose._id": data.purposeId,
        },
        {
          $set: {
            "visitorPurpose.$.visitorType": data.visitorType,
            "visitorPurpose.$.visitorPurpose": data.visitorPurpose,
            "visitorPurpose.$.otherPurpose": data.otherPurpose,
          },
        }
      );

      if (updated.modifiedCount === 0) {
        return {
          success: false,
          message: "Purpose ID not found or no changes made",
        };
      }

      return { success: true, message: "Visitor purpose updated successfully" };
    }

    // === CASE 2: Add new purpose if not already present ===
    if (existingVisitor) {
      const isDuplicate = existingVisitor.visitorPurpose.some(
        (purpose) =>
          purpose.visitorType === data.visitorType &&
          purpose.visitorPurpose === data.visitorPurpose &&
          purpose.visitorStatus === "pending"
      );

      if (!isDuplicate) {
        await VisitorModel.updateOne(
          { _id: existingVisitor._id },
          {
            $push: {
              visitorPurpose: {
                visitorType: data.visitorType,
                visitorPurpose: data.visitorPurpose,
                otherPurpose: data.otherPurpose,
                visitorStatus: "pending",
                visitorCheckInTime: new Date(),
              },
            },
          }
        );
      }

      return { success: true, message: "Visitor updated with new purpose" };
    }

    // === CASE 3: New visitor altogether ===
    const newVisitor = new VisitorModel({
      visitorName: data.visitorName,
      visitorEmail,
      visitorPhone,
      visitorPurpose: [
        {
          visitorType: data.visitorType,
          visitorPurpose: data.visitorPurpose,
          otherPurpose: data.otherPurpose,
          visitorStatus: "Checked In",
          visitorCheckInTime: new Date(),
        },
      ],
    });

    await newVisitor.save();
    return { success: true, message: "New visitor created successfully" };
  } catch (error) {
    console.error("Error in visitor handling:", error);
    return { success: false, message: "Failed to handle visitor" };
  }
}

export async function getAllVisitors(params) {
  try {
    await connect();
    const filter = {};
    if (params?.query) {
      const search = params.query.trim().toLowerCase();
      filter.$or = [
        { visitorName: { $regex: search, $options: "i" } },
        { visitorEmail: { $regex: search, $options: "i" } },
        { visitorPhone: { $regex: search, $options: "i" } },
        // search by visitor notes
        { "visitorPurpose.visitorNotes": { $regex: search, $options: "i" } },
      ];
    }
    if (params?.visitorType) {
      filter["visitorPurpose.visitorType"] = params.visitorType;
    }
    if (params?.visitorStatus) {
      filter["visitorPurpose.visitorStatus"] = params.visitorStatus;
    }
    if (params?.startDate && params?.endDate) {
      const startDate = new Date(params.startDate);
      const endDate = new Date(params.endDate);
      endDate.setHours(23, 59, 59, 999); // Set end date to the end of the day
      filter["visitorPurpose.visitorCheckInTime"] = {
        $gte: startDate,
        $lte: endDate,
      };
    }
    if (params?.visitorPurpose) {
      filter["visitorPurpose.visitorPurpose"] = {
        $regex: params.visitorPurpose.trim(),
        $options: "i",
      };
    }
    const page = parseInt(params?.page) || 1;
    const limit = parseInt(params?.pageSize) || 10;
    const skip = (page - 1) * limit;
    const visitors = await VisitorModel.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();
    const totalVisitors = await VisitorModel.countDocuments(filter);
    return {
      success: true,
      data: JSON.stringify(visitors),
      totalCount: totalVisitors,
    };
  } catch (error) {
    console.error("Error fetching visitors:", error);
    return { success: false, message: "Failed to fetch visitors" };
  }
}

export async function updateVisitor(visitorId, updateData) {
  try {
    await connect();
    const updatedVisitor = await VisitorModel.findByIdAndUpdate(
      visitorId,
      updateData,
      { new: true }
    );
    if (!updatedVisitor) {
      return { success: false, message: "Visitor not found" };
    }
    return { success: true, data: JSON.stringify(updatedVisitor) };
  } catch (error) {
    console.error("Error updating visitor:", error);
    return { success: false, message: "Failed to update visitor" };
  }
}

export async function updateVisitorPurpose(purposeId, updateData) {
  try {
    await connect();
    const visitor = await VisitorModel.findOne({
      "visitorPurpose._id": purposeId,
    });
    if (!visitor) {
      return { success: false, message: "Visitor purpose not found" };
    }
    const purposeIndex = visitor.visitorPurpose.findIndex(
      (purpose) => purpose._id.toString() === purposeId
    );
    if (purposeIndex === -1) {
      return { success: false, message: "Purpose not found" };
    }
    visitor.visitorPurpose[purposeIndex].set(updateData);
    await visitor.save();
    return { success: true, data: JSON.stringify(visitor) };
  } catch (error) {
    console.error("Error updating visitor purpose:", error);
    return { success: false, message: "Failed to update visitor purpose" };
  }
}

export async function getVisitorById(visitorId) {
  try {
    await connect();
    const visitor = await VisitorModel.findById(visitorId);
    if (!visitor) {
      return { success: false, message: "Visitor not found" };
    }
    return { success: true, data: JSON.stringify(visitor) };
  } catch (error) {
    console.error("Error fetching visitor by ID:", error);
    return { success: false, message: "Failed to fetch visitor" };
  }
}

export async function deleteVisitorPurpose(purposeId) {
  try {
    await connect();
    const visitor = await VisitorModel.findOne({
      "visitorPurpose._id": purposeId,
    });
    if (!visitor) {
      return { success: false, message: "Visitor purpose not found" };
    }
    visitor.visitorPurpose = visitor.visitorPurpose.filter(
      (purpose) => purpose._id.toString() !== purposeId
    );
    await visitor.save();
    return { success: true, message: "Visitor purpose deleted successfully" };
  } catch (error) {
    console.error("Error deleting visitor purpose:", error);
    return { success: false, message: "Failed to delete visitor purpose" };
  }
}

export async function deleteVisitor(visitorId) {
  try {
    await connect();
    const result = await VisitorModel.findByIdAndDelete(visitorId);
    if (!result) {
      return { success: false, message: "Visitor not found" };
    }
    return { success: true, message: "Visitor deleted successfully" };
  } catch (error) {
    console.error("Error deleting visitor:", error);
    return { success: false, message: "Failed to delete visitor" };
  }
}

// we show count by visitor type
export async function getVisitorCountByType() {
  try {
    await connect();
    const counts = await VisitorModel.aggregate([
      {
        $unwind: "$visitorPurpose",
      },
      {
        $group: {
          _id: "$visitorPurpose.visitorType",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          visitorType: "$_id",
          count: 1,
          _id: 0,
        },
      },
    ]);
    return { success: true, data: JSON.stringify(counts) };
  } catch (error) {
    console.error("Error fetching visitor count by type:", error);
    return { success: false, message: "Failed to fetch visitor count" };
  }
}

export async function getVisitorCountByPurpose() {
  try {
    await connect();
    const counts = await VisitorModel.aggregate([
      {
        $unwind: "$visitorPurpose",
      },
      {
        $group: {
          _id: "$visitorPurpose.visitorPurpose",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          visitorPurpose: "$_id",
          count: 1,
          _id: 0,
        },
      },
    ]);
    return { success: true, data: JSON.stringify(counts) };
  } catch (error) {
    console.error("Error fetching visitor count by purpose:", error);
    return { success: false, message: "Failed to fetch visitor count" };
  }
}
