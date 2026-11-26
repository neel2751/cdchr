"use server";

import { connect } from "@/db/db";
import AttendanceCategoryModel from "@/models/attendanceCategoryModel";
import { entryKind } from "@/lib/rotaCategories";
import CompanyModel from "@/models/companyModel";
import { filterMenuByFeatures } from "@/lib/tenantPlan";
import { getTenantFeatures } from "@/lib/tenantFeatures";
import { getTenantTerms } from "@/lib/tenantTerms";
import { menuLabel } from "@/data/terminology";
import { isValidObjectId } from "@/lib/mongodb";
import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import RoleBasedModel from "@/models/rolebasedModel";
import RoleTypesModel from "@/models/roleTypeModel";
import ProjectSiteModel from "@/models/siteProjectModel";
import { getServerSideProps } from "../session/session";
import { COMMONMENUITEMS, MENU, DERIVED_ACCESS } from "@/data/menu";
import { mergeAndFilterMenus } from "@/lib/object";
import LeaveCategoryModel from "@/models/leaveCategoryModel";
import { currentLeaveYear } from "@/lib/leaveYear";
import CommonLeaveModel from "@/models/commonLeaveModel";
import mongoose from "mongoose";
import { createObjectId } from "@/lib/mongodb";
import FormTemplateModel from "@/models/formTemplateModel";
import { permissionRefusal } from "@/lib/actionAccess";
import { getSiteScope } from "@/lib/siteAccess";

/**
 * The shared dropdown sources. Guarded as "administers something" rather than
 * against a list of paths: these appear on a dozen admin screens, one of them
 * through components/filters/selectFilter, and a path list would break a
 * screen the day somebody reuses that component. See permissionRefusal().
 *
 * The employee pickers are the ones that matter — unguarded, any signed-in
 * account could enumerate every colleague's name and id.
 */
const ADMINISTERS_SOMETHING = { anyPermission: true };

export const getSelectRoleType = async () => {
  const denied = await permissionRefusal([], ADMINISTERS_SOMETHING);
  if (denied) return denied;

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
  // Every site for whoever may see every site, otherwise the sites the caller
  // manages today — the rule the site board, report and assignment enforce
  // too, so the picker never offers a site the action behind it would refuse.
  // See lib/siteAccess.js.
  const scope = await getSiteScope();
  if (!scope) return { success: false, message: "Not signed in" };
  if (scope.all) return getAllProjects();
  return listProjects({
    _id: { $in: scope.siteIds.map((id) => createObjectId(id)) },
  });
};

export const getAllProjects = async () => listProjects();

// Not exported: a "use server" export is an endpoint, and this takes a filter.
async function listProjects(match = {}) {
  const denied = await permissionRefusal([], ADMINISTERS_SOMETHING);
  if (denied) return denied;

  try {
    await connect();
    const roles = await ProjectSiteModel.aggregate([
      {
        // `$ne: true` — see siteProjectServer.js. `{ siteDelete: false }` skips
        // documents written before the field existed, which left five of one
        // company's seven active sites unpickable in every site dropdown: the
        // rota, site assignment and expenses all read this list.
        $match: { siteDelete: { $ne: true }, isActive: true, ...match },
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
}

export const getSelectOfficeEmployee = async () => {
  const denied = await permissionRefusal([], ADMINISTERS_SOMETHING);
  if (denied) return denied;

  try {
    await connect();
    const now = new Date();
    const roles = await OfficeEmployeeModel.aggregate(
      [
        {
          $match: {
            isActive: true,
            delete: false,
            $or: [
              { visaEndDate: { $gt: now } },
              { visaEndDate: { $exists: false } },
              { visaEndDate: null },
              { endDate: { $gte: now } },
              { endDate: { $exists: false } },
              { endDate: null },
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

/**
 * Site employees only. `getSelectEmployee` merges both workforces into one
 * list, which is no use to a filter that has already been narrowed to site
 * staff — picking an office employee there would always return nothing.
 */
export const getSelectSiteEmployee = async () => {
  const denied = await permissionRefusal([], ADMINISTERS_SOMETHING);
  if (denied) return denied;

  try {
    await connect();
    const employees = await EmployeModel.aggregate([
      { $match: { delete: false, isActive: true } },
      {
        $project: {
          _id: 0,
          value: "$_id",
          label: { $concat: ["$firstName", " ", "$lastName"] },
        },
      },
      { $sort: { label: 1 } },
    ]).exec();

    return { success: true, data: JSON.stringify(employees || []) };
  } catch (error) {
    console.log("Error in getSelectSiteEmployee", error);
    return { success: false, data: JSON.stringify([]) };
  }
};

export const getSelectEmployee = async () => {
  const denied = await permissionRefusal([], ADMINISTERS_SOMETHING);
  if (denied) return denied;

  try {
    // await connect();
    const employee = await EmployeModel.aggregate(
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

    const officeEmployee = await OfficeEmployeeModel.aggregate(
      [
        {
          $match: { delete: false, isActive: true },
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
    const roles = [...employee, ...officeEmployee];

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

/**
 * The companies the caller may filter by — which is only ever their own.
 *
 * A company IS a tenant here, and `Companie` is in GLOBAL_MODELS, so it carries
 * no tenant plugin and nothing filtered this. It listed every company on the
 * platform, meaning any admin of any tenant could read every other customer's
 * name out of a filter dropdown.
 *
 * Scoped to the session's tenant instead. That leaves exactly one option for a
 * normal user, which is also why the filter that uses it now hides itself: an
 * employee's `company` always equals their tenant, so filtering by it inside a
 * tenant could never narrow anything.
 */
export const getSelectCompanies = async () => {
  try {
    const { props } = await getServerSideProps();
    const tenantId = props?.session?.user?.tenantId;
    if (!tenantId || !isValidObjectId(tenantId)) {
      return { success: false, message: "No Data Found" };
    }

    await connect();
    const company = await CompanyModel.findOne({
      _id: createObjectId(tenantId),
      delete: { $ne: true },
      isActive: { $ne: false },
    })
      .select("_id name")
      .lean();

    if (!company) return { success: false, message: "No Data Found" };

    return {
      success: true,
      data: JSON.stringify([{ value: company._id, label: company.name }]),
    };
  } catch (err) {
    console.log(err);
    return { success: false, message: "Error Occured" };
  }
};

export const getSelectAttendanceCategory = async () => {
  const denied = await permissionRefusal([], ADMINISTERS_SOMETHING);
  if (denied) return denied;

  try {
    // With each one's rule and hours (lib/rotaCategories.js), so the rota
    // knows what choosing it means without a word wired into the screen.
    const rows = await AttendanceCategoryModel.find({ isDeleted: false, isActive: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    const categories = rows.map((c) => ({
      value: c.attendanceCategoryValue,
      label: c.attendanceCategoryName,
      kind: entryKind(c),
      startTime: c.startTime || "",
      endTime: c.endTime || "",
    }));
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
    // Modules the company's plan excludes are removed for everyone, whatever
    // their role — a super admin of a company without the CRM should not see it.
    const features = await getTenantFeatures(props?.session?.user?.tenantId);
    // Entries that name a site and the like are labelled in the company's own
    // words. Done here, where every sidebar gets its menu, so the sidebar
    // itself never has to know. See data/terminology.js.
    const terms = await getTenantTerms(props?.session?.user?.tenantId);
    const inTheirWords = (items) =>
      items.map((item) => ({ ...item, name: menuLabel(item, terms) }));
    if (role === "superAdmin") {
      const menu = filterMenuByFeatures(
        MENU.filter((item) => item?.role?.includes(role)),
        features
      );
      return { success: true, data: JSON.stringify(inTheirWords(menu)) };
    } else {
      await connect();
      const menu = await RoleBasedModel.findOne({
        employeeId: employeeId,
      });
      if (!menu) {
        return { success: false, message: "No Data Found" };
      } else {
        const menuItem = filterMenuByFeatures(
          mergeAndFilterMenus(COMMONMENUITEMS, MENU).filter(
            (ie) =>
              menu?.permissions?.includes(ie?.path) ||
              // Derived pages (e.g. "previous employees") appear when the admin
              // can access the matching parent page.
              (DERIVED_ACCESS[ie?.path] &&
                menu?.permissions?.includes(DERIVED_ACCESS[ie?.path])),
          ),
          features
        );
        const data = {
          success: true,
          data: JSON.stringify(inTheirWords(menuItem)),
        };
        return data;
      }
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error Occured" };
  }
};

// export const getEmployeeMenu = async () => {
//   try {
//     const { props } = await getServerSideProps();
//     const employeeId = props?.session?.user?._id;
//     const role = props?.session?.user?.role;
//     if (role === "superAdmin") {
//       return {
//         success: true,
//         data: JSON.stringify([...PERSONAL_MENU, ...MENU]),
//       };
//     }

//     await connect();
//     const dbEntry = await RoleBasedModel.findOne({ employeeId: employeeId });
//     const userPermissions = dbEntry?.permissions || [];

//     const allowedManagement = MENU.filter((item) =>
//       userPermissions.includes(item.path)
//     );

//     const finalMenu = [...PERSONAL_MENU, ...allowedManagement, COMMONMENUITEMS];
//     return { success: true, data: JSON.stringify(finalMenu) };
//   } catch (error) {
//     console.log(error);
//     return { success: false, message: "Error Occured" };
//   }
// };

export const getSelectLeaveCategories = async () => {
  const denied = await permissionRefusal([], ADMINISTERS_SOMETHING);
  if (denied) return denied;

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
    // The company's leave year. Pinned to April's before, which meant the
    // $match below found no entitlement document and this dropdown came back
    // EMPTY — an employee at a company on any other leave year could not
    // request leave at all, because there was nothing to pick.
    const leaveYear = await currentLeaveYear();
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
              cond: {
                $and: [
                  { $eq: ["$$item.isHide", false] },
                  // A leave type an admin has removed from this employee is not
                  // theirs to book. `isDelete` was written by
                  // deleteOneCommonLeaveToOneEmployee and read by nothing, so a
                  // removed type kept appearing here with a balance behind it.
                  // `$ne: true` rather than `$eq: false` — the flag is absent on
                  // every row written before the soft delete existed.
                  { $ne: ["$$item.isDelete", true] },
                ],
              },
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

// getSelectExpenseCategory and getSelectExpenseCategoryBySite used to live here.
// They moved to server/expenseServer/expenseServer.js so that they sit behind
// requireExpenseAccess with the rest of the feature — every other export in this
// file is readable by any signed-in user, which is the wrong default for a
// module a company's plan can exclude.

export const getSelectFormTemplates = async () => {
  const denied = await permissionRefusal([], ADMINISTERS_SOMETHING);
  if (denied) return denied;

  try {
    await connect();
    const templates = await FormTemplateModel.aggregate([
      // {
      //   $match: { isActive: true, isDeleted: false }, // Filters documents where delete is false
      // },
      {
        $project: {
          _id: 0,
          value: "$_id", // Renames `_id` to `value`
          label: "$templateName", // Renames `roleTitle` to `name`
        },
      },
    ]).exec();

    if (!templates || templates.length === 0) {
      return { success: false, message: "No Data Found" };
    } else {
      const data = {
        success: true,
        data: JSON.stringify(templates),
      };
      return data;
    }
  } catch (err) {
    console.log(err);
    return { success: false, message: "Error Occured" };
  }
};
