"use server";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import bcrypt from "bcryptjs";
import UserSession from "@/models/sessionModel";
import { sendTenantMail } from "../email/tenantMail";
import { getServerSideProps } from "../session/session";
import EmployeModel from "@/models/employeModel";
import OfficeUserModel from "@/models/officeModel";
import PlatformUserModel from "@/models/platformUserModel";
import { escapeTenant } from "@/lib/tenantContext";
import TenantMembershipModel from "@/models/tenantMembershipModel";

export const LoginDataOld = async (email, password) => {
  if (!email || !password)
    return { status: false, message: "Please Provide  all details" };
  password = password.trim();
  email = email.trim();
  email = email.toLowerCase();
  try {
    await connect();
    const foundData = await OfficeEmployeeModel.findOne({ email })
      .lean()
      .exec();
    if (!foundData)
      return {
        status: false,
        message: "Email  Not Found",
      };
    if (foundData.isActive === false || foundData.delete === true)
      return {
        status: false,
        message: "Your account is Inactive! Please contact Admin...",
      };
    // we have to check if british check endDate other wise check endDate and visaEndDate
    if (foundData.immigrationType === "British") {
      if (foundData.endDate < new Date()) {
        return {
          status: false,
          message: "Your EndDate has expired. Please contact Admin...",
        };
      }
    } else {
      if (
        foundData.endDate < new Date() ||
        foundData.visaEndDate < new Date()
      ) {
        return {
          status: false,
          message: "Your visa has expired. Please contact Admin...",
        };
      }
    }

    // Check Password
    const isMatch = await isMatchedPassword(password, foundData.password);
    if (!isMatch)
      return {
        status: false,
        message: "Invalid Password! Try  Again...",
      };
    if (foundData?.isSuperAdmin) {
      foundData["role"] = "superAdmin";
    } else if (foundData?.isAdmin) {
      foundData["role"] = "admin";
    } else {
      foundData["role"] = "user";
    }
    delete foundData["password"];
    foundData["employeType"] = "OfficeEmploye";
    // store the login Token in to DB
    // const token = await storeToken(foundData);
    // if (token.success) {
    // foundData["loginToken"] = token.token;
    return {
      status: true,
      data: foundData,
    };
    // }
    // return {
    //   status: fal,
    //   data: foundData,
    // };
  } catch (error) {
    console.log(error);
    return {
      status: false,
      message: "Something Went Wrong! Please Try Again...",
    };
  }
};

export const LoginDataNew = async (email, password) => {
  if (!email || !password)
    return { status: false, message: "Please provide all details" };

  email = email.trim();
  password = password.trim();

  await connect();

  // Try OfficeEmployeeModel first
  let user = await OfficeEmployeeModel.findOne({
    email,
    delete: { $ne: true },
  }).lean();
  let userType = "office";

  if (!user) {
    // Then try SiteEmployeeModel
    user = await EmployeModel.findOne({ email, delete: { $ne: true } }).lean();
    userType = "site";
  }

  if (!user) {
    user = await OfficeUserModel.findOne({
      email,
      delete: { $ne: true },
    }).lean();
    userType = "reception";
  }

  // No user found
  if (!user) {
    return { status: false, message: "Email not found" };
  }

  // Check active status
  if (!user.isActive) {
    return {
      status: false,
      message: "Your account is inactive. Please contact admin.",
    };
  }

  // Date/visa checks only for Office Employee
  if (userType === "office") {
    if (user.immigrationType === "British") {
      if (new Date(user.endDate) < new Date()) {
        return {
          status: false,
          message: "Your EndDate has expired. Please contact Admin.",
        };
      }
    } else if (userType === "site") {
      if (
        new Date(user.endDate) < new Date() ||
        new Date(user.visaEndDate) < new Date()
      ) {
        return {
          status: false,
          message: "Your visa has expired. Please contact Admin.",
        };
      }
    }
  }

  // Password check
  const isMatch = await isMatchedPassword(password, user.password);
  if (!isMatch) {
    return {
      status: false,
      message: "Invalid password. Try again.",
    };
  }

  // Set role based on user type
  if (userType === "office") {
    if (user.isSuperAdmin) user.role = "superAdmin";
    else if (user.isAdmin) user.role = "admin";
    else user.role = "user";
    // const siteAssignment = await SiteAssignManagerModel.findOne({
    //   email,
    //   isActive: true,
    //   isDelete: false,
    // });
    // if (siteAssignment && siteAssignment.projectSiteID) {
    //   user.siteId = siteAssignment?.projectSiteID;
    // }
  } else if (userType === "site") {
    user.role = "siteEmployee";
  } else {
    user.role = "reception";
    //
  }

  delete user.password;
  // Set employeType based on user type
  user.employeType =
    userType === "office"
      ? "OfficeEmployee"
      : userType === "site"
      ? "SiteEmployee"
      : "ReceptionEmployee";
  // user.employeType = userType === "office" ? "OfficeEmployee" : "SiteEmployee";
  user.name = user.name || user.firstName || "User";
  return {
    status: true,
    data: user,
  };
};

export const LoginData = async (email, password, deviceId) => {
  if (!email || !password)
    return { status: false, message: "Please provide all details" };

  email = email.trim();
  password = password.trim();

  await connect();

  // Cross-tenant by necessity: at this point there is no session, so there is
  // no tenant — working out which one the account belongs to is the whole
  // purpose of this lookup. Which tenant they may then reach is enforced
  // afterwards, from the signed session.
  const { user, userType } = await escapeTenant("login: find account by email", async () => {
    // Try OfficeEmployeeModel first
    let found = await OfficeEmployeeModel.findOne({
      email,
      delete: { $ne: true },
    }).lean();
    if (found) return { user: found, userType: "office" };

    // Then try SiteEmployeeModel
    found = await EmployeModel.findOne({ email, delete: { $ne: true } }).lean();
    if (found) return { user: found, userType: "site" };

    found = await OfficeUserModel.findOne({
      email,
      delete: { $ne: true },
    }).lean();
    if (found) return { user: found, userType: "reception" };

    // Provider-side staff who administer the platform itself. Checked last, so
    // this branch is only reached for an email that belongs to no tenant — a
    // deployment with no platform users behaves exactly as it did before.
    found = await PlatformUserModel.findOne({
      email: email.toLowerCase(),
      delete: { $ne: true },
    }).lean();
    if (found) return { user: found, userType: "platform" };

    return { user: null, userType: null };
  });

  // No user found
  if (!user) {
    return { status: false, message: "Email not found" };
  }

  // Check active status
  if (!user.isActive) {
    return {
      status: false,
      message: "Your account is inactive. Please contact admin.",
    };
  }

  // Password check
  const isMatch = await isMatchedPassword(password, user.password);
  if (!isMatch) {
    return {
      status: false,
      message: "Invalid password. Try again.",
    };
  }

  if (userType === "reception" && user.enforceDeviceLock) {
    console.log("Checking device authorization for reception user");
    const isAuthorizedDevice = user?.authorizedDevices?.some(
      (device) => device?.deviceId === deviceId
    );
    if (!isAuthorizedDevice) {
      return {
        status: false,
        message: "DEVICE_UNAUTHORIZED",
        detectedId: deviceId,
      };
    }
  }

  // Date/visa checks only for Office Employee
  if (userType === "office") {
    if (user.immigrationType === "British") {
      if (new Date(user.endDate) < new Date()) {
        return {
          status: false,
          message: "Your EndDate has expired. Please contact Admin.",
        };
      }
    } else if (userType === "site") {
      if (
        new Date(user.endDate) < new Date() ||
        new Date(user.visaEndDate) < new Date()
      ) {
        return {
          status: false,
          message: "Your visa has expired. Please contact Admin.",
        };
      }
    }
  }

  // Set role based on user type
  if (userType === "office") {
    if (user.isSuperAdmin) user.role = "superAdmin";
    else if (user.isAdmin) user.role = "admin";
    else user.role = "user";
    // const siteAssignment = await SiteAssignManagerModel.findOne({
    //   email,
    //   isActive: true,
    //   isDelete: false,
    // });
    // if (siteAssignment && siteAssignment.projectSiteID) {
    //   user.siteId = siteAssignment?.projectSiteID;
    // }
  } else if (userType === "site") {
    user.role = "siteEmployee";
  } else if (userType === "platform") {
    // Deliberately distinct from superAdmin, which is the top role *inside* a
    // tenant. platformAdmin sits outside every tenant and can only reach
    // /platform (see rolePathMap in proxy.js).
    user.role = "platformAdmin";
  } else {
    user.role = "reception";
    //
  }

  delete user.password;
  // Set employeType based on user type
  user.employeType =
    userType === "office"
      ? "OfficeEmployee"
      : userType === "site"
      ? "SiteEmployee"
      : userType === "platform"
      ? "PlatformUser"
      : "ReceptionEmployee";
  // user.employeType = userType === "office" ? "OfficeEmployee" : "SiteEmployee";
  user.name = user.name || user.firstName || "User";
  // Which company this login lands in. The employee record's own tenant is the
  // default, but a membership marked default wins — that is what lets one login
  // own several companies and choose where it starts.
  user.tenantId = user.tenantId ? String(user.tenantId) : null;
  if (userType === "office" && user._id) {
    try {
      const preferred = await TenantMembershipModel.findOne({
        userId: user._id,
        isActive: true,
        isDefault: true,
      })
        .lean()
        .exec();
      if (preferred?.tenantId) {
        user.tenantId = String(preferred.tenantId);
        user.role = preferred.role || user.role;
      }
    } catch (error) {
      // A membership lookup failure must never block signing in; the account
      // simply starts in its own company.
      console.log("Membership lookup failed:", error?.message);
    }
  }
  return {
    status: true,
    data: user,
  };
};

export const isMatchedPassword = async (password, hashword) => {
  try {
    // console.log(password, hashword);
    return await bcrypt.compareSync(password, hashword);
  } catch (error) {
    console.log(`Error in Matching Password ${error}`);
  }
};

export const storeSession = async (data) => {
  try {
    const {
      _id: userId,
      employeType: userType,
      platform,
      browser,
      device,
      query: ipAddress,
      country,
      city,
      zip,
      lat: latitude,
      lon: longitude,
      isp,
    } = data;
    const obj = {
      userId,
      userType:
        userType === "OfficeEmployee"
          ? "OfficeEmploye"
          : userType === "PlatformUser"
          ? "PlatformUser"
          : "Employe",
      platform,
      browser,
      device,
      ipAddress,
      country,
      city,
      zip,
      latitude,
      longitude,
      isp,
    };
    const alreadyStore = await UserSession.findOne({ userId, ipAddress });
    if (alreadyStore) {
      const update = await UserSession.updateOne({ userId, ipAddress }, obj);
      if (update) {
        return { status: true, message: "Session Updated" };
      }
    } else {
      const session = await UserSession.create(obj);
      if (session) {
        // Sent as the user's own company, so the notice carries their branding
        // rather than whichever company the deployment was first built for.
        await sendTenantMail({
          tenantId: data.tenantId,
          feature: "All",
          to: data.email,
          subject: "New sign-in to your account",
          heading: "New sign-in detected",
          html: loginNoticeBody(obj),
        });
        return { status: true };
      }
    }
    return { status: false, message: "Failed to store session" };
  } catch (error) {
    console.log(`Error in Storing Session ${error}`);
    return { status: false, message: "Failed to store session" };
  }
};

/** Body of the "new sign-in" notice; the branded shell is added by the sender. */
function loginNoticeBody(info) {
  const row = (label, value) =>
    value ? `<p style="margin:4px 0"><strong>${label}:</strong> ${value}</p>` : "";
  return `
    <p>We noticed a sign-in to your account:</p>
    ${row("IP address", info.ipAddress)}
    ${row("Device", info.device)}
    ${row("Browser", info.browser)}
    ${row("Location", [info.city, info.country].filter(Boolean).join(", "))}
    ${row("Time", new Date().toUTCString())}
    <p>If this was you, no action is needed. If not, change your password and
    contact your administrator.</p>`;
}

export const getSessionData = async () => {
  try {
    const { props } = await getServerSideProps();
    const userId = props?.session?.user?._id;
    if (!userId) return { status: false, message: "User not found" };

    // and near date on top result
    const user = await UserSession.find({ userId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return { status: true, data: JSON.stringify(user) };
  } catch (error) {
    console.log(`Error in Getting Session Data ${error}`);
    return { status: false, message: "Failed to get session data" };
  }
};

export const verifyPassword = async (password) => {
  try {
    if (!password) return { success: false, message: "Password is required" };
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    const employee = await OfficeEmployeeModel.findById(employeeId)
      .lean()
      .exec();
    if (!employee) return { success: false, message: "User not found" };

    const isMatch = await isMatchedPassword(password, employee.password);
    if (!isMatch) return { success: false, message: "Invalid Password" };

    return { success: true, message: "Password Verified" };
  } catch (error) {
    console.log(`Error in Verifying Password ${error}`);
    return { success: false, message: "Failed to verify password" };
  }
};

// const storeToken = async (data) => {
//   try {
//     const loginToken = crypto.randomUUID();
//     const user = await OfficeEmployeeModel.findOne({ email: data.email });
//     if (!user) return { success: false, message: "User not found" };
//     const userId = await LoginTokenModel.findOne({ userId: user._id });
//     if (!userId) {
//       const token = await LoginTokenModel.create({
//         loginToken,
//         userId: user._id,
//       });
//       if (token) {
//         return { success: true, token: loginToken };
//       }
//     } else {
//       const update = await LoginTokenModel.updateOne(
//         { userId: user._id },
//         { loginToken }
//       );
//       if (update) {
//         return { success: true, token: loginToken };
//       }
//     }
//   } catch (error) {
//     console.log(`Error in Storing Token ${error}`);
//     return { success: false, message: "Failed to store token" };
//   }
// };

// export const handleSignOut = async () => {
//   try {
//     const { props } = await getServerSideProps();
//     const userId = props.session.user._id;
//     const loginToken = "";
//     const update = await LoginTokenModel.updateOne({ userId }, { loginToken });
//   } catch (error) {
//     console.log(`Error in SignOut ${error}`);
//   }
// };

// export function getClientFingerprint(req) {
//   const userAgent = req.headers["user-agent"] || "";
//   const ip =
//     req.headers["x-forwarded-for"] || req.connection.remoteAddress || "";
//   return `${userAgent}-${ip}`; // Simple fingerprint example
// }
