"use server";
import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import ClockLocationModel from "@/models/clockLocationModel";
import OfficeUserModel from "@/models/officeModel";
import { featureRefusal } from "@/lib/requireFeature";
import { getServerSideProps } from "../session/session";

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
  const { userId, deviceId, deviceName, locationId = null } = data;
  const refusal = await featureRefusal("reception");
  if (refusal) return refusal;

  try {
    await connect();

    // Find the user first to check if device already exists
    const user = await OfficeUserModel.findById(userId);
    // Was `res.status(404)` — a leftover from an Express handler. `res` does
    // not exist in a server action, so a missing user threw a ReferenceError
    // instead of returning a message anyone could read.
    if (!user) return { success: false, message: "User not found" };

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
          // `addedAt` is what the schema defines; `authorizedAt` was being
          // pushed instead, so it was stored as a stray field and addedAt
          // silently took its default.
          addedAt: new Date(),
          locationId:
            locationId && isValidObjectId(locationId)
              ? createObjectId(locationId)
              : null,
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

/**
 * Say which office a reception screen stands in.
 *
 * Enrolment, done once by an administrator. After this the screen answers the
 * question itself and nobody at the desk has to — which is the point: the
 * previous answer was a dropdown remembered in the browser, so it was per
 * device *profile* rather than per device, chosen by whoever was standing
 * there, and silently wrong if mis-picked.
 *
 * Passing null unenrols the screen, which sends it back to asking rather than
 * leaving it pointed somewhere stale.
 */
export async function setDeviceLocation({ userId, deviceId, locationId } = {}) {
  const refusal = await featureRefusal("reception");
  if (refusal) return refusal;

  try {
    if (!userId || !isValidObjectId(userId)) {
      return { success: false, message: "Invalid user" };
    }
    if (!deviceId) return { success: false, message: "Invalid device" };
    if (locationId && !isValidObjectId(locationId)) {
      return { success: false, message: "Invalid location" };
    }

    await connect();

    // A screen may only be pointed at a real, active location in this company.
    // Tenant scoping makes "in this company" automatic; without the check an
    // id from anywhere would be accepted and the codes would name a place that
    // does not exist.
    let target = null;
    if (locationId) {
      target = await ClockLocationModel.findOne({
        _id: createObjectId(locationId),
        isActive: true,
      })
        .select("name")
        .lean();
      if (!target) return { success: false, message: "Location not found" };
    }

    // arrayFilters so the right entry is updated by device id rather than by a
    // positional index read a moment earlier.
    const res = await OfficeUserModel.updateOne(
      { _id: createObjectId(userId) },
      {
        $set: {
          "authorizedDevices.$[entry].locationId": target
            ? createObjectId(locationId)
            : null,
        },
      },
      { arrayFilters: [{ "entry.deviceId": deviceId }] },
    );

    if (!res.matchedCount) {
      return { success: false, message: "That device is not authorised" };
    }

    return {
      success: true,
      message: target
        ? `This screen now issues codes for "${target.name}"`
        : "This screen now falls back to the office set on this desk",
    };
  } catch (error) {
    console.error("Error setting device location:", error);
    return { success: false, message: "Could not set the location" };
  }
}

/**
 * Which office is the screen in front of me?
 *
 * Three answers, in this order, and the order is the point:
 *
 *   1. **The screen**, if someone enrolled it. Looked up across the company
 *      rather than only on the signed-in account, deliberately: the screen is
 *      what is physically in a room, and a desk where two receptionists sign
 *      in on alternate days is one screen in one office, not two.
 *   2. **The account**, if the desk has a default office. Covers a screen
 *      nobody has enrolled yet — a replacement tablet, a second browser —
 *      without falling all the way back to asking.
 *   3. **Nothing**, in which case the caller asks. It never guesses: a guess
 *      files attendance at the wrong office and nothing looks broken.
 *
 * Tenant scoping keeps every lookup inside the company.
 */
export async function getDeviceLocation({ deviceId } = {}) {
  const refusal = await featureRefusal("reception");
  if (refusal) return refusal;

  const nothing = { success: true, data: JSON.stringify({}) };

  /**
   * Read the location itself rather than trusting the id that was stored.
   * An office archived after enrolment must stop minting codes, not keep
   * going because a device row still names it.
   */
  const liveOffice = async (locationId) => {
    if (!locationId) return null;
    return ClockLocationModel.findOne({ _id: locationId, isActive: true })
      .select("name")
      .lean();
  };

  try {
    await connect();

    // 1. the screen
    if (deviceId) {
      const owner = await OfficeUserModel.findOne({
        authorizedDevices: {
          $elemMatch: { deviceId, locationId: { $ne: null } },
        },
        delete: { $ne: true },
      })
        .select("authorizedDevices")
        .lean();

      const entry = owner?.authorizedDevices?.find(
        (d) => d.deviceId === deviceId && d.locationId,
      );
      const office = await liveOffice(entry?.locationId);
      if (office) {
        return {
          success: true,
          data: JSON.stringify({
            locationId: String(office._id),
            locationName: office.name,
            source: "screen",
          }),
        };
      }
    }

    // 2. the account signed in at it
    const { props } = await getServerSideProps();
    const sessionUser = props?.session?.user;
    if (!sessionUser?._id || !isValidObjectId(sessionUser._id)) return nothing;

    const account = await OfficeUserModel.findById(
      createObjectId(sessionUser._id),
    )
      .select("clockLocationId")
      .lean();

    const fromAccount = await liveOffice(account?.clockLocationId);
    if (!fromAccount) return nothing;

    return {
      success: true,
      data: JSON.stringify({
        locationId: String(fromAccount._id),
        locationName: fromAccount.name,
        source: "account",
      }),
    };
  } catch (error) {
    console.error("Error resolving device location:", error);
    // Falls back to asking rather than failing the screen.
    return nothing;
  }
}
