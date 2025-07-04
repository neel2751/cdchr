"use server";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import bcrypt from "bcryptjs";
import { storeLeave } from "../leaveServer/leaveServer";
import { createObjectId } from "@/lib/mongodb";

export const handleOfficeEmployee = async (data, id) => {
  // make dealy for  testing
  // await new Promise((resolve) => setTimeout(resolve, 1000));
  // return;
  // check if email and phone  already exist in db
  if (!data) return { success: false, message: "No Data Provided" };
  try {
    if (id) {
      // update an existing office employee
      const updatedEmp = await OfficeEmployeeModel.findOne({ _id: id }).exec();
      if (!updatedEmp) {
        return { success: false, message: "Employee Not Found" };
      }
      // checking  for unique fields both email and phone
      const hasSameEmail = await OfficeEmployeeModel.findOne({
        email: data.email,
        delete: false, // only check for active employees
        _id: { $ne: id },
      }).exec();
      const hasSamePhone = await OfficeEmployeeModel.findOne({
        phoneNumber: data.phoneNumber,
        delete: false, // only check for active employees
        _id: { $ne: id },
      }).exec();
      if (hasSameEmail || hasSamePhone) {
        throw new Error("This Email or Phone Number is Already In Use");
      }
      Object.assign(updatedEmp, data);
      const updatedData = await updatedEmp.save();
      if (!updatedData)
        return { success: false, message: "Error Updating Employee" };
      return { success: true, data: JSON.stringify(updatedData) };
    } else {
      const { email, phoneNumber } = data;
      // we have check if the email, phone, and password is not return
      if (!email || !phoneNumber)
        return { success: false, message: "Please Provid All Required Fields" };
      const hashPass = await GenerateHashPassword("Cdc@1234");
      await connect();
      let userExist = await OfficeEmployeeModel.findOne({
        delete: false, // only check for active employees
        $or: [{ email }, { phoneNumber }],
      });
      if (!userExist) {
        const newUser = new OfficeEmployeeModel({
          ...data,
          password: hashPass,
        });

        const result = await newUser.save();
        if (!result)
          return {
            success: false,
            message: "Failed to create office Employee",
          };
        const employeeId = result?._id;
        const leaveResult = await storeLeave(employeeId, data);
        if (!leaveResult?.success)
          return { success: false, message: leaveResult.message };
        return {
          success: true,
          message: "Successfully added office employee",
        };
      } else {
        return {
          success: false,
          message: "Email or Phone number is already taken",
        };
      }
    }
  } catch (error) {
    console.log("Error in handleOfficeEmployee: ", error);
    return {
      success: false,
      message: "Something went wrong on Office Employee",
    };
  }
};

export const getOfficeEmployee = async (filterData) => {
  try {
    await connect();
    const sanitizedSearch = filterData?.query?.trim() || ""; // Ensure search is a string
    // const searchRegex = new RegExp(sanitizedSearch, "i"); // Create a case-ins ensitive regex
    const validPage = parseInt(filterData?.page || 1);
    const validLimit = parseInt(filterData?.pageSize || 10);
    const roleTypeFilter = filterData?.filter?.role;
    const companyFilter = filterData?.filter?.company;
    const filterType = filterData?.filter?.type;
    const skip = (validPage - 1) * validLimit;
    const query = { delete: false };

    const roleTypeFilterQuery = roleTypeFilter
      ? { "departments._id": createObjectId(roleTypeFilter) } // Field for department filter
      : {};

    const companyFilterQuery = companyFilter
      ? { "companys._id": new createObjectId(companyFilter) } // Field for company filter
      : {};

    if (filterType) {
      query.immigrationType = filterType;
    }
    if (sanitizedSearch) {
      query.$or = [
        { name: { $regex: sanitizedSearch, $options: "i" } },
        { email: { $regex: sanitizedSearch, $options: "i" } },
        // { phoneNumber: { $regex: sanitizedSearch, $options: "i" } },
      ];
    }

    const pipeline = [
      {
        $match: query,
      },
      {
        $lookup: {
          from: "companies",
          localField: "company",
          foreignField: "_id",
          as: "companys",
        },
      },
      {
        $lookup: {
          from: "roletypes",
          localField: "department",
          foreignField: "_id",
          as: "departments",
        },
      },
      {
        $match: {
          ...roleTypeFilterQuery,
          ...companyFilterQuery,
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$$ROOT",
              // remove password not null we don't want to expose password

              {
                department: {
                  roleTitle: { $arrayElemAt: ["$departments.roleTitle", 0] },
                  _id: { $arrayElemAt: ["$departments._id", 0] },
                },
                company: {
                  name: { $arrayElemAt: ["$companys.name", 0] },
                  _id: { $arrayElemAt: ["$companys._id", 0] },
                },
              },
            ],
          },
        },
      },
      {
        $unset: "password",
      },
      {
        $facet: {
          totalCount: [{ $count: "count" }],
          result: [
            {
              $skip: Number(skip) || 0,
            },
            {
              $limit: Number(validLimit) || 10,
            },
          ],
        },
      },
    ];
    const officeEmployee = await OfficeEmployeeModel.aggregate(pipeline);
    const totalCount = officeEmployee[0].totalCount[0].count;
    const result = officeEmployee[0].result;

    return {
      success: true,
      data: JSON.stringify(result),
      totalCount: totalCount,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      message: "Failed to get office employee",
      data: JSON.stringify([]),
      totalCount: 0,
    };
  }
};

export const getEmployeById = async (empId) => {
  if (!empId) return { success: false, message: "No Employee Id Provided" };
  try {
    const response = await OfficeEmployeeModel.findOne({ _id: empId });
    if (!response)
      return {
        success: false,
        message: `Employee not found with the provided Id ${empId}`,
      };
    return { success: true, data: JSON.stringify(response) };
  } catch (error) {
    return { success: false, message: "Server error" };
  }
};

export const isPossibleBcryptHash = async (password) => {
  const bcryptPattern = /^\$2[ay]\$\d+\$[0-9a-zA-Z./]+$/;
  return bcryptPattern.test(password);
};

export const GenerateHashPassword = async (password) => {
  try {
    const salt = bcrypt.genSaltSync(10);
    const hashPassword = bcrypt.hashSync(password, salt);
    return hashPassword;
  } catch (error) {
    console.log("Error hashing password: ", error);
  }
};

export const OfficeEmployeeStatus = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = !data?.status;
    const statusDate = data.status ? new Date() : null;
    await OfficeEmployeeModel.updateOne(
      { _id: id },
      { $set: { isActive, statusDate } }
    );
    return {
      success: true,
      message: "The Status of the Assign Project has been Updated",
    };
  } catch (error) {
    console.log(error);
    return { success: false, message: `Error Occurred in server problem` };
  }
};

export const officeEmployeeDelete = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = false;
    const isDelete = true;
    const statusDate = new Date();
    await OfficeEmployeeModel.updateOne(
      { _id: id },
      { $set: { isActive, delete: isDelete, statusDate } }
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

export const getSuperAdmins = async () => {
  try {
    const allAdmin = await OfficeEmployeeModel.find(
      { isSuperAdmin: true },
      { name: 1, email: 1 }
    );
    return {
      success: true,
      message: "All Super Admins",
      data: allAdmin,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      message: "Something went wrong",
    };
  }
};
