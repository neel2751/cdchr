"use server";

import OfficeUserModel from "@/models/officeModel";
import { getServerSideProps } from "../session/session";
import { hashPassword, isMatchedPassword } from "@/utils/bcrypt";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import ClockLocationModel from "@/models/clockLocationModel";
import EmployeModel from "@/models/employeModel";
import { connect } from "@/db/db";

/**
 * Turn whatever the form sent into a usable office id, or null.
 *
 * Null is a real answer and means "ask at the desk" — it is not a failure, so
 * an unset or cleared field is allowed through rather than refused. What is
 * refused is a value naming something that is not an active office: a site
 * would make the desk issue codes against a job, and an archived office would
 * mint codes for a place nobody can clock in at.
 */
async function resolveOffice(value) {
  if (!value || !isValidObjectId(value)) return null;
  await connect();
  const office = await ClockLocationModel.findOne({
    _id: createObjectId(value),
    projectSiteId: null,
    isActive: true,
  })
    .select("_id")
    .lean();
  return office ? office._id : null;
}

export async function createReceptionUser(data, userId) {
  const { props } = await getServerSideProps();
  const { user } = props?.session || {};
  if (!user || user.role !== "superAdmin") {
    return {
      success: false,
      message: "Unauthorized access",
    };
  }

  if (!data || !data.email || !data.name) {
    return {
      success: false,
      message: "Invalid data provided",
    };
  }

  if (userId) {
    return await updateReceptionUser(data, userId);
  } else {
    try {
      // first we have to check if the user already exists
      await connect();
      const email = data?.email?.toLowerCase();
      const emailExists = await OfficeUserModel.findOne({
        email: email,
        delete: false,
      });
      const existingOfficeEmployee = await OfficeUserModel.findOne({
        email: email,
        delete: false,
      });
      const existingEmployee = await EmployeModel.findOne({
        email: email,
        delete: false,
      });
      if (emailExists || existingOfficeEmployee || existingEmployee) {
        return {
          success: false,
          message: "Email already exists",
        };
      }

      const password = await hashPassword("Cdc@1234");
      // create the user
      const newUser = new OfficeUserModel({
        ...data,
        email: email,
        password: password,
        // What makes this a reception account rather than office staff. The
        // screen that lists these filters on it, so without the stamp a new
        // desk would not appear on the screen that created it.
        isReception: true,
        clockLocationId: await resolveOffice(data?.clockLocationId),
        createdBy: user._id,
        updatedBy: user._id,
      });
      await newUser.save();
      return {
        success: true,
        message: "Reception user created successfully",
      };
    } catch (error) {
      console.log("Error creating reception user:", error);
      return {
        success: false,
        message: "Error creating reception user",
        error: error.message || "Unknown error",
      };
    }
  }
}

export async function updateReceptionUser(data, userId) {
  const { props } = await getServerSideProps();
  const { user } = props?.session || {};
  if (!user || user.role !== "superAdmin") {
    return {
      success: false,
      message: "Unauthorized access",
    };
  }
  if (!data || !userId) {
    return {
      success: false,
      message: "Invalid data provided",
    };
  }

  try {
    await connect();
    // first we have to check if the user exists
    const existingUser = await OfficeUserModel.findOne({
      _id: userId,
      delete: false,
    });
    if (!existingUser) {
      return {
        success: false,
        message: "User not found",
      };
    }

    // update the user
    const updatedUser = await OfficeUserModel.findByIdAndUpdate(
      userId,
      {
        ...data,
        // Validated rather than taken as given: an id from anywhere, or one
        // naming an archived office, would leave the desk pointed at a place
        // that cannot be clocked in at.
        ...(data?.clockLocationId !== undefined
          ? { clockLocationId: await resolveOffice(data.clockLocationId) }
          : {}),
        updatedBy: user._id,
      },
      { new: true }
    );

    return {
      success: true,
      message: "Reception user updated successfully",
      data: updatedUser,
    };
  } catch (error) {
    console.log("Error updating reception user:", error);
    return {
      success: false,
      message: "Error updating reception user",
      error: error.message || "Unknown error",
    };
  }
}

export async function getReceptionUsers(query = {}) {
  const { props } = await getServerSideProps();
  const { user } = props?.session || {};
  if (!user || user.role !== "superAdmin") {
    return {
      success: false,
      message: "Unauthorized access",
    };
  }

  try {
    await connect();
    // Reception accounts only. This filtered on `delete: false` alone, so the
    // screen listed every office employee in the company and an administrator
    // had to know which of them was the front desk.
    const users = await OfficeUserModel.find({
      delete: false,
      isReception: true,
      ...query,
    })
      .select("-password -delete -createdBy -updatedBy")
      .populate({ path: "clockLocationId", select: "name isActive" })
      .lean();

    return {
      success: true,
      data: JSON.stringify(users),
    };
  } catch (error) {
    console.log("Error fetching reception users:", error);
    return {
      success: false,
      message: "Error fetching reception users",
      error: error.message || "Unknown error",
    };
  }
}

export async function deleteReceptionUser(userId) {
  const { props } = await getServerSideProps();
  const { user } = props?.session || {};
  if (!user || user.role !== "superAdmin") {
    return {
      success: false,
      message: "Unauthorized access",
    };
  }
  if (!userId) {
    return {
      success: false,
      message: "Invalid user ID",
    };
  }

  try {
    await connect();
    // first we have to check if the user exists
    const existingUser = await OfficeUserModel.findOne({
      _id: userId,
      delete: false,
    });
    if (!existingUser) {
      return {
        success: false,
        message: "User not found",
      };
    }

    // soft delete the user
    await OfficeUserModel.findByIdAndUpdate(userId, {
      delete: true,
      updatedBy: user._id,
    });

    return {
      success: true,
      message: "Reception user deleted successfully",
    };
  } catch (error) {
    console.log("Error deleting reception user:", error);
    return {
      success: false,
      message: "Error deleting reception user",
      error: error.message || "Unknown error",
    };
  }
}

export async function getReceptionUserById(userId) {
  const { props } = await getServerSideProps();
  const { user } = props?.session || {};
  if (!user || user.role !== "superAdmin") {
    return {
      success: false,
      message: "Unauthorized access",
    };
  }

  try {
    await connect();
    const userData = await OfficeUserModel.findOne({
      _id: userId,
      delete: false,
    }).select("-password -delete -createdBy -updatedBy");

    if (!userData) {
      return {
        success: false,
        message: "User not found",
      };
    }

    return {
      success: true,
      data: JSON.stringify(userData),
    };
  } catch (error) {
    console.log("Error fetching reception user by ID:", error);
    return {
      success: false,
      message: "Error fetching reception user",
      error: error.message || "Unknown error",
    };
  }
}

// update the password
export async function updateReceptionUserPassword(userId, newPassword) {
  const { props } = await getServerSideProps();
  const { user } = props?.session || {};
  // Was `!user.isReception`. Nothing ever set that field and the session never
  // carried it, so this action refused every caller including the super admin
  // who owns the screen. Every other action in this file is super admin, and a
  // password reset for someone else's account is not something a reception
  // desk should be doing to itself.
  if (!user || user.role !== "superAdmin") {
    return {
      success: false,
      message: "Unauthorized access",
    };
  }

  if (!userId || !newPassword) {
    return {
      success: false,
      message: "Invalid user ID or password",
    };
  }

  try {
    await connect();
    // first we have to check if the user exists
    const existingUser = await OfficeUserModel.findOne({
      _id: userId,
      delete: false,
    });
    if (!existingUser) {
      return {
        success: false,
        message: "User not found",
      };
    }

    // update the password
    //
    // `await` was missing: a Promise was written into the password field, so
    // the account could never sign in again and the screen said it had worked.
    const hashedPassword = await hashPassword(newPassword);
    await OfficeUserModel.findByIdAndUpdate(userId, {
      password: hashedPassword,
      updatedBy: user._id,
    });

    return {
      success: true,
      message: "Password updated successfully",
    };
  } catch (error) {
    console.log("Error updating reception user password:", error);
    return {
      success: false,
      message: "Error updating password",
      error: error.message || "Unknown error",
    };
  }
}

export async function checkPassword(password) {
  const { props } = await getServerSideProps();
  const { user } = props?.session || {};
  if (!user) {
    return {
      success: false,
      message: "Unauthorized access",
    };
  }

  try {
    await connect();
    // check the password
    const userExist = await OfficeUserModel.findOne({
      _id: user._id,
      delete: false,
    });

    if (!userExist) {
      return {
        success: false,
        message: "User not found",
      };
    }
    const isValidPassword = await isMatchedPassword(
      password,
      userExist.password
    );

    if (!isValidPassword) {
      return {
        success: false,
        message: "Invalid password",
      };
    }

    return {
      success: true,
      message: "Password is valid",
    };
  } catch (error) {
    console.log("Error checking reception user password:", error);
    return {
      success: false,
      message: "Error checking password",
      error: error.message || "Unknown error",
    };
  }
}

// fetch user by email
export async function getReceptionUserByEmail(email) {
  try {
    await connect();
    const userData = await OfficeUserModel.findOne({
      email: email.toLowerCase(),
      delete: false,
    }).select("-password -delete -createdBy -updatedBy");
    const isActive = !!(userData && userData.isActive !== false);
    return {
      success: true,
      isActive,
    };
  } catch (error) {
    console.log("Error fetching reception user by email:", error);
    return {
      success: false,
      message: "Error fetching reception user",
      error: error.message || "Unknown error",
    };
  }
}
