"use server";

import webpush from "web-push";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";

webpush.setVapidDetails(
  "mailto:neel@cdc.construction",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export async function saveSubscription(userId, subscription) {
  try {
    await connect();
    await OfficeEmployeeModel.findByIdAndUpdate(userId, {
      pushSubscription: subscription,
    });
    return true;
  } catch (error) {
    console.error("Error saving subscription:", error);
    return false;
  }
}

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
    return { success: true, message: "Notification sent successfully." };
  } catch (error) {
    console.error("Error sending notification:", error);
    return { success: false, message: "Error sending notification." };
  }
}

export async function sendTestNotification(userId) {
  return await sendNotification(
    userId,
    "This is a test notification from Attendance System."
  );
}
