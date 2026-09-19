"use server";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import bcrypt from "bcryptjs";
import { createObjectId } from "@/lib/mongodb";
import { getCompanyById } from "../companyServer/companyServer";
import CompanyModel from "@/models/companyModel";
import { checkSeats } from "@/lib/tenantPlan";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";

/**
 * Whether this company has room for one more employee.
 *
 * Fails open: a company must never be blocked from hiring because the limit
 * could not be read.
 */
async function checkTenantSeats(tenantId) {
  if (!tenantId) return { allowed: true };
  try {
    const tenant = await escapeTenant("seats: company limit", () =>
      CompanyModel.findById(tenantId).select("limits").lean()
    );
    const limit = tenant?.limits?.maxEmployees ?? null;
    if (!limit) return { allowed: true };

    const used = await runWithTenant(String(tenantId), () =>
      OfficeEmployeeModel.countDocuments({ delete: { $ne: true } })
    );
    return checkSeats({ limit, used, adding: 1 });
  } catch (error) {
    console.log("Seat check failed:", error?.message);
    return { allowed: true };
  }
}
import { resolveTenantAppUrl, sendTenantMail } from "../email/tenantMail";
import { emailButton } from "@/lib/emailTemplate";
import { syncMissingLeaveTypesNew } from "../leaveServer/countLeaveServer";
import { withAudit, recordAudit } from "@/lib/audit";
import { logVisaExpiryChange } from "../visaServer/visaAudit";
import { getServerSideProps } from "../session/session";
import { getLockedEmails, clearLockByEmail } from "@/lib/rateLimit";
import { getSensitiveAccess, stripSensitiveDetails } from "@/lib/sensitiveAccess";
import {
  getEmployeeManageAccess,
  pickSelfEditableFields,
} from "@/lib/employeeAccess";

const UNITED_KINGDOM = "United Kingdom";

/**
 * The office employee form is flat, but bank details are stored as a
 * sub-document. Fold the flat fields into it, and fill in the country the form
 * hides for British staff.
 *
 * Bank details are left untouched when the payload has none of those fields —
 * a user without the bank permission never sees them, so an edit from them
 * must not wipe what is stored.
 *
 * The right-to-work history is dropped: the edit form is seeded from the list
 * row, so it round-trips those keys, and only recordRightToWorkCheck() may
 * append to an append-only log.
 */
const buildOfficeEmployeePayload = (data) => {
  const {
    accountName,
    bankName,
    accountNumber,
    sortCode,
    country,
    rightToWorkChecks,
    lastRightToWorkCheckDate,
    ...rest
  } = data;
  const hasBankFields = accountName || bankName || accountNumber || sortCode;

  // Only decide `country` when the payload is actually about it.
  //
  // Not a fix for a live bug — a guard against a latent one. Every caller today
  // submits the whole record: react-hook-form hands `handleSubmit` a clone of
  // its form values, which keeps the defaults of fields that were never
  // mounted, so `country` arrives even on a screen that never showed it. That
  // is also why `rightToWorkChecks` has to be stripped above.
  //
  // But `country` is derived, not entered — it is only rendered for non-British
  // staff, and otherwise falls through to `country || UNITED_KINGDOM`. Any
  // caller that sends a genuinely partial payload would therefore reset a
  // non-UK employee to United Kingdom without touching the field. Deciding it
  // only when the payload carries something to decide it from costs nothing
  // for the callers that send everything, and removes the trap for one that
  // does not.
  const decidesCountry =
    Object.prototype.hasOwnProperty.call(data, "immigrationType") ||
    country !== undefined;

  return {
    ...rest,
    ...(decidesCountry
      ? {
          country:
            data?.immigrationType === "British"
              ? UNITED_KINGDOM
              : country || UNITED_KINGDOM,
        }
      : {}),
    ...(hasBankFields
      ? { bankDetail: { accountName, bankName, accountNumber, sortCode } }
      : {}),
  };
};

/**
 * Whether the signed-in user may change employee records at all.
 *
 * The same question handleOfficeEmployee answers for itself before writing,
 * exposed so a screen can hide a save button instead of offering one that will
 * be refused. Shaped like canViewSensitiveDetails() so both read the same way
 * at the call site.
 *
 * The Edit tab used to decide this with `role === "superAdmin"`, which hid the
 * button from every admin while leaving the fields enabled — they could type a
 * correction and then find nothing to press, with nothing on screen saying why.
 */
export async function canManageEmployees() {
  const { canManage } = await getEmployeeManageAccess();
  return {
    success: true,
    message: "Employee management access resolved",
    data: canManage,
  };
}

export const handleOfficeEmployee = withAudit(
  "OfficeEmployee.upsert",
  async (data, id) => {
  // make dealy for  testing
  // await new Promise((resolve) => setTimeout(resolve, 1000));
  // return;
  // check if email and phone  already exist in db
  if (!data) return { success: false, message: "No Data Provided" };
  try {
    // Who is calling, and whose record they are entitled to write. Without
    // this the action took an id and a payload from its caller and assigned the
    // payload onto that record — so any signed-in account could set
    // isSuperAdmin on itself. See lib/employeeAccess.js for why the permission
    // list is the shape it is; a caller holding any of them is unaffected.
    const { user, canManage } = await getEmployeeManageAccess();
    if (!user?._id) return { success: false, message: "Not signed in" };

    const isSelfEdit = !canManage;
    if (isSelfEdit && (!id || String(id) !== String(user._id))) {
      return {
        success: false,
        message: "You can only change your own details",
      };
    }

    // An employee editing themselves writes the handful of fields they own —
    // address and next of kin — and nothing else. Everything the record exists
    // to assert goes through HR.
    const payload = isSelfEdit ? pickSelfEditableFields(data) : data;

    if (id) {
      // update an existing office employee
      const updatedEmp = await OfficeEmployeeModel.findOne({ _id: id }).exec();
      if (!updatedEmp) {
        return { success: false, message: "Employee Not Found" };
      }
      // checking  for unique fields both email and phone. Each check runs only
      // when the payload actually carries that field: Mongoose drops undefined
      // keys from a query, so `{ email: undefined }` would match the first
      // other employee in the company and refuse a legitimate save.
      const hasSameEmail = payload.email
        ? await OfficeEmployeeModel.findOne({
            email: payload.email,
            delete: false, // only check for active employees
            _id: { $ne: id },
          }).exec()
        : null;
      const hasSamePhone = payload.phoneNumber
        ? await OfficeEmployeeModel.findOne({
            phoneNumber: payload.phoneNumber,
            delete: false, // only check for active employees
            _id: { $ne: id },
          }).exec()
        : null;
      if (hasSameEmail || hasSamePhone) {
        throw new Error("This Email or Phone Number is Already In Use");
      }
      // if the email is changing we have to convert it to lowercase
      if (payload.email) payload.email = payload.email.toLowerCase();
      const beforeEmp = updatedEmp.toObject();
      // The self-edit payload is already exactly the fields being written, so
      // it is assigned as-is. buildOfficeEmployeePayload() must not run over it:
      // it fills in `country` from `immigrationType`, and with neither field
      // present that resets a non-UK employee's country to United Kingdom.
      Object.assign(
        updatedEmp,
        isSelfEdit ? payload : buildOfficeEmployeePayload(payload)
      );
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
        // Seat limit. Unlimited unless the platform team has set a number, so
        // this caps nobody who has not been given one.
        const { props: sessionProps } = await getServerSideProps();
        const seats = await checkTenantSeats(
          sessionProps?.session?.user?.tenantId
        );
        if (!seats.allowed) {
          return { success: false, message: seats.message };
        }

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
          // The link has to point at the employee's own company, not at one
          // hardcoded host.
          const appUrl = await resolveTenantAppUrl(company);
          const html = `<p>Dear ${name},</p>
          <p>Welcome to the team. Your account has been created.</p>
          <p><strong>Email:</strong> ${email}</p>
          <p>Use the password your administrator gave you, or reset it from the
          sign-in page.</p>
          ${emailButton("Sign in", appUrl)}
          <p>If the button does not work, open: ${appUrl}</p>`;
          await sendTenantMail({
            tenantId: company,
            feature: "HR",
            to: email,
            subject: `Welcome to ${cData?.name || "the team"}`,
            heading: "Your account is ready",
            html,
          });
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
            // Current 2FA enrolment, so a super admin can see who is protected
            // and how many recovery codes they have left before deciding to
            // reset anyone — the reset is then an informed action rather than a
            // blind one.
            //
            // `twofas` is a global collection (GLOBAL_COLLECTIONS in
            // lib/tenantPlugin.js), so the aggregate hook leaves this lookup
            // unscoped, which is correct: enrolment records carry no tenantId
            // and a tenant match would silently empty the join.
            {
              $lookup: {
                from: "twofas",
                let: { empId: "$_id" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$employeeId", "$$empId"] } } },
                  {
                    $project: {
                      _id: 0,
                      isEnabled: 1,
                      backupCodesRemaining: {
                        $size: {
                          $filter: {
                            input: { $ifNull: ["$backupCodes", []] },
                            as: "c",
                            cond: { $eq: ["$$c.usedAt", null] },
                          },
                        },
                      },
                    },
                  },
                ],
                as: "twoFactor",
              },
            },
            {
              $addFields: {
                twoFactorEnabled: {
                  $ifNull: [
                    { $arrayElemAt: ["$twoFactor.isEnabled", 0] },
                    false,
                  ],
                },
                twoFactorBackupCodes: {
                  $ifNull: [
                    { $arrayElemAt: ["$twoFactor.backupCodesRemaining", 0] },
                    0,
                  ],
                },
              },
            },
            { $unset: "twoFactor" },
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
  async ({
    employeeId,
    newPassword,
    reason,
    // Both default true: a reset is nearly always a response to a lockout or a
    // suspected compromise, and an omitted flag should not quietly leave old
    // sessions alive or the admin's password standing forever.
    signOutEverywhere = true,
    requirePasswordChange = true,
  } = {}) => {
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

      // Sessions are JWTs, so there is nothing to delete server-side. Every
      // token carries the moment it was issued; moving this stamp forward makes
      // auth.js refuse anything older, which ends every signed-in device at
      // once — including whoever may have been using the old password.
      if (signOutEverywhere) {
        employee.sessionsValidFrom = new Date();
      }

      // The admin has necessarily seen this password. Requiring a change means
      // it only ever gets them through the door once.
      employee.mustChangePassword = !!requirePasswordChange;

      await employee.save();

      // Confirm the two security flags actually landed, rather than assuming.
      //
      // Mongoose silently drops unknown paths on save, and `mongoose.models` is
      // a module-level singleton that survives a hot reload — so a server still
      // running the schema from before these fields existed writes the password
      // and quietly discards the rest. The admin is told the account was
      // secured, the employee signs in with no forced change, and nothing
      // anywhere reports a problem. Reading the flags back is what turns that
      // into something visible.
      const saved = await OfficeEmployeeModel.findById(employeeId)
        .select("mustChangePassword sessionsValidFrom")
        .lean();

      const flagsMissing =
        (!!requirePasswordChange && saved?.mustChangePassword !== true) ||
        (!!signOutEverywhere && !saved?.sessionsValidFrom);

      if (flagsMissing) {
        return {
          success: false,
          message:
            "The password was changed, but 'sign out everywhere' and 'require a " +
            "password change' could not be saved — the server is running an " +
            "older version of the employee record. Restart the app and set them " +
            "again.",
        };
      }

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
          signedOutEverywhere: !!signOutEverywhere,
          mustChangePassword: !!requirePasswordChange,
        },
      });

      // Said plainly, because both are consequences the admin should be able to
      // confirm landed rather than infer from the toggles they set.
      const consequences = [
        signOutEverywhere && "signed out of all devices",
        requirePasswordChange && "will be asked to set their own at next login",
      ].filter(Boolean);

      return {
        success: true,
        message: consequences.length
          ? `Password reset. ${targetName} has been ${consequences.join(" and ")}.`
          : "Password reset successfully",
      };
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
