"use server";

import webpush from "web-push";
import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import { permissionRefusal } from "@/lib/actionAccess";
import { getServerSideProps } from "../session/session";

/**
 * Push notifications, and who may aim one at whom.
 *
 * All three actions here took the employee id to act on from their caller and
 * checked nobody, which for an addressable endpoint meant: anyone could attach
 * THEIR OWN browser as a colleague's push endpoint and start receiving that
 * person's notifications, and anyone could push arbitrary text to any employee
 * — a notification from the company's own app is about as credible a phishing
 * surface as this product has.
 *
 * So the two self-service actions are pinned to the session, and sending to
 * somebody else needs the Office Attendance screen that offers the button.
 */
const OWNS = ["/admin/attendance"];

/** The signed-in employee's own id, or null. */
async function callerId() {
  try {
    const { props } = await getServerSideProps();
    return props?.session?.user?._id || null;
  } catch {
    return null;
  }
}

/**
 * Refuse unless the caller is acting on their own record.
 *
 * Subscribing a browser and testing that it works are things you do to
 * yourself; the id in the argument is a convenience for the client, never a
 * claim to be honoured.
 */
async function refuseUnlessSelf(userId) {
  const me = await callerId();
  if (!me) return { success: false, message: "Not signed in" };
  if (!userId || String(userId) !== String(me)) {
    return { success: false, message: "You can only do this for yourself" };
  }
  return null;
}

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
  const denied = await refuseUnlessSelf(userId);
  if (denied) return denied;

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
/** The send itself. Private: every caller below has already been authorised. */
async function pushTo(userId, message, options = {}) {
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

/**
 * Nudge somebody else — the button on Office Attendance.
 */
export async function sendNotification(userId, message, options = {}) {
  const denied = await permissionRefusal(OWNS);
  if (denied) return denied;
  return pushTo(userId, message, options);
}

/** "Check my notifications work", from the banner. Self only. */
export async function sendTestNotification(userId) {
  const denied = await refuseUnlessSelf(userId);
  if (denied) return denied;

  return pushTo(
    userId,
    "This is a test notification from the Attendance System.",
  );
}
