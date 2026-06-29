"use server";
import { connect } from "@/db/db";
import EmployeModel from "@/models/employeModel";
import { GenerateHashPassword } from "../officeServer/officeServer";
import { getServerSideProps } from "../session/session";
import { hashPassword, isMatchedPassword } from "@/utils/bcrypt";
import { extractData } from "../officeServer/officeEmployeeDetails";
import { createObjectId } from "@/lib/mongodb";
import { getSMTPForFeature, userRegisterEmail } from "../email/emailSMTP";
import { decrypt } from "@/lib/algo";
import SiteClockModel from "@/models/siteClockModel";
import { normalizeDateToUTC } from "@/lib/formatDate";
import { withAudit, recordAudit } from "@/lib/audit";
import { logVisaExpiryChange } from "../visaServer/visaAudit";
import { getLockedEmails, clearLockByEmail } from "@/lib/rateLimit";

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

  // Account status filter (active / inactive). Deleted already excluded.
  const accountStatus = filterData?.filter?.status;
  if (accountStatus === "active") query.isActive = true;
  else if (accountStatus === "inactive") query.isActive = false;

  // Visa status filter on eVisaExp. Requiring a date excludes British/no-visa.
  const visaStatus = filterData?.filter?.visaStatus;
  if (visaStatus && visaStatus !== "all") {
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 90);
    if (visaStatus === "expired") {
      query.eVisaExp = { $ne: null, $lt: now };
    } else if (visaStatus === "expiring") {
      query.eVisaExp = { $ne: null, $gte: now, $lte: horizon };
    } else if (visaStatus === "valid") {
      query.eVisaExp = { $ne: null, $gt: horizon };
    }
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
      {
        $lookup: {
          from: "auditlogs",
          let: { empId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$entityId", "$$empId"] },
                    { $eq: ["$module", "Visa"] },
                    { $eq: ["$action", "Visa.reminderSent"] },
                    { $eq: ["$status", "success"] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 0,
                milestone: "$metadata.milestone",
                visaEndDate: "$metadata.visaEndDate",
                createdAt: 1,
              },
            },
          ],
          as: "visaReminders",
        },
      },
      // Never expose the password hash to the client.
      {
        $unset: "password",
      },
    ];

    const employees = await EmployeModel.aggregate(pipeline);
    // RangeError handling  for empty array
    if (!filterData) return { success: false, message: "No employees found" };

    // Annotate each employee with current account-lock status so admins can see
    // which accounts are locked out by repeated failed logins.
    try {
      const emails = employees.map((r) => r?.email).filter(Boolean);
      const lockMap = await getLockedEmails(emails);
      for (const r of employees) {
        const key = (r?.email || "").trim().toLowerCase();
        r.isLocked = Boolean(lockMap[key]);
        r.lockedUntil = lockMap[key] || null;
      }
    } catch (e) {
      console.log("lock-status annotation failed:", e?.message);
    }

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

export const handleEmploye = withAudit(
  "Employee.upsert",
  async (data, isChecked, id) => {
    if (!data) return { status: false, message: "Please Provide Informations" };
    // if (!images) return { status: true, message: "success" };
    const payRateValidation = /^([1-9][\d]{0,7})(\.\d{0,2})?$/; // 1.5 or 15.68 or .34 only
    const Payrate = payRateValidation.test(String(Number(data?.payRate)));
    if (Payrate === false)
      return { status: false, message: "Invalid Pay Rate" };
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
          data.email,
        );
        if (!isExists.status)
          return { success: isExists.status, message: isExists.message };
        const beforeEmp = await EmployeModel.findById(id).lean();
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
          { new: true },
        );
        if (!res) return { success: false, message: "Somthing Went Wrong..." };
        recordAudit({
          entityId: id,
          before: beforeEmp,
          after: res.toObject(),
          description:
            `Updated field employee ${res?.firstName || ""} ${res?.lastName || ""}`.trim(),
        });
        await logVisaExpiryChange({
          before: beforeEmp?.eVisaExp,
          after: res?.eVisaExp,
          employeeType: "Employe",
          entityId: id,
          name: `${res?.firstName || ""} ${res?.lastName || ""}`.trim(),
        });
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
          data.email,
        );

        const password = await GenerateHashPassword("Interior@1234");
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
        recordAudit({
          entityId: addEmploye._id,
          after: addEmploye.toObject(),
          description: `Created field employee ${addEmploye.firstName} ${addEmploye.lastName}`,
        });
        if (addEmploye) {
          const { firstName, lastName, email } = addEmploye; // get the employee id
          const type = "HR";
          const response = await getSMTPForFeature(type);
          if (response?.success) {
            const emailData = JSON.parse(response?.data);
            // register email we have to send the welcome mail with email and password with site link
            const html = `<p>Dear ${firstName} ${lastName},</p>
          <p>Welcome to our team! We are excited to have you on board.</p>
          <p>Your login details are as follows:</p>
          <p>Email: ${email}</p>
          <p>Password: ${password}</p>
          <p>Please log in to your account using the following link:</p>
          <p><a href="${process.env.NEXT_PUBLIC_WEB_URL}">Click here to login</a></p>
          <p>Thank you for joining us!</p>
          <p>Best regards,</p>
          <p>Hr Management</p>`;
            const subject = "Welcome to Our Team";
            const smtp = { ...emailData, toEmail: email, html, subject };
            await userRegisterEmail(smtp);
          } else {
            const data = {
              success: true,
              message: `Employee added successfully`,
            };
            return data;
          }
        }
      }
    } catch (error) {
      console.log(error);
      return { success: false, message: "Somthing Went Wrong..." }; // if the employee is not created
    }
  },
  { module: "Employee" },
);

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

export const employeeStatus = withAudit(
  "Employee.status",
  async (data) => {
    if (!data) return { success: false, message: "Not found" };
    try {
      const id = data?.id;
      const isActive = !data?.status;
      const statusDate = data.status ? new Date() : null;
      const before = await EmployeModel.findById(id).lean();
      await EmployeModel.updateOne(
        { _id: id },
        { $set: { isActive, statusDate } },
      );
      const after = await EmployeModel.findById(id).lean();
      recordAudit({
        entityId: id,
        before,
        after,
        description: `${isActive ? "Activated" : "Deactivated"} field employee ${id}`,
      });
      return {
        success: true,
        message: "The Status of the Assign Project has been Updated",
      };
    } catch (error) {
      console.log(error);
      return { success: false, message: `Error Occurred in server problem` };
    }
  },
  { module: "Employee" },
);

export const employeeDelete = withAudit(
  "Employee.delete",
  async (data) => {
    if (!data) return { success: false, message: "Not found" };
    try {
      const id = data?.id;
      const isActive = false;
      const isDelete = true;
      const statusDate = new Date();
      const before = await EmployeModel.findById(id).lean();
      await EmployeModel.updateOne(
        { _id: id },
        { $set: { isActive, delete: isDelete, statusDate } },
      );
      const after = await EmployeModel.findById(id).lean();
      recordAudit({
        entityId: id,
        before,
        after,
        description: `Soft-deleted field employee ${id}`,
      });
      return {
        success: true,
        message: "The  Status of the Assign Project has been Updated",
      };
    } catch (error) {
      console.log(error);
      return { success: false, message: `Error Occurred in server problem` };
    }
  },
  { module: "Employee" },
);

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
      updatedEmp.password,
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

/**
 * Super-admin password reset for a site employee. Records a full audit entry
 * (who reset it, for whom, the reason, and when) and clears any active
 * failed-login lockout for the account.
 */
export const resetSiteEmployeePassword = withAudit(
  "Password.reset",
  async ({ employeeId, newPassword, reason } = {}) => {
    const { props } = await getServerSideProps();
    const actor = props?.session?.user;

    if (actor?.role !== "superAdmin") {
      return {
        success: false,
        message: "Only a super admin can reset passwords",
      };
    }
    if (!employeeId) return { success: false, message: "Employee is required" };
    if (!newPassword || String(newPassword).length < 8) {
      return {
        success: false,
        message: "New password must be at least 8 characters",
      };
    }
    if (!reason || !String(reason).trim()) {
      return { success: false, message: "A reason for the reset is required" };
    }

    try {
      await connect();
      const employee = await EmployeModel.findById(employeeId).exec();
      if (!employee) return { success: false, message: "Employee not found" };

      const hashed = await GenerateHashPassword(String(newPassword));
      if (!hashed) {
        return { success: false, message: "Failed to secure the new password" };
      }
      employee.password = hashed;
      await employee.save();

      await clearLockByEmail(employee.email);

      const targetName =
        `${employee.firstName || ""} ${employee.lastName || ""}`.trim() ||
        "employee";
      recordAudit({
        entityId: employeeId,
        module: "Account",
        description: `Password reset by ${
          actor?.name || actor?.email
        } for ${targetName} <${employee.email}>. Reason: ${String(
          reason,
        ).trim()}`,
        after: {
          target: {
            id: String(employeeId),
            name: targetName,
            email: employee.email,
          },
          reason: String(reason).trim(),
          lockCleared: true,
        },
      });

      return { success: true, message: "Password reset successfully" };
    } catch (error) {
      console.log("Error in resetSiteEmployeePassword:", error);
      return { success: false, message: "Error resetting password" };
    }
  },
  { module: "Account" },
);

export async function getEmployeeWiseData(params) {
  try {
    const employeeId = await extractData(params);
    if (!employeeId) {
      return { success: false, message: "Employee ID not found" };
    }
    await connect();
    const pipeline = [
      {
        $match: {
          _id: createObjectId(employeeId),
          delete: false,
        },
      },
      {
        $unset: ["password"],
      },
    ];
    // we have to set the signal as well in this case
    const employeeDeatils = await EmployeModel.aggregate(pipeline);
    return { success: true, data: JSON.stringify(employeeDeatils[0]) };
  } catch (error) {
    console.error("Error fetching employee data:", error);
    return { success: false, message: "Error fetching employee data" };
  }
}

export async function getSiteEmployeAttendanceData(params) {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const role = props?.session?.user?.role;
    const employeId =
      role === "superAdmin" ? decrypt(params?.employeId) : employeeId;
    if (!employeId) {
      return { success: false, message: "Employee ID not found" };
    }
    await connect();
    const today = normalizeDateToUTC(new Date());
    const start = params?.fromDate
      ? normalizeDateToUTC(new Date(params?.fromDate))
      : today;
    const end = params?.toDate
      ? normalizeDateToUTC(new Date(params?.toDate))
      : today;

    if (start > end) {
      return {
        success: false,
        message: "Start date cannot be later than end date",
      };
    }
    const page = parseInt(params?.page || 1);
    const pageSize = parseInt(params?.pageSize || 10);
    const skip = (page - 1) * pageSize;

    const match = {
      employeeId: createObjectId(employeId),
      isDeleted: false,
      date: {
        $gte: start,
        $lte: end,
      },
    };

    const pipeline = [
      {
        $match: match,
      },
      // {
      //   $sort: { date: -1 }, // Sort by date in descending order
      // },
      {
        $lookup: {
          from: "employes",
          localField: "employeeId",
          foreignField: "_id",
          as: "employee",
        },
      },
      { $unwind: "$employee" },
      {
        $lookup: {
          from: "projectsites",
          localField: "siteId",
          foreignField: "_id",
          as: "site",
        },
      },
      { $unwind: "$site" },
      {
        $facet: {
          metadata: [
            {
              $addFields: {
                // Convert to minutes, but only if the time exists
                clockInMinutes: {
                  $cond: [
                    { $gt: ["$clockIn", null] },
                    {
                      $let: {
                        vars: { parts: { $split: ["$clockIn", ":"] } },
                        in: {
                          $add: [
                            {
                              $multiply: [
                                { $toInt: { $arrayElemAt: ["$$parts", 0] } },
                                60,
                              ],
                            },
                            { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                          ],
                        },
                      },
                    },
                    null,
                  ],
                },
                clockOutMinutes: {
                  $cond: [
                    { $gt: ["$clockOut", null] },
                    {
                      $let: {
                        vars: { parts: { $split: ["$clockOut", ":"] } },
                        in: {
                          $add: [
                            {
                              $multiply: [
                                { $toInt: { $arrayElemAt: ["$$parts", 0] } },
                                60,
                              ],
                            },
                            { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                          ],
                        },
                      },
                    },
                    null,
                  ],
                },
                breakInMinutes: {
                  $cond: [
                    { $gt: ["$breakIn", null] },
                    {
                      $let: {
                        vars: { parts: { $split: ["$breakIn", ":"] } },
                        in: {
                          $add: [
                            {
                              $multiply: [
                                { $toInt: { $arrayElemAt: ["$$parts", 0] } },
                                60,
                              ],
                            },
                            { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                          ],
                        },
                      },
                    },
                    null,
                  ],
                },
                breakOutMinutes: {
                  $cond: [
                    { $gt: ["$breakOut", null] },
                    {
                      $let: {
                        vars: { parts: { $split: ["$breakOut", ":"] } },
                        in: {
                          $add: [
                            {
                              $multiply: [
                                { $toInt: { $arrayElemAt: ["$$parts", 0] } },
                                60,
                              ],
                            },
                            { $toInt: { $arrayElemAt: ["$$parts", 1] } },
                          ],
                        },
                      },
                    },
                    null,
                  ],
                },
              },
            },
            {
              $addFields: {
                totalWorkMinutes: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$clockOutMinutes", null] },
                        { $ne: ["$clockInMinutes", null] },
                        { $gte: ["$clockOutMinutes", "$clockInMinutes"] },
                      ],
                    },
                    { $subtract: ["$clockOutMinutes", "$clockInMinutes"] },
                    0,
                  ],
                },
                totalBreakMinutes: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$breakOutMinutes", null] },
                        { $ne: ["$breakInMinutes", null] },
                        { $gte: ["$breakOutMinutes", "$breakInMinutes"] },
                      ],
                    },
                    { $subtract: ["$breakOutMinutes", "$breakInMinutes"] },
                    0,
                  ],
                },
              },
            },
            {
              $addFields: {
                totalWorkMinutes: {
                  $subtract: ["$clockOutMinutes", "$clockInMinutes"],
                },
                totalBreakMinutes: {
                  $subtract: ["$breakOutMinutes", "$breakInMinutes"],
                },
              },
            },
            {
              $addFields: {
                netWorkMinutes: {
                  $subtract: ["$totalWorkMinutes", "$totalBreakMinutes"],
                },
              },
            },
            {
              $addFields: {
                totalPay: {
                  $switch: {
                    branches: [
                      {
                        case: { $eq: ["$employee.payType", "Hourly"] },
                        then: {
                          $multiply: [
                            "$employee.payRate",
                            { $divide: ["$netWorkMinutes", 60] }, // Convert minutes to hours
                          ],
                        },
                      },
                      {
                        case: { $eq: ["$employee.payType", "Daily"] },
                        then: {
                          $multiply: [
                            "$employee.payRate",
                            { $divide: ["$netWorkMinutes", 480] }, // Assuming 8 hours a day
                          ],
                        },
                      },
                      {
                        case: { $eq: ["$employee.payType", "Weekly"] },
                        then: {
                          $multiply: [
                            "$employee.payRate",
                            { $divide: ["$netWorkMinutes", 2880] }, // Assuming 48 hours a week
                          ],
                        },
                      },
                      {
                        case: { $eq: ["$employee.payType", "Monthly"] },
                        then: {
                          $multiply: [
                            "$employee.payRate",
                            { $divide: ["$netWorkMinutes", 129600] }, // Assuming 2160 hours a month
                          ],
                        },
                      },
                      {
                        case: { $eq: ["$employee.payType", "Yearly"] },
                        then: {
                          $multiply: [
                            "$employee.payRate",
                            { $divide: ["$netWorkMinutes", 1555200] }, // Assuming 25920 hours a year
                          ],
                        },
                      },
                    ],
                    default: {
                      $multiply: [
                        "$employee.payRate",
                        { $divide: ["$netWorkMinutes", 60] }, // Default to hourly calculation
                      ],
                    },
                  },
                },
              },
            },
            {
              $addFields: {
                cisDeductedAmount: {
                  $multiply: [
                    "$totalPay",
                    { $divide: ["$employee.cisDeduction", 100] },
                  ],
                },
              },
            },
            {
              $addFields: {
                finalPay: {
                  $subtract: ["$totalPay", "$cisDeductedAmount"],
                },
              },
            },
            {
              $group: {
                _id: "$employeeId",
                employeeName: { $first: "$employee.firstName" },
                payRate: { $first: "$employee.payRate" },
                cisDeduct: { $first: "$employee.cisDeduction" },
                totalWorkMinutes: { $sum: "$totalWorkMinutes" },
                totalBreakMinutes: { $sum: "$totalBreakMinutes" },
                totalNetMinutes: { $sum: "$netWorkMinutes" },
                totalPay: { $sum: "$totalPay" },
                totalCIS: { $sum: "$cisDeductedAmount" },
                finalTotalPay: { $sum: "$finalPay" },
              },
            },
            {
              $addFields: {
                totalHour: {
                  $concat: [
                    {
                      $cond: [
                        {
                          $lt: [
                            { $floor: { $divide: ["$totalNetMinutes", 60] } },
                            10,
                          ],
                        },
                        {
                          $concat: [
                            "0",
                            {
                              $toString: {
                                $floor: { $divide: ["$totalNetMinutes", 60] },
                              },
                            },
                          ],
                        },
                        {
                          $toString: {
                            $floor: { $divide: ["$totalNetMinutes", 60] },
                          },
                        },
                      ],
                    },
                    ":",
                    {
                      $cond: [
                        { $lt: [{ $mod: ["$totalNetMinutes", 60] }, 10] },
                        {
                          $concat: [
                            "0",
                            { $toString: { $mod: ["$totalNetMinutes", 60] } },
                          ],
                        },
                        { $toString: { $mod: ["$totalNetMinutes", 60] } },
                      ],
                    },
                  ],
                },
              },
            },
          ],
          data: [
            { $sort: { date: -1 } }, // Sort by date descending
            { $skip: skip }, // Skip for pagination
            { $limit: pageSize }, // Limit results for pagination
            {
              $project: {
                _id: 1,
                siteName: "$site.siteName",
                clockIn: 1,
                clockOut: 1,
                breakIn: 1,
                breakOut: 1,
                date: 1,
              },
            },
          ],
          totalCount: [
            {
              $count: "count",
            },
          ],
        },
      },
    ];

    const attendanceData = await SiteClockModel.aggregate(pipeline);
    if (!attendanceData || attendanceData.length === 0) {
      return { success: false, message: "No Attendance Data Found" };
    }
    const result = attendanceData[0];
    const datas = {
      metadata: result.metadata[0],
      data: result.data || [],
    };
    return {
      success: true,
      data: JSON.stringify(datas),
      totalCount: result.totalCount[0]?.count || 0,
    };
  } catch (error) {
    console.error("Error fetching employee attendance data:", error);
    return {
      success: false,
      message: "Error fetching employee attendance data",
    };
  }
}
