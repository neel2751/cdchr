"use server";

import webpush from "web-push";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";

webpush.setVapidDetails(
  "mailto:neel@cdc.construction",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Store a browser's push endpoint against whoever subscribed.
 *
 * Tries the office collection first and falls back to field staff: the two are
 * separate collections with independent id spaces, and the caller is a browser
 * that only knows its own user id. Writing blind to OfficeEmploye — which is
 * what this did — silently discarded every field employee's subscription.
 */
export async function saveSubscription(userId, subscription) {
  try {
    await connect();
    const office = await OfficeEmployeeModel.findByIdAndUpdate(userId, {
      pushSubscription: subscription,
    });
    if (office) return true;

    const field = await EmployeModel.findByIdAndUpdate(userId, {
      pushSubscription: subscription,
    });
    return !!field;
  } catch (error) {
    console.error("Error saving subscription:", error);
    return false;
  }
}

// export async function sendNotification(userId, message) {
//   try {
//     await connect();
//     const employee = await OfficeEmployeeModel.findById(userId);
//     if (!employee || !employee.pushSubscription) {
//       return {
//         success: false,
//         message: "Employee has not enabled notifications on their browser.",
//       };
//     }

//     const payload = JSON.stringify({
//       title: "Attendance Reminder",
//       body: message,
//       url: "/admin/dashboard",
//     });

//     await webpush.sendNotification(employee.pushSubscription, payload);
//     return { success: true, message: "Notification sent successfully." };
//   } catch (error) {
//     console.error("Error sending notification:", error);
//     return { success: false, message: "Error sending notification." };
//   }
// }

export async function sendNotification(userId, message) {
  try {
    await connect();

    const employee = await OfficeEmployeeModel.findById(userId);

    if (!employee || !employee.pushSubscription) {
      return {
        success: false,
        message: "Employee has not enabled notifications on their browser.",
      };
    }

    const payload = JSON.stringify({
      title: "Attendance Reminder",
      body: message,
      url: "/admin/dashboard",
    });

    await webpush.sendNotification(employee.pushSubscription, payload);
    return {
      success: true,
      message: "Notification sent successfully.",
    };
  } catch (error) {
    if (error.statusCode === 410 || error.statusCode === 404) {
      console.log(
        `Subscription for user ${userId} has expired or is no longer valid.`
      );
    }
    console.error("Error sending notification:", error);
    return {
      success: false,
      message: `Push failed: ${error.statusCode || "Unknown error"}`,
    };
  }
}

export async function sendTestNotification(userId) {
  return await sendNotification(
    userId,
    "This is a test notification from Attendance System."
  );
}
