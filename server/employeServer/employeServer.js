"use server";
import { connect } from "@/db/db";
import EmployeModel from "@/models/employeModel";
import { GenerateHashPassword } from "../officeServer/officeServer";
import { getServerSideProps } from "../session/session";
import { hashPassword, isMatchedPassword } from "@/utils/bcrypt";

export const getAllEmployees = async (filterData) => {
  const sanitizedSearch = filterData?.query?.trim() || ""; // Ensure search is a string
  // const searchRegex = new RegExp(sanitizedSearch, "i"); // Create a case-ins ensitive regex
  const validPage = parseInt(filterData?.page || 1);
  const validLimit = parseInt(filterData?.pageSize || 10);
  const paymentType = filterData?.filter?.employeType;
  const immigrationType = filterData?.filter?.type;
  const skip = (validPage - 1) * validLimit;
  const query = { delete: false };
  if (paymentType) {
    query.paymentType = paymentType;
  }
  if (immigrationType) {
    query.immigrationType = immigrationType;
  }
  if (sanitizedSearch) {
    query.$or = [
      { firstName: { $regex: sanitizedSearch, $options: "i" } },
      { lastName: { $regex: sanitizedSearch, $options: "i" } },
      { email: { $regex: sanitizedSearch, $options: "i" } },
      // { phoneNumber: { $regex: sanitizedSearch, $options: "i" } },
    ];
  }
  try {
    const totalEmployees = await EmployeModel.countDocuments(query);

    const pipeline = [
      {
        $match: query,
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $skip: skip,
      },
      {
        $limit: validLimit,
      },
    ];

    const employees = await EmployeModel.aggregate(pipeline);
    // RangeError handling  for empty array
    if (!filterData) return { success: false, message: "No employees found" };
    const data = {
      success: true,
      totalCount: totalEmployees,
      data: JSON.stringify(employees),
    };
    return data;
  } catch (err) {
    return {
      success: false,
      message: "Error fetching employees!, Refresh Page",
    };
  }
};

export const handleEmploye = async (data, isChecked, id) => {
  if (!data) return { status: false, message: "Please Provide Informations" };
  // if (!images) return { status: true, message: "success" };
  const payRateValidation = /^([1-9][\d]{0,7})(\.\d{0,2})?$/; // 1.5 or 15.68 or .34 only
  const Payrate = payRateValidation.test(String(Number(data?.payRate)));
  if (Payrate === false) return { status: false, message: "Invalid Pay Rate" };
  try {
    const employeType = data?.paymentType === "Monthly" ? "Payroll" : "CIS";
    await connect(); //connect to the database
    const {
      address,
      streetAddress,
      city,
      zipCode,
      country,
      accountName,
      accountNumber,
      sortCode,
      payRate,
    } = data;
    const eAddress = {
      address: address || "",
      streetAddress: streetAddress || "",
      city: city || "",
      zipCode: zipCode || "",
      country: country || "",
    };
    const bankDetail = {
      accountName: accountName || "",
      accountNumber: accountNumber || "",
      sortCode: sortCode || "",
    };
    if (id) {
      // We have to check email and phone  before updating the Employee's information because they are required fields in MongoDB
      const isExists = await EmployePhoneAndEmailExists(
        id,
        data.phone,
        data.email
      );
      if (!isExists.status)
        return { success: isExists.status, message: isExists.message };
      let res = await EmployeModel.findByIdAndUpdate(
        id,
        {
          $set: {
            ...data,
            eAddress: eAddress,
            bankDetail: bankDetail,
            employeType,
          },
        },
        { new: true }
      );
      if (!res) return { success: false, message: "Somthing Went Wrong..." };
      if (isChecked) {
        const attendanceRecords = await AttendanceModel.find({
          "employeAttendance.employeeId": id,
        });
        for (const record of attendanceRecords) {
          for (const attendee of record.employeAttendance) {
            if (attendee.employeeId.toString() === id) {
              attendee.aPayRate = payRate; // Update aPayRate
              attendee.totalPay = attendee.totalHours * payRate;
            }
          }
          // Save the updated attendance record
          await record.save();
        }
      }
      return { success: true, message: "Employee Record Update..." };
    } else {
      //create new employee
      const isExists = await EmployePhoneAndEmailExists(
        id,
        data.phone,
        data.email
      );
      const password = await GenerateHashPassword("Cdc@1234");
      if (!isExists.status) return isExists;
      const addEmploye = await EmployeModel.create({
        ...data,
        eAddress: eAddress,
        bankDetail: bankDetail,
        employeType,
        password,
      }); // create new employee
      if (!addEmploye)
        return { success: false, message: "Somthing Went Wrong..." }; // if the employee is not created
      if (addEmploye) {
        const data = {
          success: true,
          message: `Employee added successfully`,
        };
        return data;
      }
    }
  } catch (error) {
    console.log(error);
    return { success: false, message: "Somthing Went Wrong..." }; // if the employee is not created
  }
};

const EmployePhoneAndEmailExists = async (id, phone, email) => {
  try {
    if (id) {
      if (email === "") {
        const phoneExist = await EmployeModel.findOne({
          phone,
          _id: { $ne: id },
        });
        if (phoneExist)
          return { status: false, message: "Phone number already exist" };
        return { status: true, message: "Phone number is available" };
      } else {
        const phoneExist = await EmployeModel.findOne({
          phone,
          _id: { $ne: id },
        });
        const emailExist = await EmployeModel.findOne({
          email,
          _id: { $ne: id },
        });
        if (phoneExist || emailExist) {
          return {
            status: false,
            message: "This Phone  or Email is already in use.",
          };
        } else {
          return { status: true, message: "Both fields are available" };
        }
      }
    } else {
      // if email is empty  then only check for the phone otherwise both should be checked $or operator
      if (email === "") {
        const phoneCheck = await EmployeModel.findOne({ phone: phone });
        if (phoneCheck) {
          return {
            status: false,
            message: "The provided phone number is already registered.",
          };
        } else {
          return { status: true };
        }
      } else {
        const combinedCheck = await EmployeModel.findOne({
          $or: [{ email }, { phone }],
        });
        if (combinedCheck) {
          return {
            status: false,
            message:
              "The provided email or phone number is already registered.",
          };
        } else {
          return { status: true };
        }
      }
    }
  } catch (err) {
    console.log(err);
  }
};

export const employeeStatus = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = !data?.status;
    const statusDate = data.status ? new Date() : null;
    await EmployeModel.updateOne(
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

export const employeeDelete = async (data) => {
  if (!data) return { success: false, message: "Not found" };
  try {
    const id = data?.id;
    const isActive = false;
    const isDelete = true;
    const statusDate = new Date();
    await EmployeModel.updateOne(
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

export async function changeSiteEmployeePassword(data) {
  if (!data) return { success: false, message: "No Data Provided" };
  const { props } = await getServerSideProps();
  const { _id: employeeId } = props?.session?.user;
  if (!employeeId) return { success: false, message: "User not found" };
  const { currentPassword, newPassword } = data;
  if (!currentPassword)
    return { success: false, message: "Current Password is required" };
  if (!newPassword)
    return { success: false, message: "New Password is required" };
  try {
    await connect();
    const updatedEmp = await EmployeModel.findOne({
      _id: employeeId,
    }).exec();
    if (!updatedEmp) {
      return { success: false, message: "Employee Not Found" };
    }
    // if the user is not superAdmin or admin, check for current password
    const isMatch = await isMatchedPassword(
      currentPassword,
      updatedEmp.password
    );
    if (!isMatch) {
      return { success: false, message: "Current Password is Incorrect" };
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
    console.log("Error in changeSiteEmployeePassword:", error);
    return { success: false, message: "Error Changing Password" };
  }
}
