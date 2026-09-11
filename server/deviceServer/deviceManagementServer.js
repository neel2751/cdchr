"use server";
import { connect } from "@/db/db";
import OfficeUserModel from "@/models/officeModel";
import { featureRefusal } from "@/lib/requireFeature";

/**
 * Trusted devices for the reception desk.
 *
 * Gated by `reception`, NOT by `devices`, despite the filename. These actions
 * back app/admin/reception/components/deviceManagement.jsx — the list of tablets
 * allowed to run the front desk. The `devices` module is the separate device
 * inventory behind /admin/device (server/deviceServer/deviceServer.js).
 *
 * Gating these under `devices` would break the reception desk for any company
 * that has reception but not the inventory module.
 */
export async function addDevice(data) {
  const { userId, deviceId, deviceName } = data;
  const refusal = await featureRefusal("reception");
  if (refusal) return refusal;

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
  const refusal = await featureRefusal("reception");
  if (refusal) return refusal;

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
  const refusal = await featureRefusal("reception");
  if (refusal) return refusal;
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

// export async function verifyDevice(data) {
//   const { userId, deviceId } = data;

//   try {
//     await connect();
//     const user = await OfficeUserModel.findById(userId).lean();

//     if (!user || !user.enforceDeviceLock) {
//       return res.status(200).json({ authorized: true });
//     }

//     // Check if the deviceId still exists in the authorized list
//     const isAuthorized = user.authorizedDevices.some(
//       (d) => d.deviceId === deviceId
//     );

//     // from user we have to remove the password
//     delete user.password;

//     return {
//       success: true,
//       authorized: isAuthorized,
//       data: user,
//     };
//   } catch (error) {
//     console.error("Error verifying device:", error);
//     return {
//       success: false,
//       message: "Internal server error",
//     };
//   }
// }

// Deliberately NOT plan-gated. This is the device-trust check itself, called
// from /api/reception/verify-device while a session may not yet exist —
// featureRefusal answers "allowed" without one, so a gate here would look like
// enforcement while doing nothing. The screens that manage the trusted-device
// list are gated above, which is where the decision actually belongs.
export async function verifyDevice(data) {
  const { userId, deviceId } = data;

  try {
    await connect();
    const user = await OfficeUserModel.findById(userId).lean();

    if (!user) {
      return { success: false, message: "User not found" };
    }

    // Check if the deviceId still exists in the authorized list
    // If enforceDeviceLock is OFF, we return true automatically
    const isAuthorized =
      !user.enforceDeviceLock ||
      user.authorizedDevices.some((d) => d.deviceId === deviceId);

    // Safety: Remove sensitive data
    const { password, ...userData } = user;

    return {
      success: true,
      authorized: isAuthorized,
      data: userData,
    };
  } catch (error) {
    console.error("Error verifying device:", error);
    return { success: false, message: "Internal server error" };
  }
}
