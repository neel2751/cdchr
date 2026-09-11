/**
 * Publishing scheduled announcements.
 *
 * Context-free — no next/headers and no next-auth — so it runs from the cron
 * API route as well as from a manual trigger. Each company is handled inside
 * its own runWithTenant() scope, which both scopes the queries and picks that
 * company's SMTP sender; a single unscoped pass would have mailed everyone
 * through whichever company happened to be first.
 *
 * Idempotent: the status flip to "published" is the thing that makes an
 * announcement visible, and a second run finds nothing still "scheduled". A run
 * that dies half way through has published some and left the rest, which the
 * next tick picks up.
 */

import { connect } from "@/db/db";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import { logAuditDirect } from "@/lib/audit";
import AnnouncementModel from "@/models/announcementModel";
import CompanyModel from "@/models/companyModel";
import { emitToTenant } from "@/lib/realtime";
import { isFeatureEnabled } from "@/lib/tenantPlan";
import { resolveAudience } from "./audience";
import { deliverAnnouncement } from "./announcementDelivery";

/**
 * Publish everything due, for every company.
 * @returns {Promise<{tenants:number, published:number, failed:number, emailed:number}>}
 */
export async function runAnnouncementPublishJob() {
  await connect();
  const results = { tenants: 0, published: 0, failed: 0, emailed: 0 };

  const tenants = await escapeTenant(
    "announcement cron: iterate companies",
    () =>
      CompanyModel.find({ delete: { $ne: true }, isActive: { $ne: false } })
        .select("_id features")
        .lean()
  );

  for (const tenant of tenants) {
    // A company whose plan excludes the module should not have anything go out
    // for it, even if a draft was written while it was still switched on.
    //
    // Through isFeatureEnabled rather than comparing the flag here, so "absent
    // means enabled" stays one decision in one place. The two agree today; a
    // hand-written comparison is how they stop agreeing.
    if (!isFeatureEnabled(tenant.features, "announcements")) continue;

    results.tenants++;
    const one = await runWithTenant(String(tenant._id), () =>
      publishDueForCurrentTenant()
    );
    results.published += one.published;
    results.failed += one.failed;
    results.emailed += one.emailed;
  }

  return results;
}

/** One company's pass. Assumes a tenant is already in context. */
async function publishDueForCurrentTenant() {
  const results = { published: 0, failed: 0, emailed: 0 };
  const now = new Date();

  const due = await AnnouncementModel.find({
    status: "scheduled",
    isDeleted: false,
    publishAt: { $ne: null, $lte: now },
  }).lean();

  for (const announcement of due) {
    try {
      // The audience may have changed since it was scheduled, so the count is
      // taken now rather than trusting the one stored at scheduling time.
      const recipients = await resolveAudience(announcement.audience);

      const updated = await AnnouncementModel.findOneAndUpdate(
        // Re-checking the status is what makes two overlapping ticks safe: the
        // second one matches nothing and publishes nothing.
        { _id: announcement._id, status: "scheduled" },
        {
          status: "published",
          publishedAt: now,
          recipientCount: recipients.length,
        },
        { new: true }
      ).lean();

      if (!updated) continue; // another tick got there first

      results.published++;

      await logAuditDirect({
        action: "Announcement.publish",
        module: "Announcement",
        entityId: announcement._id,
        tenantId: announcement.tenantId,
        actor: { system: true },
        description:
          `Published scheduled announcement "${announcement.title}" to ` +
          `${recipients.length} recipients`,
      });

      // Same nudge the manual publish sends, so a scheduled announcement
      // appears without a refresh for anyone already looking at the app.
      emitToTenant(announcement.tenantId, "announcement:new", {
        announcementId: String(announcement._id),
      });

      const sent = await deliverAnnouncement(updated, { recipients });
      results.emailed += sent.email?.sent || 0;
    } catch (error) {
      results.failed++;
      console.error(
        `[announcement-cron] ${announcement._id} failed:`,
        error?.message
      );
    }
  }

  return results;
}

/**
 * How many announcements are waiting, per company — used by the cron route's
 * response so a quiet run is distinguishable from a broken one.
 */
export async function countScheduled() {
  await connect();
  return escapeTenant("announcement cron: count scheduled", () =>
    AnnouncementModel.countDocuments({ status: "scheduled", isDeleted: false })
  );
}
