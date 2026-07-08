"use server";

import { connect } from "@/db/db";
import RoleBasedModel from "@/models/rolebasedModel";
import { getServerSideProps } from "../session/session";
import { withAudit, recordAudit } from "@/lib/audit";

export const assignPermission = withAudit(
  "Permission.assign",
  async (data, id) => {
    try {
      await connect();
      if (id) {
        const existingAssignment = await RoleBasedModel.find({
          employeeId: data?.employeeId, // exclude the current project site
          _id: { $ne: id }, // Exclude the current assignment
        });
        if (existingAssignment.length > 0) {
          return {
            success: false,
            message: " Employee already has a role-based assignment",
          };
        }
        const before = await RoleBasedModel.findById(id).lean();
        const role = await RoleBasedModel.findByIdAndUpdate(id, data, {
          new: true,
        });
        recordAudit({
          entityId: id,
          before,
          after: role?.toObject ? role.toObject() : role,
          description: `Updated role/permission for employee ${data?.employeeId}`,
        });
        return {
          success: true,
          message: "Permission update successfully",
        };
      } else {
        // first we have to find the if user already has the permission
        const user = await RoleBasedModel.findOne({
          employeeId: data.employeeId,
        });
        // we have to return message user already has the permission
        if (user) {
          return { success: false, message: "User already has the permission" };
        }
        // if user does not have the permission we have to assign the permission
        const result = await RoleBasedModel.create(data);
        recordAudit({
          entityId: result?._id,
          after: result?.toObject ? result.toObject() : result,
          description: `Assigned role/permission to employee ${data?.employeeId}`,
        });
        return { success: true, message: "Permission assigned successfully" };
      }
    } catch (error) {
      console.log(" Error in assignPermission function", error);
      return { success: false, message: "Error assigning permission" };
    }
  },
  { module: "Permission" },
);

export const removePermission = withAudit(
  "Permission.remove",
  async (data) => {
    try {
      await connect();
      // first we have to find the if user already has the permission
      const user = await RoleBasedModel.findOne({ employeeId: data.employeeId });
      // we have to return message user already has the permission
      if (!user) {
        return { sucess: false, message: "User does not have the permission" };
      }
      // if user does not have the permission we have to assign the permission
      const result = await RoleBasedModel.deleteOne({
        employeeId: data.employeeId,
      });
      recordAudit({
        entityId: user?._id,
        before: user?.toObject ? user.toObject() : user,
        description: `Removed role/permission from employee ${data?.employeeId}`,
      });
      return { sucess: true, message: "Permission removed successfully" };
    } catch (error) {
      console.log(" Error in removePermission function", error);
      return { sucess: false, message: "Error removing permission" };
    }
  },
  { module: "Permission" },
);

export async function getAllPermission(filterData) {
  console.log(filterData);
  try {
    const validPage = Number.isInteger(parseInt(filterData?.page))
      ? parseInt(filterData?.page)
      : 1;
    const validLimit = Number.isInteger(parseInt(filterData?.pageSize))
      ? parseInt(filterData?.pageSize)
      : 10;
    const skip = Math.max((validPage - 1) * validLimit, 0);

    await connect();
    const pipeline = [
      {
        $lookup: {
          from: "officeemployes",
          localField: "employeeId",
          foreignField: "_id",
          as: "result",
          pipeline: [
            {
              $project: {
                _id: 0,
                name: "$name",
              },
            },
          ],
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $skip: skip,
      },
      {
        $limit: validLimit,
      },
    ];
    const [totalCountDocuments, result] = await Promise.all([
      RoleBasedModel.countDocuments({}),
      RoleBasedModel.aggregate(pipeline),
    ]);
    return {
      sucess: true,
      message: "Permission fetched successfully",
      data: JSON.stringify(result),
      totalCount: totalCountDocuments,
    };
  } catch (error) {
    console.log(" Error in getAllPermission function", error);
    return { sucess: false, message: "Error fetching permission" };
  }
}

export async function checkPermission(data) {
  try {
    const permission = data?.permission; // The specific permission to check
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const role = props?.session?.user?.role;
    if (role === "superAdmin") {
      return {
        success: true,
        message: "Permission fetched successfully",
        data: true,
      };
    }
    await connect();
    const user = await RoleBasedModel.findOne({
      employeeId: employeeId,
    });
    return {
      success: true,
      message: "Permission fetched successfully",
      data: user.permissions.includes(permission),
    };
  } catch (error) {
    console.log(" Error in checkPermission function", error);
    return { success: false, message: "Error fetching permission" };
  }
}
