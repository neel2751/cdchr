/**
 * Sending an announcement out over the optional channels.
 *
 * Context-free on purpose — no next/headers, no next-auth — so the scheduler
 * can call it from a cron with no request behind it, and the publish action can
 * call it from one. A tenant must already be in context (runWithTenant), which
 * is what picks the company's SMTP account and branding.
 *
 * In-app delivery is not here: an announcement is visible the moment its status
 * becomes "published", so there is nothing to send. This file is only the
 * copies that leave the building.
 *
 * Plain functions, no "use server".
 */

import { logAuditDirect } from "@/lib/audit";
import { announcementTemplate } from "@/server/email/templates/announcementTemplate";
import {
  resolveTenantAppUrl,
  sendTenantMail,
} from "@/server/email/tenantMail";
import { resolveAudience } from "./audience";
import { pushAnnouncement } from "./announcementPush";

// A company of 400 on a shared SMTP fallback will get throttled — or
// blacklisted — if 400 messages leave at once. Chunked, with a pause between.
const BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Email one announcement to a list of people.
 *
 * Failures are per-recipient and never abort the run: one bad address must not
 * stop the other 399 from being told the office is closed.
 *
 * @param {Object} announcement  lean announcement document
 * @param {Array<{email:string,name:string,employeeId:any}>} recipients
 * @param {string} tenantId
 * @returns {Promise<{sent:number, failed:number, skipped:number}>}
 */
async function emailRecipients(announcement, recipients, tenantId) {
  const result = { sent: 0, failed: 0, skipped: 0 };

  const appUrl = await resolveTenantAppUrl(tenantId);
  const url = appUrl
    ? `${appUrl.replace(/\/$/, "")}/admin/my-announcements/${announcement._id}`
    : "";

  const { subject, html, heading } = announcementTemplate({
    title: announcement.title,
    body: announcement.body,
    priority: announcement.priority,
    authorName: announcement.createdByName,
    requireAck: announcement.requireAck,
    attachmentCount: announcement.attachments?.length || 0,
    url,
  });

  const withEmail = recipients.filter((r) => r.email);
  result.skipped = recipients.length - withEmail.length;

  for (let i = 0; i < withEmail.length; i += BATCH_SIZE) {
    const batch = withEmail.slice(i, i + BATCH_SIZE);

    const outcomes = await Promise.all(
      batch.map(async (person) => {
        try {
          const res = await sendTenantMail({
            tenantId,
            // Broadcasts nobody should reply to. Falls back to the company's
            // default sender when no no-reply account is configured.
            feature: "Noreply",
            to: person.email,
            subject,
            heading,
            html,
          });
          return !!res?.success;
        } catch (error) {
          console.log(
            `[announcement-mail] ${person.email} failed:`,
            error?.message
          );
          return false;
        }
      })
    );

    for (const ok of outcomes) {
      if (ok) result.sent++;
      else result.failed++;
    }

    if (i + BATCH_SIZE < withEmail.length) await sleep(BATCH_PAUSE_MS);
  }

  return result;
}

/**
 * Send whatever channels an announcement asked for.
 *
 * Best-effort by design: the announcement is already published and readable in
 * the app, so a mail server being down must not undo that or fail the publish.
 * The outcome goes to the audit log, which is where the visa reminder records
 * its sends too.
 *
 * (The plan called for EmailUsage rows here. Nothing in the app actually writes
 * that collection — it is only read — and its `emailId` is the EmailAccount the
 * message went through, which sendTenantMail resolves internally and does not
 * return. The audit log is the pattern that exists and is already queryable
 * from the Audit Logs screen.)
 *
 * @param {Object} announcement lean announcement document
 * @param {Object} [opts]
 * @param {Array} [opts.recipients] pre-resolved, to avoid resolving twice
 * @param {Object} [opts.actor]     who triggered it; defaults to the system
 */
export async function deliverAnnouncement(announcement, opts = {}) {
  const summary = { email: null, push: null };
  if (!announcement) return summary;

  const tenantId = announcement.tenantId
    ? String(announcement.tenantId)
    : null;
  if (!tenantId) return summary;

  const wantsEmail = announcement.channels?.email;
  const wantsPush = announcement.channels?.push;

  if (!wantsEmail && !wantsPush) return summary;

  const recipients =
    opts.recipients || (await resolveAudience(announcement.audience));

  if (wantsEmail) {
    try {
      summary.email = await emailRecipients(announcement, recipients, tenantId);
    } catch (error) {
      console.log("[announcement-mail] run failed:", error?.message);
      summary.email = { sent: 0, failed: recipients.length, skipped: 0 };
    }

    await logAuditDirect({
      action: "Announcement.emailed",
      module: "Announcement",
      entityId: announcement._id,
      tenantId,
      actor: opts.actor || { system: true },
      status: summary.email.failed > 0 ? "failure" : "success",
      description:
        `Emailed "${announcement.title}" to ${summary.email.sent} of ` +
        `${recipients.length} recipients` +
        (summary.email.failed ? ` (${summary.email.failed} failed)` : "") +
        (summary.email.skipped
          ? ` (${summary.email.skipped} had no address)`
          : ""),
      metadata: {
        sent: summary.email.sent,
        failed: summary.email.failed,
        skipped: summary.email.skipped,
        recipients: recipients.length,
      },
    }).catch((e) => console.log("Audit write failed:", e?.message));
  }

  if (wantsPush) {
    try {
      summary.push = await pushAnnouncement(announcement, recipients);
    } catch (error) {
      console.log("[announcement-push] run failed:", error?.message);
      summary.push = { sent: 0, failed: recipients.length, skipped: 0, cleared: 0 };
    }

    await logAuditDirect({
      action: "Announcement.pushed",
      module: "Announcement",
      entityId: announcement._id,
      tenantId,
      actor: opts.actor || { system: true },
      status: summary.push.failed > 0 ? "failure" : "success",
      description:
        `Pushed "${announcement.title}" to ${summary.push.sent} of ` +
        `${recipients.length} recipients` +
        (summary.push.failed ? ` (${summary.push.failed} failed)` : "") +
        (summary.push.skipped
          ? ` (${summary.push.skipped} not subscribed)`
          : "") +
        (summary.push.cleared
          ? ` (${summary.push.cleared} dead subscriptions cleared)`
          : ""),
      metadata: { ...summary.push, recipients: recipients.length },
    }).catch((e) => console.log("Audit write failed:", e?.message));
  }

  return summary;
}

/**
 * Email an announcement to a specific subset — the "remind who has not read it"
 * action on the report. Separate from deliverAnnouncement because it ignores
 * the announcement's own channel settings: a reminder is a deliberate act.
 */
export async function emailAnnouncementTo(announcement, recipients, actor) {
  const tenantId = announcement?.tenantId ? String(announcement.tenantId) : null;
  if (!tenantId || !recipients?.length) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const result = await emailRecipients(announcement, recipients, tenantId);

  await logAuditDirect({
    action: "Announcement.reminded",
    module: "Announcement",
    entityId: announcement._id,
    tenantId,
    actor: actor || { system: true },
    status: result.failed > 0 ? "failure" : "success",
    description:
      `Reminded ${result.sent} of ${recipients.length} people who had not ` +
      `read "${announcement.title}"`,
    metadata: result,
  }).catch((e) => console.log("Audit write failed:", e?.message));

  return result;
}
