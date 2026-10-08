"use server";

import webpush from "web-push";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";

// Guarded: setVapidDetails throws on a missing or malformed key, and at module
// scope that takes down every route that imports this file rather than just
// the notification feature.
let vapidReady = false;
try {
  if (
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY
  ) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:neel@cdc.construction",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    vapidReady = true;
  } else {
    console.warn("[push] VAPID keys are not set; notifications are disabled");
  }
} catch (error) {
  console.error("[push] VAPID configuration rejected:", error?.message);
}

/**
 * The two collections a person can live in.
 *
 * Office staff and field staff are separate collections with independent id
 * spaces, and every caller here has only a user id.
 */
const COLLECTIONS = [OfficeEmployeeModel, EmployeModel];

/** Find whoever owns this id, in whichever collection holds them. */
async function findAnyEmployee(userId, select) {
  for (const Model of COLLECTIONS) {
    const found = await Model.findById(userId).select(select).lean();
    if (found) return { Model, employee: found };
  }
  return { Model: null, employee: null };
}

/**
 * Store a browser's push endpoint against whoever subscribed.
 *
 * Tries the office collection first and falls back to field staff: writing
 * blind to OfficeEmploye — which is what this did — silently discarded every
 * field employee's subscription.
 */
export async function saveSubscription(userId, subscription) {
  try {
    if (!userId) return { success: false, message: "Not signed in" };
    if (!subscription?.endpoint) {
      return { success: false, message: "That browser returned no endpoint." };
    }

    await connect();
    for (const Model of COLLECTIONS) {
      const updated = await Model.findByIdAndUpdate(userId, {
        pushSubscription: subscription,
      });
      if (updated) return { success: true };
    }
    return { success: false, message: "Employee not found" };
  } catch (error) {
    console.error("Error saving subscription:", error);
    return { success: false, message: "Could not save the subscription." };
  }
}

/** Forget a dead endpoint so it stops being retried for ever. */
async function dropSubscription(userId) {
  for (const Model of COLLECTIONS) {
    const updated = await Model.findByIdAndUpdate(userId, {
      pushSubscription: null,
    });
    if (updated) return;
  }
}

/**
 * Nudge one person.
 *
 * This only ever looked in OfficeEmploye, so a site employee — the people most
 * likely to walk off a job without clocking out — could never be sent one.
 * The subscription had been saved correctly; it was the send that could not
 * find them.
 */
export async function sendNotification(userId, message, options = {}) {
  try {
    if (!vapidReady) {
      return {
        success: false,
        message: "Notifications are not configured on the server.",
      };
    }
    if (!userId) return { success: false, message: "No employee given." };

    await connect();
    const { employee } = await findAnyEmployee(userId, "pushSubscription name firstName");

    if (!employee) {
      return { success: false, message: "Employee not found." };
    }
    if (!employee.pushSubscription?.endpoint) {
      return {
        success: false,
        message: "They have not turned on notifications on their device yet.",
      };
    }

    const payload = JSON.stringify({
      title: options.title || "Attendance Reminder",
      body: message,
      url: options.url || "/admin/dashboard",
    });

    await webpush.sendNotification(employee.pushSubscription, payload);
    return { success: true, message: "Notification sent." };
  } catch (error) {
    // 404/410 mean the push service has permanently dropped this endpoint —
    // the browser was uninstalled, or the subscription was revoked. Clearing
    // it is what makes the banner offer to re-subscribe instead of the app
    // retrying a dead endpoint on every reminder from now on.
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await dropSubscription(userId).catch(() => {});
      return {
        success: false,
        message:
          "Their subscription has expired — ask them to enable notifications again.",
      };
    }
    console.error("Error sending notification:", error);
    return {
      success: false,
      message: `Could not send (${error?.statusCode || "unknown error"}).`,
    };
  }
}

export async function sendTestNotification(userId) {
  return await sendNotification(
    userId,
    "This is a test notification from the Attendance System.",
  );
}
