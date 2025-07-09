"use server";
import { connect } from "@/db/db";
import ProjectSiteModel from "@/models/siteProjectModel";

// # THIS IS THE WORKING ON THE NEW VERSION
export const searchSiteProjectByKeywordNew = async (filterData) => {
  try {
    const sanitizedSearch = filterData?.query?.trim() || ""; // Ensure search is a string
    // const searchRegex = new RegExp(sanitizedSearch, "i"); // Create a case-ins ensitive regex
    const validPage = parseInt(filterData?.page || 1);
    const validLimit = parseInt(filterData?.pageSize || 10);
    const skip = (validPage - 1) * validLimit;
    const siteType = filterData?.filter?.type;
    // const query = { delete: false };
    const query = { siteDelete: false };
    if (siteType) {
      query.siteType = siteType;
    }
    if (sanitizedSearch) {
      query.$or = [
        { siteName: { $regex: sanitizedSearch, $options: "i" } },
        { siteType: { $regex: sanitizedSearch, $options: "i" } },
        { siteAddress: { $regex: sanitizedSearch, $options: "i" } }, // added this line
        // { phoneNumber: { $regex: sanitizedSearch, $options: "i" } },
      ];
    }
    await connect();
    const totalCountDocuments = await ProjectSiteModel.countDocuments(query);

    const pipleline = [
      {
        $match: query,
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
    const result = await ProjectSiteModel.aggregate(pipleline);
    return {
      success: true,
      data: JSON.stringify(result),
      totalCount: totalCountDocuments,
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Something  went wrong" }; // return error message
  }
};

// # UPDATE A SPECIFIC SITE PROJECT INFORMATION BY ID
export const updateSiteProjectById = async (data, id) => {
  try {
    await connect();
    if (id) {
      await ProjectSiteModel.findByIdAndUpdate(id, data, { new: true });
      return {
        success: true,
        message: "Site Project updated successfully",
      };
    } else {
      await ProjectSiteModel.create(data).catch((error) => {
        console.error("Error creating ProjectSite:", error);
        // throw new Error("Database operation failed");
      });
      return {
        success: true,
        message: "Site Project created successfully",
      };
    }
  } catch (e) {
    return { success: false, message: "Server Error" }; // return error message
  }
};

export const getSiteById = async (siteId) => {
  console.log("Site Id", siteId);
  if (!siteId) return { success: false, message: "Site Id is required." };
  try {
    // const response = await ProjectSiteModel.findOne({where:{id: siteId}}).populate('users');
    const response = await ProjectSiteModel.findOne({ _id: siteId });
    if (response.isActive) return { success: true, message: "success" };
    else
      return { success: false, message: "This site is not active right Now" };
  } catch (error) {
    console.log(`Error in getting site by id ${error}`);
    return { success: false, message: "Error in getting site by id" };
  }
};

export const siteProjectStatus = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = !data?.status;
    const statusDate = data.status ? new Date() : null;
    await ProjectSiteModel.updateOne(
      { _id: id },
      { $set: { isActive, statusDate } }
    );
    return {
      success: true,
      message: "The Status of the Site Project has been Updated",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};

export const siteProjectDelete = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = false;
    const isDelete = true;
    const statusDate = new Date();
    await ProjectSiteModel.updateOne(
      { _id: id },
      { $set: { isActive, delete: isDelete, statusDate } }
    );
    return {
      success: true,
      message: "The  Status of the Site Project has been Updated",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};
