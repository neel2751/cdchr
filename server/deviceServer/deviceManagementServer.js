"use server";
import { connect } from "@/db/db";
import OfficeUserModel from "@/models/officeModel";

export async function addDevice(data) {
  const { userId, deviceId, deviceName } = data;

  try {
    await connect();

    // Find the user first to check if device already exists
    const user = await OfficeUserModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isAlreadyAdded = user.authorizedDevices.some(
      (d) => d.deviceId === deviceId
    );
    if (isAlreadyAdded) {
      return {
        success: false,
        message: "Device is already authorized",
      };
    }

    // Add the new device using $push
    await OfficeUserModel.findByIdAndUpdate(userId, {
      $push: {
        authorizedDevices: {
          deviceId: deviceId,
          deviceName: deviceName || "Office Device",
          authorizedAt: new Date(),
        },
      },
    });

    return {
      success: true,
      message: "Device added successfully",
    };
  } catch (error) {
    console.error("Error adding device:", error);
    return {
      success: false,
      message: "Internal server error",
    };
  }
}

export async function revokeDevice(data) {
  const { userId, deviceId } = data;

  try {
    await connect();

    // Remove the device from the array using $pull
    await OfficeUserModel.findByIdAndUpdate(userId, {
      $pull: {
        authorizedDevices: { deviceId: deviceId },
      },
    });

    return {
      success: true,
      message: "Device removed successfully",
    };
  } catch (error) {
    console.error("Error removing device:", error);
    return {
      success: false,
      message: "Internal server error",
    };
  }
}

// /pages/api/admin/office-user/toggle-lock.js

export async function toggleDeviceLock(data) {
  const { userId, isEnabled } = data;
  await connect();
  await OfficeUserModel.findByIdAndUpdate(userId, {
    enforceDeviceLock: isEnabled,
  });
  return {
    success: true,
    message: "Device lock setting updated successfully",
  };
}

// /pages/api/auth/verify-device.js

export async function verifyDevice(data) {
  const { userId, deviceId } = data;

  try {
    await connect();
    const user = await OfficeUserModel.findById(userId).lean();

    if (!user || !user.enforceDeviceLock) {
      return res.status(200).json({ authorized: true });
    }

    // Check if the deviceId still exists in the authorized list
    const isAuthorized = user.authorizedDevices.some(
      (d) => d.deviceId === deviceId
    );

    // from user we have to remove the password
    delete user.password;

    return {
      success: true,
      authorized: isAuthorized,
      data: user,
    };
  } catch (error) {
    console.error("Error verifying device:", error);
    return {
      success: false,
      message: "Internal server error",
    };
  }
}
