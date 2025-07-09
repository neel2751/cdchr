"use server";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import bcrypt from "bcryptjs";
import UserSession from "@/models/sessionModel";
import { getServerSession } from "next-auth";
import { options } from "@/app/api/auth/[...nextauth]/option";
import { signOut } from "next-auth/react";
import { sendMail } from "../email/email";
import { getServerSideProps } from "../session/session";
import EmployeModel from "@/models/employeModel";

export const LoginDataOld = async (email, password) => {
  if (!email || !password)
    return { status: false, message: "Please Provide  all details" };
  password = password.trim();
  email = email.trim();
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

export const LoginData = async (email, password) => {
  if (!email || !password)
    return { status: false, message: "Please provide all details" };

  email = email.trim();
  password = password.trim();

  await connect();

  // Try OfficeEmployeeModel first
  let user = await OfficeEmployeeModel.findOne({ email }).lean();
  let userType = "office";

  if (!user) {
    // Then try SiteEmployeeModel
    user = await EmployeModel.findOne({ email }).lean();
    userType = "site";
  }

  // No user found
  if (!user) {
    return { status: false, message: "Email not found" };
  }

  // Check active status
  if (user.isActive === false || user.delete === true) {
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
    } else {
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
  } else {
    user.role = "siteEmployee";
  }

  delete user.password;
  user.employeType = userType === "office" ? "OfficeEmployee" : "SiteEmployee";
  user.name = user.name || user.firstName || "User";
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
      userType: userType === "OfficeEmployee" ? "OfficeEmploye" : "Employe",
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
        await sendMail({ ...obj, email: data.email });
        return { status: true };
      }
    }
    return { status: false, message: "Failed to store session" };
  } catch (error) {
    console.log(`Error in Storing Session ${error}`);
    return { status: false, message: "Failed to store session" };
  }
};

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
