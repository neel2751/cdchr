"use server";
import { connect } from "@/db/db";
import EmployeModel from "@/models/employeModel";
import { GenerateHashPassword } from "../officeServer/officeServer";
import { getServerSideProps } from "../session/session";
import { hashPassword, isMatchedPassword } from "@/utils/bcrypt";
import { extractData } from "../officeServer/officeEmployeeDetails";
import { createObjectId } from "@/lib/mongodb";
import {
  sendPasswordInvite,
  unknowablePassword,
} from "../authServer/passwordInvite";
import { decrypt } from "@/lib/algo";
import ClockRecordModel from "@/models/clockInModel";
import { normalizeDateToUTC } from "@/lib/formatDate";
import { withAudit, recordAudit } from "@/lib/audit";
import { logVisaExpiryChange } from "../visaServer/visaAudit";
import { getLockedEmails, clearLockByEmail } from "@/lib/rateLimit";
import {
  duplicateAccountWarning,
  otherAccountsForEmail,
} from "../authServer/duplicateAccounts";
import { getSensitiveAccess, stripSensitiveDetails } from "@/lib/sensitiveAccess";
import { permissionRefusal } from "@/lib/actionAccess";

/** The site staff list, read only by /admin/employee and its leavers screen. */
const STAFF_LIST = ["/admin/employee", "/admin/previousEmployee"];

// The form only asks for a country when the employee is not British.
/**
 * "HH:mm" as minutes from midnight, inside an aggregation.
 *
 * Null stays null so the caller can tell "no clock out yet" from "clocked out
 * at midnight" — 00:00 is a real time and zero is a real number of minutes.
 */
const TIME_TO_MINUTES = (field) => ({
  $cond: [
    {
      $and: [
        { $ne: [field, null] },
        { $eq: [{ $type: field }, "string"] },
        { $eq: [{ $strLenCP: { $ifNull: [field, ""] } }, 5] },
      ],
    },
    {
      $let: {
        vars: { parts: { $split: [field, ":"] } },
        in: {
          $add: [
            { $multiply: [{ $toInt: { $arrayElemAt: ["$$parts", 0] } }, 60] },
            { $toInt: { $arrayElemAt: ["$$parts", 1] } },
          ],
        },
      },
    },
    null,
  ],
});

/**
 * Minutes between two of those, 0 if either is missing.
 *
 * An end before the start wraps past midnight rather than going negative —
 * the same reading lib/clockTime.js `diffMinutes` takes, and the one a night
 * shift needs. The old pipeline subtracted directly, so 22:00 to 06:00 came
 * out as minus sixteen hours and was paid as such.
 */
const SPAN_MINUTES = (start, end) => ({
  $cond: [
    { $and: [{ $ne: [start, null] }, { $ne: [end, null] }] },
    {
      $cond: [
        { $gte: [end, start] },
        { $subtract: [end, start] },
        { $add: [{ $subtract: [1440, start] }, end] },
      ],
    },
    0,
  ],
});

const UNITED_KINGDOM = "United Kingdom";

// The employee edit form is seeded from the list row, so it round-trips the
// right-to-work history. That log is append-only — only
// recordRightToWorkCheck() may write it — so drop those keys before saving.
const stripRightToWorkFields = ({
  rightToWorkChecks,
  lastRightToWorkCheckDate,
  ...rest
}) => rest;

export const getAllEmployees = async (filterData) => {
  const denied = await permissionRefusal(STAFF_LIST);
  if (denied) return denied;

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

  // Account status filter. The default view shows only active employees;
  // "inactive" shows deactivated accounts and "all" reveals everyone.
  // Deleted records are always excluded (query.delete = false above).
  const accountStatus = filterData?.filter?.status;
  if (accountStatus === "inactive") query.isActive = false;
  else if (accountStatus !== "all") query.isActive = true;

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

    // The list feeds the edit form, so protected fields ride along — but only
    // for users allowed to see them.
    const { allowed: canSeeSensitive } = await getSensitiveAccess();
    if (!canSeeSensitive) stripSensitiveDetails(employees);

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
        postCode,
        country,
        accountName,
        bankName,
        accountNumber,
        sortCode,
        payRate,
      } = data;
      const eAddress = {
        address: address || "",
        streetAddress: streetAddress || "",
        city: city || "",
        postCode: postCode || "",
        // British employees never get asked for a country, so store the default.
        country:
          data?.immigrationType === "British"
            ? UNITED_KINGDOM
            : country || UNITED_KINGDOM,
      };
      // Only overwrite bank details when the form actually carried them — a
      // user without the bank permission edits the employee without those
      // fields, and must not wipe them.
      const hasBankFields =
        accountName || bankName || accountNumber || sortCode;
      const bankDetail = hasBankFields
        ? {
            accountName: accountName || "",
            bankName: bankName || "",
            accountNumber: accountNumber || "",
            sortCode: sortCode || "",
          }
        : null;
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
              ...stripRightToWorkFields(data),
              eAddress: eAddress,
              ...(bankDetail ? { bankDetail } : {}),
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

        // A password nobody knows, replacing the hardcoded "Interior@1234"
        // every site employee was created with. They choose their own through
        // the link emailed below.
        const password = await GenerateHashPassword(unknowablePassword());
        if (!isExists.status) return isExists;
        const addEmploye = await EmployeModel.create({
          ...stripRightToWorkFields(data),
          eAddress: eAddress,
          ...(bankDetail ? { bankDetail } : {}),
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
        const { firstName, lastName, email: newEmail } = addEmploye;
        // Previous / historical employees are entered with a visa expiry that
        // is already in the past — we are only recording their data, so we
        // must NOT email them login credentials.
        const visaExp = data?.eVisaExp ? new Date(data.eVisaExp) : null;
        const isPreviousEmployee =
          visaExp && !Number.isNaN(visaExp.getTime()) && visaExp < new Date();

        // The old template emailed `password`, which at this point holds the
        // bcrypt HASH of a password the employee was never told — so they got
        // a hash labelled as their password and no way to sign in. They now
        // get a link and choose their own.
        let invite = { sent: false, message: "" };
        if (!isPreviousEmployee) {
          // `addEmploye`, not `result` — which is not a variable in this
          // function. It threw a ReferenceError the moment a site employee was
          // added, and the throw landed in the catch below, so every single
          // add reported "Somthing Went Wrong..." about a record that had in
          // fact just been created. HR added the person, saw a failure, and
          // added them again.
          const tenantId = addEmploye.tenantId
            ? String(addEmploye.tenantId)
            : null;
          invite = await sendPasswordInvite({
            userId: addEmploye._id,
            userType: "site",
            email: newEmail,
            name: `${firstName} ${lastName}`.trim(),
            tenantId,
          });
        }

        // The employee exists either way, so this says so either way. The old
        // code returned success ONLY when the email failed and returned
        // nothing at all when it succeeded — inverted, and `undefined` reached
        // the screen as neither a success nor an error.
        return {
          success: true,
          message: invite.message
            ? `Employee added successfully ${invite.message}`
            : "Employee added successfully",
        };
      }
    } catch (error) {
      console.log(error);
      return { success: false, message: "Somthing Went Wrong..." }; // if the employee is not created
    }
  },
  { module: "Employee" },
);

/**
 * Is this email already a site employee of THIS company?
 *
 * Scoped by the tenant plugin, so "this company" is automatic — the same
 * person can be on two companies' books, and only a whole new workspace is
 * judged globally.
 *
 * THE PHONE IS NO LONGER CHECKED. It used to refuse any number already on
 * another record, which blocked the way site work is actually organised: one
 * cabin landline, or a supervisor whose mobile is the contact number for the
 * labourers in his van. Nothing here signs in by phone or looks anybody up by
 * it, and there is no unique index on it — it is contact information, and two
 * people sharing one is a fact about them, not a mistake to reject. The same
 * reasoning as the office side; see the note in officeServer/officeServer.js.
 *
 * Case-insensitive, which it was not: the create path lowercases nothing, so
 * "Sam@Example.com" slipped past a record holding "sam@example.com" and became
 * a second record for one person in one company.
 *
 * The holder's name comes back rather than a bare true, because "already in
 * use" leaves HR searching a staff list for a record that is usually right
 * there on screen.
 *
 * `phone` is still a parameter: the callers pass it, and the signature is left
 * alone so this stays a two-line diff at both of them.
 */
const EmployePhoneAndEmailExists = async (id, phone, email) => {
  try {
    const clean = String(email || "").trim();
    // No email to collide with. The phone used to be checked in this case and
    // is not any more, so there is nothing left to refuse.
    if (!clean) return { status: true };

    const rx = new RegExp(
      `^${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i",
    );
    const query = { email: rx };
    if (id) query._id = { $ne: id };

    const holder = await EmployeModel.findOne(query)
      .select("firstName lastName")
      .lean();
    if (!holder) return { status: true };

    const who =
      [holder.firstName, holder.lastName].filter(Boolean).join(" ") ||
      "Another employee";
    return {
      status: false,
      message: `${who} already uses that email address at this company`,
    };
  } catch (err) {
    console.log(err);
    // Fail closed: an unreadable answer must not be read as "available".
    return {
      status: false,
      message: "Could not check that email address. Please try again.",
    };
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
  async ({
    employeeId,
    newPassword,
    reason,
    // See resetOfficeEmployeePassword — same two options, same defaults.
    signOutEverywhere = true,
    requirePasswordChange = true,
  } = {}) => {
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
      // Ends every signed-in device: sessions are JWTs, so auth.js refuses any
      // token minted before this instant rather than deleting anything.
      if (signOutEverywhere) {
        employee.sessionsValidFrom = new Date();
      }
      employee.mustChangePassword = !!requirePasswordChange;
      await employee.save();

      // Read the flags back — see resetOfficeEmployeePassword for why. A stale
      // compiled model drops them without error, which would tell the admin the
      // account was secured when it was not.
      const saved = await EmployeModel.findById(employeeId)
        .select("mustChangePassword sessionsValidFrom")
        .lean();

      if (
        (!!requirePasswordChange && saved?.mustChangePassword !== true) ||
        (!!signOutEverywhere && !saved?.sessionsValidFrom)
      ) {
        return {
          success: false,
          message:
            "The password was changed, but 'sign out everywhere' and 'require a " +
            "password change' could not be saved — the server is running an " +
            "older version of the employee record. Restart the app and set them " +
            "again.",
        };
      }

      await clearLockByEmail(employee.email);

      // The same trap as the office path: one email can own a record in
      // several companies, each with its own password, and sign-in checks one
      // of them. See otherAccountsForEmail for why this warns rather than
      // writing to the other record.
      const others = await otherAccountsForEmail(employee.email, employeeId);

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
          duplicateAccounts: others.map((o) => ({
            id: o._id,
            company: o.companyName,
            name: o.name,
          })),
        },
      });

      return {
        success: true,
        message: "Password reset successfully" + duplicateAccountWarning(others),
      };
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
      // Bank details and the NI number are released only through
      // revealSensitiveDetails(), which re-checks permission and password.
      {
        $unset: ["password", "bankDetail", "employeNI"],
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
                // "HH:mm" -> minutes from midnight, null when absent.
                clockInMinutes: TIME_TO_MINUTES("$clockIn"),
                clockOutMinutes: TIME_TO_MINUTES("$clockOut"),
                // Every break on the record, summed. The old pipeline read a
                // single breakIn/breakOut pair off the document, because that
                // is the shape the legacy `siteclocks` collection had. A
                // clockrecords row carries a list, and reading only the first
                // of them would have quietly paid people for their second
                // break.
                totalBreakMinutes: {
                  $reduce: {
                    input: { $ifNull: ["$breaks", []] },
                    initialValue: 0,
                    in: {
                      $add: [
                        "$$value",
                        {
                          $let: {
                            vars: {
                              s: TIME_TO_MINUTES("$$this.breakIn"),
                              e: TIME_TO_MINUTES("$$this.breakOut"),
                            },
                            in: SPAN_MINUTES("$$s", "$$e"),
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
            {
              // One pass, and it keeps its guards. There used to be a second
              // $addFields immediately after this one that recomputed both
              // figures with a bare $subtract, overwriting the guarded values
              // — so an open shift (clockOut still null) produced null rather
              // than 0, and that null went on into totalPay and the CIS
              // deduction below.
              $addFields: {
                totalWorkMinutes: SPAN_MINUTES(
                  "$clockInMinutes",
                  "$clockOutMinutes",
                ),
              },
            },
            {
              $addFields: {
                // Never negative: a break longer than the recorded shift is
                // bad data, and paying it as negative time would be worse.
                netWorkMinutes: {
                  $max: [
                    0,
                    { $subtract: ["$totalWorkMinutes", "$totalBreakMinutes"] },
                  ],
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
                // The list, plus the totals worked out above — the client used
                // to recompute them from a single break pair, which cannot be
                // right for a day with two.
                breaks: { $ifNull: ["$breaks", []] },
                workMinutes: "$totalWorkMinutes",
                breakMinutes: "$totalBreakMinutes",
                netMinutes: "$netWorkMinutes",
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

    const attendanceData = await ClockRecordModel.aggregate(pipeline);
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
