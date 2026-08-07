"use server";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import bcrypt from "bcryptjs";
import { storeLeave } from "../leaveServer/leaveServer";
import { createObjectId } from "@/lib/mongodb";
import { getCompanyById } from "../companyServer/companyServer";
import { getSMTPForFeature, userRegisterEmail } from "../email/emailSMTP";
import { syncMissingLeaveTypesNew } from "../leaveServer/countLeaveServer";
import { withAudit, recordAudit } from "@/lib/audit";
import { logVisaExpiryChange } from "../visaServer/visaAudit";
import { getServerSideProps } from "../session/session";
import { getLockedEmails, clearLockByEmail } from "@/lib/rateLimit";
import { getSensitiveAccess, stripSensitiveDetails } from "@/lib/sensitiveAccess";

const UNITED_KINGDOM = "United Kingdom";

/**
 * The office employee form is flat, but bank details are stored as a
 * sub-document. Fold the flat fields into it, and fill in the country the form
 * hides for British staff.
 *
 * Bank details are left untouched when the payload has none of those fields —
 * a user without the bank permission never sees them, so an edit from them
 * must not wipe what is stored.
 */
const buildOfficeEmployeePayload = (data) => {
  const { accountName, bankName, accountNumber, sortCode, country, ...rest } =
    data;
  const hasBankFields = accountName || bankName || accountNumber || sortCode;
  return {
    ...rest,
    country:
      data?.immigrationType === "British"
        ? UNITED_KINGDOM
        : country || UNITED_KINGDOM,
    ...(hasBankFields
      ? { bankDetail: { accountName, bankName, accountNumber, sortCode } }
      : {}),
  };
};

export const handleOfficeEmployee = withAudit(
  "OfficeEmployee.upsert",
  async (data, id) => {
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
      // if the email is changing we have to convert it to lowercase
      data.email = data.email.toLowerCase();
      const beforeEmp = updatedEmp.toObject();
      Object.assign(updatedEmp, buildOfficeEmployeePayload(data));
      const updatedData = await updatedEmp.save();
      if (!updatedData)
        return { success: false, message: "Error Updating Employee" };
      recordAudit({
        entityId: id,
        before: beforeEmp,
        after: updatedData.toObject(),
        description: `Updated office employee ${updatedData.name || id}`,
      });
      await logVisaExpiryChange({
        before: beforeEmp?.visaEndDate,
        after: updatedData?.visaEndDate,
        employeeType: "OfficeEmploye",
        entityId: id,
        name: updatedData?.name,
      });
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
          ...buildOfficeEmployeePayload(data),
          password: hashPass,
          email: data.email.toLowerCase(),
        });

        const result = await newUser.save();
        if (!result)
          return {
            success: false,
            message: "Failed to create office Employee",
          };
        const {
          _id: employeeId,
          name,
          email,
          company,
          joinDate,
          dayPerWeek,
        } = result; // get the employee id
        const leaveResult = await syncMissingLeaveTypesNew(
          joinDate,
          dayPerWeek,
          employeeId,
        );
        if (!leaveResult?.success)
          return { success: false, message: leaveResult.message };
        // Previous / historical employees are entered with a visa end date that
        // is already in the past — we are only recording their data, so we must
        // NOT email them login credentials.
        const visaEnd = data?.visaEndDate ? new Date(data.visaEndDate) : null;
        const isPreviousEmployee =
          visaEnd && !Number.isNaN(visaEnd.getTime()) && visaEnd < new Date();
        if (!isPreviousEmployee) {
          const companyData = await getCompanyById(company);
          const cData = JSON.parse(companyData?.data);
          const type = "HR";
          const response = await getSMTPForFeature(type);
          if (response?.success) {
            const emailData = JSON.parse(response?.data);
            // register email we have to send the welcome mail with email and password with site link
            const html = `<p>Dear ${name},</p>
          <p>Welcome to our team! We are excited to have you on board.</p>
          <p>Your login details are as follows:</p>
          <p>Email: ${email}</p>
          <p>Password: Cdc@1234</p>
          <p>Please log in to your account using the following link:</p>
          <p><a href="https://hr.cdc.construction">Click here to login</a></p>
          <p>Thank you for joining us!</p>
          <p>Best regards,</p>
          <p>Hr Management</p>`;
            // we have to add the company name on this subject
            const subject = `Weclome to our ${cData.name} family`;
            const smtp = { ...emailData, toEmail: email, html, subject };
            await userRegisterEmail(smtp);
          }
        }
        recordAudit({
          entityId: employeeId,
          after: result.toObject(),
          description: `Created office employee ${name}`,
        });
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
  },
  { module: "OfficeEmployee" },
);

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

    // Account status filter. The default view shows only active employees;
    // "inactive" shows deactivated accounts and "all" reveals everyone.
    // Deleted records are always excluded (query.delete = false above).
    const accountStatus = filterData?.filter?.status;
    if (accountStatus === "inactive") query.isActive = false;
    else if (accountStatus !== "all") query.isActive = true;

    // Visa status filter. Requiring a visaEndDate naturally excludes
    // British / no-visa staff.
    const visaStatus = filterData?.filter?.visaStatus;
    if (visaStatus && visaStatus !== "all") {
      const now = new Date();
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 90);
      if (visaStatus === "expired") {
        query.visaEndDate = { $ne: null, $lt: now };
      } else if (visaStatus === "expiring") {
        query.visaEndDate = { $ne: null, $gte: now, $lte: horizon };
      } else if (visaStatus === "valid") {
        query.visaEndDate = { $ne: null, $gt: horizon };
      }
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
          ],
        },
      },
    ];
    const officeEmployee = await OfficeEmployeeModel.aggregate(pipeline);
    const totalCount = officeEmployee[0].totalCount[0].count;
    const result = officeEmployee[0].result;

    // Annotate each employee with current account-lock status so admins can see
    // which accounts are locked out by repeated failed logins.
    try {
      const emails = result.map((r) => r?.email).filter(Boolean);
      const lockMap = await getLockedEmails(emails);
      for (const r of result) {
        const key = (r?.email || "").trim().toLowerCase();
        r.isLocked = Boolean(lockMap[key]);
        r.lockedUntil = lockMap[key] || null;
      }
    } catch (e) {
      console.log("lock-status annotation failed:", e?.message);
    }

    // The list feeds the edit form, so protected fields ride along — but only
    // for users allowed to see them.
    const { allowed: canSeeSensitive } = await getSensitiveAccess();
    if (!canSeeSensitive) stripSensitiveDetails(result);

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

/**
 * Super-admin password reset for an office employee. Records a full audit entry
 * capturing who reset it, for whom, the reason, and when (the audit timestamp).
 * Also clears any active failed-login lockout for the account.
 */
export const resetOfficeEmployeePassword = withAudit(
  "Password.reset",
  async ({ employeeId, newPassword, reason } = {}) => {
    const { props } = await getServerSideProps();
    const actor = props?.session?.user;

    // Only a super admin may reset another user's password.
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
      return {
        success: false,
        message: "A reason for the reset is required",
      };
    }

    try {
      await connect();
      const employee = await OfficeEmployeeModel.findById(employeeId).exec();
      if (!employee) {
        return { success: false, message: "Employee not found" };
      }

      const hashed = await GenerateHashPassword(String(newPassword));
      if (!hashed) {
        return { success: false, message: "Failed to secure the new password" };
      }
      employee.password = hashed;
      await employee.save();

      // Lift any failed-login lockout so the user can sign in with the new password.
      await clearLockByEmail(employee.email);

      const targetName = employee.name || employee.firstName || "employee";
      // who (actor) is captured automatically by withAudit; here we record
      // for-whom (entityId + target details) and why (reason). When = createdAt.
      recordAudit({
        entityId: employeeId,
        module: "Account",
        description: `Password reset by ${
          actor?.name || actor?.email
        } for ${targetName} <${employee.email}>. Reason: ${String(
          reason
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
      console.log("Error in resetOfficeEmployeePassword:", error);
      return { success: false, message: "Error resetting password" };
    }
  },
  { module: "Account" }
);

/**
 * Emergency lockdown of a (potentially compromised) account. Deactivates the
 * account so future logins are blocked immediately, and — combined with the
 * middleware active-account check — terminates any live sessions on the next
 * request. Fully audited with a mandatory reason.
 */
export const emergencyLockdownAccount = withAudit(
  "Account.lockdown",
  async ({ employeeId, reason } = {}) => {
    const { props } = await getServerSideProps();
    const actor = props?.session?.user;

    if (actor?.role !== "superAdmin") {
      return {
        success: false,
        message: "Only a super admin can lock down accounts",
      };
    }
    if (!employeeId) return { success: false, message: "Employee is required" };
    if (!reason || !String(reason).trim()) {
      return { success: false, message: "A reason for the lockdown is required" };
    }

    try {
      await connect();
      const employee = await OfficeEmployeeModel.findById(employeeId).exec();
      if (!employee) return { success: false, message: "Employee not found" };

      // Never let a super admin lock themselves out.
      if (String(employee._id) === String(actor?._id)) {
        return {
          success: false,
          message: "You cannot lock down your own account",
        };
      }

      employee.isActive = false;
      await employee.save();

      const targetName = employee.name || employee.firstName || "employee";
      recordAudit({
        entityId: employeeId,
        module: "Account",
        description: `Emergency lockdown by ${
          actor?.name || actor?.email
        } for ${targetName} <${employee.email}>. Reason: ${String(
          reason
        ).trim()}`,
        before: { isActive: true },
        after: {
          target: {
            id: String(employeeId),
            name: targetName,
            email: employee.email,
          },
          isActive: false,
          reason: String(reason).trim(),
        },
      });

      return {
        success: true,
        message: "Account locked down. Active sessions will be terminated.",
      };
    } catch (error) {
      console.log("Error in emergencyLockdownAccount:", error);
      return { success: false, message: "Error locking down account" };
    }
  },
  { module: "Account" },
);

export const OfficeEmployeeStatus = withAudit(
  "OfficeEmployee.status",
  async (data) => {
    if (!data) return { success: false, message: "Not found" };

    try {
      const id = data?.id;
      const isActive = !data?.status;
      const statusDate = data.status ? new Date() : null;

      const before = await OfficeEmployeeModel.findById(id).lean();
      await OfficeEmployeeModel.updateOne(
        { _id: id },
        { $set: { [data?.name]: isActive, statusDate } },
      );
      const after = await OfficeEmployeeModel.findById(id).lean();

      recordAudit({
        entityId: id,
        before,
        after,
        description: `Set ${data?.name} for office employee ${id}`,
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
  { module: "OfficeEmployee" },
);

export const officeEmployeeDelete = withAudit(
  "OfficeEmployee.delete",
  async (data) => {
    if (!data) return { success: false, message: "Not found" };
    try {
      const id = data?.id;
      const isActive = false;
      const isDelete = true;
      const statusDate = new Date();
      const before = await OfficeEmployeeModel.findById(id).lean();
      await OfficeEmployeeModel.updateOne(
        { _id: id },
        { $set: { isActive, delete: isDelete, statusDate } },
      );
      const after = await OfficeEmployeeModel.findById(id).lean();
      recordAudit({
        entityId: id,
        before,
        after,
        description: `Soft-deleted office employee ${id}`,
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
  { module: "OfficeEmployee" },
);

export const getSuperAdmins = async () => {
  try {
    const allAdmin = await OfficeEmployeeModel.find(
      { isSuperAdmin: true },
      { name: 1, email: 1 },
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

/**
 * Headline counts for the office employee page: active, inactive, and the two
 * visa states that need chasing.
 *
 * Narrowed by company when one is selected, so the cards describe whatever the
 * list below is showing. The visa counts only consider active, non-British
 * staff — an expired visa on a leaver is not something anyone can act on.
 *
 * @param {{ company?: string }} [filter]
 */
export const countCompanyWiseEmployees = async (filter) => {
  try {
    await connect();

    const match = { delete: false };
    const companyId = filter?.company;
    if (companyId) match.company = createObjectId(companyId);

    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 90);

    const visaMatch = {
      isActive: true,
      immigrationType: { $ne: "British" },
      visaEndDate: { $ne: null },
    };

    const [result] = await OfficeEmployeeModel.aggregate([
      { $match: match },
      {
        $facet: {
          total: [{ $count: "count" }],
          active: [{ $match: { isActive: true } }, { $count: "count" }],
          inactive: [{ $match: { isActive: false } }, { $count: "count" }],
          visaExpiring: [
            { $match: { ...visaMatch, visaEndDate: { $gte: now, $lte: horizon } } },
            { $count: "count" },
          ],
          visaExpired: [
            { $match: { ...visaMatch, visaEndDate: { $lt: now } } },
            { $count: "count" },
          ],
        },
      },
    ]);

    const countOf = (key) => result?.[key]?.[0]?.count || 0;

    return {
      success: true,
      data: JSON.stringify({
        total: countOf("total"),
        active: countOf("active"),
        inactive: countOf("inactive"),
        visaExpiring: countOf("visaExpiring"),
        visaExpired: countOf("visaExpired"),
      }),
    };
  } catch (error) {
    console.error("Error counting office employees:", error);
    return { success: false, message: "Error counting office employees" };
  }
};
