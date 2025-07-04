"use server";
import { connect } from "@/db/db";
import CompanyModel from "@/models/companyModel";

export async function getCompanies(filterData) {
  try {
    await connect();
    const sanitizedSearch = filterData?.query?.trim() || ""; // Ensure search is a string
    // const searchRegex = new RegExp(sanitizedSearch, "i"); // Create a case-ins ensitive regex
    const validPage = parseInt(filterData?.page || 1);
    const validLimit = parseInt(filterData?.pageSize || 10);
    const skip = (validPage - 1) * validLimit;
    const query = { delete: false };
    if (sanitizedSearch) {
      query.$or = [{ name: { $regex: sanitizedSearch, $options: "i" } }];
    }
    const totalCountDocuments = await CompanyModel.countDocuments(query);
    const pipeline = [
      {
        $match: query,
      },
      {
        $sort: { updatedAt: -1 },
      },
      {
        $skip: skip,
      },
      {
        $limit: validLimit,
      },
    ];
    const companies = await CompanyModel.aggregate(pipeline);
    return {
      success: true,
      data: JSON.stringify(companies),
      totalCount: totalCountDocuments,
    };
  } catch (error) {
    console.log("error", error);
    return {
      success: false,
      message: " Error fetching comapnies",
    };
  }
}

export const handleCompany = async (data, id) => {
  // make artifical  delay
  // await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!data) return { success: false, message: "No Data Provided" };
  try {
    if (id) {
      let company = await CompanyModel.findById(id);
      if (!company)
        return {
          success: false,
          message: `company not found please try  again`,
        };
      const roleType = await CompanyModel.updateOne({ _id: id }, data);

      if (!roleType)
        return { success: false, message: "Failed to Update  the Record" };
      // revalidatePath("/"); // revalidate the path
      const datas = {
        success: true,
        message: `Successfully Upadted Information`,
      };
      return datas;
    } else {
      const addRoleType = new CompanyModel(data);
      const saveSite = await addRoleType.save();
      if (!saveSite)
        return {
          success: false,
          message: `Failed to Add Company Information`,
        };

      if (saveSite) {
        const data = {
          success: true,
          message: "Add Company Successfully...",
        };
        return data;
      }
    }
  } catch (error) {
    console.log("Error in updatin company information by Id ", error);
    return { success: false, message: `Internal Server Error` };
  }
};

export const companyStatus = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = !data?.status;
    await CompanyModel.updateOne({ _id: id }, { $set: { isActive } });
    return {
      success: true,
      message: "The Status has been updated successfully",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};

export const companyDelete = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = false;
    const isDelete = true;
    await CompanyModel.updateOne(
      { _id: id },
      { $set: { isActive, delete: isDelete } }
    );
    return {
      success: true,
      message: " The Company has been deleted successfully",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};
