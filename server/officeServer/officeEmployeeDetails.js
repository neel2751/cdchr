"use server";

import { getServerSideProps } from "../session/session";
import { connect } from "@/db/db";
import mongoose from "mongoose";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { decrypt } from "@/lib/algo";
import { hashPassword, isMatchedPassword } from "@/utils/bcrypt";

async function extractData(params) {
  try {
    const { props } = await getServerSideProps();
    const { role, _id } = props?.session?.user;
    const res = decrypt(params[0]);
    const employeeId = role === "superAdmin" ? res : _id;
    return employeeId;
  } catch (error) {
    console.error(error);
  }
}

export async function employeeDeatils(params) {
  try {
    const employeeId = await extractData(params);
    await connect();
    const pipeline = [
      {
        $match: {
          _id: new mongoose.Types.ObjectId(employeeId),
        },
      },
      {
        $lookup: {
          from: "roletypes",
          localField: "department",
          foreignField: "_id",
          as: "departmentview",
        },
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
        $replaceRoot: {
          newRoot: {
            // remove password
            $mergeObjects: [
              "$$ROOT",
              {
                departmentView: {
                  $arrayElemAt: ["$departmentview.roleTitle", 0],
                },
              },
              // send company name and _id under one company object
              {
                companyName: {
                  $arrayElemAt: ["$companys.name", 0],
                },
              },
            ],
          },
        },
      },
      {
        $unset: ["password", "departmentview", "companys"],
      },
    ];
    // we have to set the signal as well in this case
    const employeeDeatils = await OfficeEmployeeModel.aggregate(pipeline);
    return { success: true, data: JSON.stringify(employeeDeatils[0]) };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error fetching employee details" };
  }
}

export async function employeeLeaveDetailsNew(data) {
  try {
    const params = data?.searchParams;
    const leaveYear = data?.leaveYear;
    const employeeId = await extractData(params);
    if (!employeeId) return { success: false, message: "User not found" };

    await connect();
    const checkLeaveYear = Number(parseInt(leaveYear)) || getYear(new Date());
    const match = {
      leaveYear: checkLeaveYear,
      employeeId: new mongoose.Types.ObjectId(employeeId),
    };

    const lookup = {
      from: "officeemployes",
      localField: "employeeId",
      foreignField: "_id",
      as: "employees",
    };

    const approveLookup = {
      from: "officeemployes",
      localField: "approvedBy",
      foreignField: "_id",
      as: "admin",
    };

    const pipeline = [
      { $match: match },
      { $sort: { leaveSubmitDate: -1 } },
      { $lookup: lookup },
      { $lookup: approveLookup },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$$ROOT",
              {
                employee: {
                  name: { $arrayElemAt: ["$employees.name", 0] },
                  role: { $arrayElemAt: ["$employees.roleType", 0] },
                },
                approvedBy: {
                  name: { $arrayElemAt: ["$admin.name", 0] },
                },
              },
            ],
          },
        },
      },
      { $unset: ["employees", "admin"] },
    ];

    const leaveData = await LeaveRequestModel.aggregate(pipeline);
    return { success: true, data: JSON.stringify(leaveData) };
  } catch (error) {
    console.log("Get Leave Request Data for Admin", error);
    return { success: false, message: "Failed to get leave request data" };
  }
}

export async function employeeLeaveDetails(params) {
  try {
    const employeeId = await extractData(params);
    await connect();
    const pipeline = [
      {
        $match: {
          employeeId: new mongoose.Types.ObjectId(employeeId),
          leaveYear: new Date().getFullYear(),
        },
      },
    ];
    const leaveDetails = await LeaveRequestModel.aggregate(pipeline);
    console.log(leaveDetails);
    return { success: true, data: JSON.stringify(leaveDetails) };
  } catch (error) {
    console.log(error);
    return { success: false, message: "Error fetching employee leave details" };
  }
}

export async function updateOfficeEmployeeData(data) {
  if (!data) return { success: false, message: "No Data Provided" };
  const { employeeId: id, tab } = data;
  try {
    const updatedEmp = await OfficeEmployeeModel.findOne({ _id: id }).exec();
    if (id && tab === "basic") {
      // update an existing office employee
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
      // check password is hash or not

      Object.assign(updatedEmp, data);
      const updatedData = await updatedEmp.save();
      if (!updatedData)
        return { success: false, message: "Error Updating Employee" };
      return { success: true, data: JSON.stringify(updatedData) };
    } else {
      Object.assign(updatedEmp, data);
      const updatedData = await updatedEmp.save();
      if (!updatedData)
        return { success: false, message: "Error Updating Employee" };
      return { success: true, data: JSON.stringify(updatedData) };
    }
  } catch (error) {
    console.log(error.message);
    return {
      success: false,
      message: "Something went wrong on Office Employee",
    };
    // return {
    //   success: false,
    //   error: "Failed to create office employee",
    // };
  }
  // const isExists = await OfficeEmployeeModel.findOne({ email }).lean().exec();
}

export async function changeOfficeEmployeePassword(data, id) {
  if (!data) return { success: false, message: "No Data Provided" };
  const { props } = await getServerSideProps();
  const { role, _id } = props?.session?.user;
  const employeeId = role === "superAdmin" ? decrypt(id) : _id;
  if (!employeeId) return { success: false, message: "User not found" };
  const { currentPassword, newPassword } = data;
  if (role !== "superAdmin" && role !== "admin") {
    if (!currentPassword)
      return { success: false, message: "Current Password is required" };
  }
  if (!newPassword)
    return { success: false, message: "New Password is required" };
  try {
    await connect();
    const updatedEmp = await OfficeEmployeeModel.findOne({
      _id: employeeId,
    }).exec();
    if (!updatedEmp) {
      return { success: false, message: "Employee Not Found" };
    }
    // if the user is not superAdmin or admin, check for current password
    if (role !== "superAdmin" && role !== "admin") {
      const isMatch = await isMatchedPassword(
        currentPassword,
        updatedEmp.password
      );
      if (!isMatch) {
        return { success: false, message: "Current Password is Incorrect" };
      }
    }
    const hashedPassword = await hashPassword(newPassword);
    if (!hashedPassword) {
      return { success: false, message: "Error Hashing Password" };
    }
    updatedEmp.password = hashedPassword; // Update the password with the new hashed password
    const updatedData = await updatedEmp.save();
    if (!updatedData) {
      return { success: false, message: "Error Updating Password" };
    }
    return { success: true, message: "Password Changed Successfully" };
  } catch (error) {
    console.log("Error in changeOfficeEmployeePassword:", error);
    return { success: false, message: "Error Changing Password" };
  }
}
