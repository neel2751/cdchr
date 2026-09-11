/**
 * Web Push for announcements.
 *
 * Context-free — no next/headers, no next-auth — so the scheduler can use it.
 * A tenant must already be in context, which is what scopes the two employee
 * lookups.
 *
 * Separate from announcementDelivery.js only because push has one behaviour
 * email does not: a subscription that the push service rejects with 410 (gone)
 * or 404 is dead forever, and must be cleared. The existing sender in
 * server/attendanceServer/notificationServer.js logs that case and moves on,
 * so those rows accumulate and are retried on every send.
 *
 * Plain functions, no "use server".
 */

import webpush from "web-push";

import EmployeModel from "@/models/employeModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";

// Same batching reasoning as email: a push service will rate-limit a burst.
const BATCH_SIZE = 50;

let configured = false;

/**
 * Configure web-push lazily.
 *
 * At module scope this throws when the VAPID keys are absent, which would take
 * down every import of this file — including the scheduler, which has no
 * interest in push. Returns false when push is not set up, so callers skip it.
 */
function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:support@example.com",
    publicKey,
    privateKey
  );
  configured = true;
  return true;
}

const MODEL_BY_KIND = { office: OfficeEmployeeModel, field: EmployeModel };

/** Bytes in a base64url string, without decoding it. */
function base64UrlLength(value) {
  const clean = String(value || "").replace(/[=]+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

/**
 * Could web-push actually use this subscription?
 *
 * Checked here rather than left to web-push because its complaint about a
 * malformed key ("p256dh value should be 65 bytes long") is a plain Error with
 * no statusCode — indistinguishable, at the catch site, from a network blip.
 * Treating those alike would mean either retrying a permanently broken row on
 * every send forever, or deleting live subscriptions on a transient failure.
 *
 * A row that fails this is dead in exactly the way a 410 is dead: nothing about
 * the next attempt will differ, so it is cleared.
 */
function isUsableSubscription(subscription) {
  if (!subscription?.endpoint) return false;
  if (!/^https:\/\//i.test(subscription.endpoint)) return false;
  // Sizes fixed by the Web Push spec: an uncompressed P-256 point and a
  // 16-byte auth secret.
  if (base64UrlLength(subscription?.keys?.p256dh) !== 65) return false;
  if (base64UrlLength(subscription?.keys?.auth) !== 16) return false;
  return true;
}

/** Forget a subscription the push service says is gone. */
async function clearSubscription(kind, employeeId) {
  const Model = MODEL_BY_KIND[kind];
  if (!Model) return;
  try {
    await Model.findByIdAndUpdate(employeeId, { pushSubscription: null });
  } catch (error) {
    console.log("[announcement-push] could not clear subscription:", error?.message);
  }
}

/**
 * Push one announcement to whichever recipients have a live subscription.
 *
 * @param {Object} announcement lean announcement document
 * @param {Array<{kind:string, employeeId:any}>} recipients
 * @returns {Promise<{sent:number, failed:number, skipped:number, cleared:number}>}
 */
export async function pushAnnouncement(announcement, recipients) {
  const result = { sent: 0, failed: 0, skipped: 0, cleared: 0 };
  if (!ensureConfigured()) {
    result.skipped = recipients.length;
    return result;
  }

  // Only the people in the audience, and only those who opted in. Fetched in
  // two queries rather than one per person.
  const byKind = { office: [], field: [] };
  for (const person of recipients) {
    byKind[person.kind === "field" ? "field" : "office"].push(person.employeeId);
  }

  const subscribers = [];
  for (const [kind, ids] of Object.entries(byKind)) {
    if (!ids.length) continue;
    const rows = await MODEL_BY_KIND[kind]
      .find({ _id: { $in: ids }, pushSubscription: { $ne: null } })
      .select("_id pushSubscription")
      .lean();
    for (const row of rows) {
      subscribers.push({ kind, employeeId: row._id, subscription: row.pushSubscription });
    }
  }

  result.skipped = recipients.length - subscribers.length;
  if (!subscribers.length) return result;

  // The two populations use different apps, so the deep link differs. Built
  // per kind rather than per person — there are only two.
  const payloadFor = (kind) =>
    JSON.stringify({
      title:
        announcement.priority === "urgent"
          ? `Urgent: ${announcement.title}`
          : announcement.title,
      // The body is markdown and can be long; the notification gets the title
      // and a nudge, and the app has the rest.
      body: announcement.requireAck
        ? "Tap to read and acknowledge"
        : "Tap to read",
      url:
        kind === "field"
          ? `/employee/announcements/${announcement._id}`
          : `/admin/my-announcements/${announcement._id}`,
    });

  const payloads = { office: payloadFor("office"), field: payloadFor("field") };

  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);

    const outcomes = await Promise.all(
      batch.map(async (person) => {
        if (!isUsableSubscription(person.subscription)) {
          await clearSubscription(person.kind, person.employeeId);
          return "cleared";
        }
        try {
          await webpush.sendNotification(
            person.subscription,
            payloads[person.kind]
          );
          return "sent";
        } catch (error) {
          const status = error?.statusCode;
          if (status === 410 || status === 404) {
            await clearSubscription(person.kind, person.employeeId);
            return "cleared";
          }
          console.log(
            `[announcement-push] ${person.employeeId} failed:`,
            status || error?.message
          );
          return "failed";
        }
      })
    );

    for (const outcome of outcomes) {
      if (outcome === "sent") result.sent++;
      else if (outcome === "cleared") result.cleared++;
      else result.failed++;
    }
  }

  return result;
}
