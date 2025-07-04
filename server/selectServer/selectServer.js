"use server";

import { connect } from "@/db/db";
import AttendanceCategoryModel from "@/models/attendanceCategoryModel";
import CompanyModel from "@/models/companyModel";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import RoleBasedModel from "@/models/rolebasedModel";
import RoleTypesModel from "@/models/roleTypeModel";
import ProjectSiteModel from "@/models/siteProjectModel";
import { getServerSideProps } from "../session/session";
import { COMMONMENUITEMS, MENU } from "@/data/menu";
import { mergeAndFilterMenus } from "@/lib/object";
import LeaveCategoryModel from "@/models/leaveCategoryModel";
import { getLeaveYearString } from "@/lib/getLeaveYear";
import CommonLeaveModel from "@/models/commonLeaveModel";
import mongoose from "mongoose";
import SiteAssignManagerModel from "@/models/siteAssignManagerModel";
import { createObjectId } from "@/lib/mongodb";

export const getSelectRoleType = async () => {
  try {
    await connect();
    // we have to create index on roleTypeModel
    // const indexes = await RoleTypesModel.collection.listIndexes().toArray();
    // mongoose.set("debug", true);
    // const check = await RoleTypesModel.collection.getIndexes();
    await RoleTypesModel.collection.createIndex({
      delete: 1,
      isActive: 1,
    });
    const roles = await RoleTypesModel.aggregate([
      {
        $match: { delete: false, isActive: true }, // Filters documents where delete is false
      },
      {
        $project: {
          _id: 0,
          value: "$_id", // Renames `_id` to `value`
          label: "$roleTitle", // Renames `roleTitle` to `name`
        },
      },
    ]).exec();
    if (!roles || roles.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const roleData = JSON.stringify(roles);
      const data = {
        success: true,
        data: roleData,
      };
      return data;
    }
  } catch (err) {
    console.log(err);
    return { success: false, message: "Error Occured" };
  }
};

export const getSelectProjects = async () => {
  // fetch all project only for super admin and admin otherwise fetch only for employee assigned projects
  const { props } = await getServerSideProps();
  const role = props?.session?.user?.role;
  const employeeId = props?.session?.user?._id;

  if (role === "superAdmin" || role === "admin") {
    return getAllProjects();
  } else {
    return getEmployeeAssignedProjects(employeeId);
  }
};

export const getAllProjects = async () => {
  try {
    await connect();
    const roles = await ProjectSiteModel.aggregate([
      {
        $match: { siteDelete: false, isActive: true }, // Filters documents where delete is false
      },
      {
        $project: {
          _id: 0,
          value: "$_id", // Renames `_id` to `value`
          label: "$siteName", // Renames `roleTitle` to `name`
        },
      },
    ]).exec();
    if (!roles || roles.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const roleData = JSON.stringify(roles);
      const data = {
        success: true,
        data: roleData,
      };
      return data;
    }
  } catch (err) {
    console.log(err);
    return { status: false, message: "Error Occured" };
  }
};

export const getEmployeeAssignedProjects = async (employeeId) => {
  try {
    await connect();
    const assignSite = await SiteAssignManagerModel.aggregate([
      {
        $match: {
          isDelete: false,
          isActive: true,
          roleId: employeeId ? createObjectId(employeeId) : null,
        },
      },
      {
        $lookup: {
          from: "projectsites",
          localField: "projectSiteID",
          foreignField: "_id",
          as: "siteData",
        },
      },
      {
        $unwind: "$siteData",
      },
      {
        $project: {
          _id: 0,
          value: "$siteData._id", // Renames `_id` to `value`
          label: "$siteData.siteName", // Renames `roleTitle` to `name`
        },
      },
      {
        $sort: {
          label: 1,
        },
      },
    ]).exec();
    if (!assignSite || assignSite.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const roleData = JSON.stringify(assignSite);
      const data = {
        success: true,
        data: roleData,
      };
      return data;
    }
  } catch (err) {
    console.log("Error fetching employee assigned projects:", err);
    return { status: false, message: "Error Occured" };
  }
};

export const getSelectOfficeEmployee = async () => {
  try {
    await connect();
    const roles = await OfficeEmployeeModel.aggregate(
      [
        {
          $match: {
            isActive: true,
            delete: false,
            $or: [
              { visaEndDate: { $lte: new Date() } },
              { endDate: { $gte: new Date() } },
            ],
          },
        },
        {
          $project: {
            _id: 0,
            value: "$_id",
            label: "$name",
          },
        },
        {
          $sort: {
            label: 1,
          },
        },
      ]
      // { allowDiskUse: true }
    ).exec();
    if (!roles || roles.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const roleData = JSON.stringify(roles);
      const data = {
        success: true,
        data: roleData,
      };
      return data;
    }
  } catch (error) {
    console.log(error);
    return { status: false, message: "Error Occured" };
  }
};

export const getSelectEmployee = async () => {
  try {
    // await connect();
    const roles = await EmployeModel.aggregate(
      [
        {
          $match: { delete: false, isActive: true },
        },
        {
          $project: {
            _id: 0,
            value: "$_id",
            label: { $concat: ["$firstName", " ", "$lastName"] },
          },
        },
        {
          $sort: {
            label: 1,
          },
        },
      ]
      // { allowDiskUse: true }
    ).exec();
    if (!roles || roles.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const roleData = JSON.stringify(roles);
      const data = {
        success: true,
        data: roleData,
      };
      return data;
    }
  } catch (error) {
    console.log(error);
    return { status: false, message: "Error Occured" };
  }
};

export const getSelectCompanies = async () => {
  try {
    // await connect();
    const company = await CompanyModel.aggregate([
      {
        $match: { delete: false, isActive: true }, // Filters documents where delete is false
      },
      {
        $project: {
          _id: 0,
          value: "$_id", // Renames `_id` to `value`
          label: "$name", // Renames `roleTitle` to `name`
        },
      },
    ]).exec();
    if (!company || company?.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const roleData = JSON.stringify(company);
      const data = {
        success: true,
        data: roleData,
      };
      return data;
    }
  } catch (err) {
    console.log(err);
    return { success: false, message: "Error Occured" };
  }
};

export const getSelectAttendanceCategory = async () => {
  try {
    const categories = await AttendanceCategoryModel.aggregate([
      {
        $match: { isDeleted: false, isActive: true }, // Filters documents where delete is false
      },
      {
        $project: {
          _id: 0,
          value: "$attendanceCategoryValue", // Renames `_id` to `value`
          label: "$attendanceCategoryName", // Renames `roleTitle` to `name`
        },
      },
    ]).exec();
    if (!categories || categories.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const data = {
        success: true,
        data: JSON.stringify(categories),
      };
      return data;
    }
  } catch (err) {
    console.log(err);
    return { success: false, message: "Error Occured" };
  }
};

export const getEmployeeMenu = async () => {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const role = props?.session?.user?.role;
    if (role === "superAdmin") {
      const menu = MENU.filter((item) => item?.role?.includes(role));
      return { success: true, data: JSON.stringify(menu) };
    } else {
      await connect();
      const menu = await RoleBasedModel.findOne({
        employeeId: employeeId,
      });
      if (!menu) {
        return { success: false, message: "No Data Found" };
      } else {
        const menuItem = mergeAndFilterMenus(COMMONMENUITEMS, MENU).filter(
          (ie) => menu?.permissions?.includes(ie?.path)
        );
        const data = {
          success: true,
          data: JSON.stringify(menuItem),
        };
        return data;
      }
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error Occured" };
  }
};

export const getSelectLeaveCategories = async () => {
  try {
    const leaveTypes = await LeaveCategoryModel.aggregate([
      {
        $match: { isDeleted: false, isActive: true }, // Filters documents where delete is false
      },
      {
        $project: {
          _id: 0,
          value: "$leaveType", // Renames `_id` to `value`
          label: "$leaveType", // Renames `roleTitle` to `name`
        },
      },
    ]).exec();
    if (!leaveTypes || leaveTypes.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const data = {
        success: true,
        data: JSON.stringify(leaveTypes),
      };
      return data;
    }
  } catch (err) {
    console.log(err);
    return { success: false, message: "Error Occured" };
  }
};

export const getSelectLeaveRequestForEmployee = async () => {
  try {
    await connect();

    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const leaveYear = getLeaveYearString(new Date());
    const pipeline = [
      {
        $match: {
          leaveYear,
          employeeId: new mongoose.Types.ObjectId(employeeId),
        },
      },
      {
        $project: {
          leaveData: {
            $filter: {
              input: "$leaveData",
              as: "item",
              cond: { $eq: ["$$item.isHide", false] },
            },
          },
        },
      },
      {
        $unwind: "$leaveData",
      },
      {
        $project: {
          _id: 0,
          value: "$leaveData.leaveType",
          label: "$leaveData.leaveType",
          total: "$leaveData.total",
          used: "$leaveData.used",
          remaining: "$leaveData.remaining",
        },
      },
    ];

    const result = await CommonLeaveModel.aggregate(pipeline).exec();
    if (!result || result.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const data = {
        success: true,
        data: JSON.stringify(result),
      };
      return data;
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error Occured" };
  }
};
