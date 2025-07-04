"use server";
import SiteAssignManagerModel from "@/models/siteAssignManagerModel";
import { getSiteById } from "../siteProjectServer/siteProjectServer";
import { getEmployeById } from "../officeServer/officeServer";
import { connect } from "@/db/db";
import { getServerSideProps } from "../session/session";
import { createObjectId } from "@/lib/mongodb";

export async function getAllSiteAssign(filterData) {
  if (!filterData)
    return { success: false, message: "No filter data provided" };
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const role = props?.session?.user?.role;
    if (!employeeId || !role) {
      return { success: false, message: "Unauthorized access" };
    }
    await connect();
    const validPage = Number.isInteger(parseInt(filterData?.page))
      ? parseInt(filterData.page)
      : 1;
    const validLimit = Number.isInteger(parseInt(filterData?.pageSize))
      ? parseInt(filterData.pageSize)
      : 10;

    const sanitizedSearch = filterData?.query?.trim() || "";
    const skip = (validPage - 1) * validLimit;
    const query = { isDelete: false };

    // we have to check if the user is admin or superAdmin they can see all the data
    if (role !== "admin" && role !== "superAdmin") {
      // If the user is not admin or superAdmin, filter by employeeId
      // This means they can only see their own assigned sites
      query.roleId = createObjectId(employeeId);
      // query.isActive = true; // Ensure we only get active assignments
    }

    // If the user is admin or superAdmin, they can filter by search query
    if (role === "admin" || role === "superAdmin") {
      // If a search query is provided, add it to the query object
      // The search query will match role name, site name, site address, and site type
      if (sanitizedSearch || sanitizedSearch.length < 3)
        // Using regex to search for the query in role name, site name, site address, and site type
        query.$or = [
          { "role.name": { $regex: sanitizedSearch, $options: "i" } },
          {
            "projectSite.siteName": { $regex: sanitizedSearch, $options: "i" },
          },
          {
            "projectSite.siteAddress": {
              $regex: sanitizedSearch,
              $options: "i",
            },
          },
          {
            "projectSite.siteType": { $regex: sanitizedSearch, $options: "i" },
          },
        ];
    } else {
      // If the user is not admin or superAdmin, we can only search by site name
      if (sanitizedSearch) {
        query.$or = [
          {
            "projectSite.siteName": { $regex: sanitizedSearch, $options: "i" },
          },
        ];
      }
    }

    const pipleline = [
      {
        $lookup: {
          from: "officeemployes",
          localField: "roleId",
          foreignField: "_id",
          as: "role",
        },
      },
      {
        $lookup: {
          from: "projectsites",
          localField: "projectSiteID",
          foreignField: "_id",
          as: "projectSite",
        },
      },
      {
        $match: query,
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$$ROOT",
              {
                roleName: { $arrayElemAt: ["$role.name", 0] },
                siteName: { $arrayElemAt: ["$projectSite.siteName", 0] },
                siteAddress: { $arrayElemAt: ["$projectSite.siteAddress", 0] },
                siteType: { $arrayElemAt: ["$projectSite.siteType", 0] },
                siteStatus: { $arrayElemAt: ["$projectSite.status", 0] },
              },
            ],
          },
        },
      },
      {
        $skip: skip,
      },
      {
        $limit: validLimit,
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
    ];
    const [totalCountDocuments, siteData] = await Promise.all([
      SiteAssignManagerModel.countDocuments(query),
      SiteAssignManagerModel.aggregate(pipleline),
    ]);
    const data = {
      success: true,
      data: JSON.stringify(siteData),
      totalCount: totalCountDocuments,
    };
    return data;
  } catch (error) {
    console.log("Error in getAllSiteAssign", error);
    return {
      success: false,
      message: "An error occurred while fetching data.",
    };
  }
}

export async function handleSiteAssignManager(data, id) {
  if (!data) return { success: false, message: "No data provided" };
  //Checking if the site id and user id are valid
  try {
    // check if employed id and  site id exists in database with status true and delete false to already assigned error
    const proId = data?.projectSiteID;
    const rolId = data.roleId;
    const siteData = await isSiteandNameisExists(id, proId);
    if (!siteData?.success) return siteData;
    //Getting the site information to check if it exists
    const siteInfo = await getSiteById(proId);
    if (!siteInfo?.success) return siteInfo;

    const employeInfo = await getEmployeById(rolId);
    if (!employeInfo?.success)
      return { success: false, message: `Failed to retrieve employee` };

    const info = JSON.parse(employeInfo?.data);
    const password = info?.password;
    const email = info?.email;

    // we have to add permission to the site assign manager
    if (!proId || !rolId || !password || !email)
      return { success: false, message: "Required fields are missing" };

    if (id) {
      const updateAssign = {
        password,
        email,
        projectSiteID: proId,
        roleId: rolId,
        isActive: true,
      };
      const updateAssignData = await SiteAssignManagerModel.updateOne(
        { _id: id },
        { $set: updateAssign }
      ).exec();

      if (!updateAssignData)
        return { success: false, message: "Faild to Update Assign..." };
      return {
        success: true,
        message: `The Project has been updated Successfully`,
      };
    } else {
      // generate the Random Interger using  crypto
      const loginSiteId = crypto.randomUUID();
      //   const loginSiteId = randomInt(1000000, 9999999).toString();
      const assignData = { ...data, loginSiteId, email, password };

      const result = await assignSiteData(assignData);
      if (!result) return { success: false, message: "Failed to Assign" };
      return result;
    }
  } catch (e) {
    return { success: false, message: e };
  }
}

const assignSiteData = async (assignData) => {
  if (!assignData) return { success: false, message: "No Data assign" };
  try {
    const assign = new SiteAssignManagerModel(assignData);
    const res = await assign.save();
    if (!res)
      return { success: false, message: "No Data saved. somthing wrong" };
    return { success: true, data: JSON.stringify(res) };
  } catch (error) {
    console.log("from assignSiteData", error);
    return { success: false, message: error };
  }
};

const isSiteandNameisExists = async (id, projectSiteID) => {
  try {
    if (!id) {
      // const existingAssignment = await SiteAssignManagerModel.findOne({
      //   roleId: roleId,
      //   // isActive: true,
      // });
      // if (existingAssignment)
      //   return { success: false, message: "This Role already assigned" };
      const existingSite = await SiteAssignManagerModel.findOne({
        projectSiteID: projectSiteID,
        // isActive: true,
      });
      if (existingSite) {
        return { success: false, message: "This Site is Already Assigned." };
      }
      return true;
    }
    if (id) {
      const existingAssignment = await SiteAssignManagerModel.find({
        projectSiteID: projectSiteID, // exclude the current project site
        _id: { $ne: id }, // Exclude the current assignment
      });
      if (existingAssignment.length > 0) {
        return {
          success: false,
          message: "This Site Already Assigned Another Role.",
        };
      }
      return true;
    }
  } catch (error) {
    console.log("this error come from isSiteandNameisExists", error);
    return { success: false, message: "Error checking while Assignment" };
  }
};

export const handleSiteAssignManagerStatus = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = !data?.status;
    await SiteAssignManagerModel.updateOne({ _id: id }, { $set: { isActive } });
    return {
      success: true,
      message: "The  Status of the Assign Project has been Updated",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};

export const handleSiteAssignManagerDelete = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = false;
    const isDelete = true;
    await SiteAssignManagerModel.updateOne(
      { _id: id },
      { $set: { isActive, isDelete } }
    );
    return {
      success: true,
      message: "The  Status of the Assign Project has been Updated",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};
