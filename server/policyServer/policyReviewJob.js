// Context-free, like server/visaServer/visaReminderJob.js: no next/headers and
// no next-auth, so it runs from the cron route with no session.

import { connect } from "@/db/db";
import { logAuditDirect } from "@/lib/audit";
import { getWorkingDate } from "@/lib/clockTime";
import { createObjectId } from "@/lib/mongodb";
import { REVIEW_WARNING_DAYS, daysBetween, reviewMilestone } from "@/lib/policies";
import { isFeatureEnabled } from "@/lib/tenantPlan";
import { escapeTenant, runWithTenant } from "@/lib/tenantContext";
import CompanyModel from "@/models/companyModel";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import PolicyCategoryModel from "@/models/policyCategoryModel";
import PolicyModel from "@/models/policyModel";
import {
  resolveTenantAppUrl,
  resolveTenantFeatureMailbox,
  sendTenantMail,
} from "@/server/email/tenantMail";
import { policyReviewTemplate } from "@/server/email/templates/policyReviewTemplate";

/**
 * Daily reminders that a policy is coming up for review, for every company.
 *
 * Who hears: the policy's owner, with the company's HR mailbox copied. A
 * policy with no owner — or one whose owner has left or has no email —
 * reminds the HR mailbox instead, and says why, so the gap gets noticed.
 *
 * When: see reviewMilestone() in lib/policies.js — 30 days out, 7 days out,
 * on the day, then weekly while overdue. Each reminder is claimed on the
 * policy before it is sent, in the same write that checks it has not been
 * sent, so two runs at once cannot both send it. A failed send gives the
 * claim back so the next day's run tries again.
 *
 * Skips companies whose plan has policies switched off: reminders are part of
 * maintaining the library, which is what the switch turns off.
 *
 * @param {{now?: Date, send?: Function}} [options] `send` defaults to
 *   sendTenantMail; tests pass their own so nothing is mailed.
 * @returns {Promise<{tenants:number, due:number, sent:number, skipped:number, failed:number}>}
 */
export async function runPolicyReviewJob({ now = new Date(), send = sendTenantMail } = {}) {
  await connect();
  const results = { tenants: 0, due: 0, sent: 0, skipped: 0, failed: 0 };

  const tenants = await escapeTenant("policy review cron: iterate companies", () =>
    CompanyModel.find({ delete: { $ne: true }, isActive: { $ne: false } })
      .select("_id features")
      .lean(),
  );

  for (const tenant of tenants) {
    if (!isFeatureEnabled(tenant.features, "policies")) continue;
    results.tenants++;
    const one = await runWithTenant(String(tenant._id), () =>
      remindCurrentTenant(String(tenant._id), { now, send }),
    );
    for (const key of ["due", "sent", "skipped", "failed"]) results[key] += one[key];
  }

  return results;
}

/** One company's pass. Assumes its tenant is already in context. */
async function remindCurrentTenant(tenantId, { now, send }) {
  const results = { due: 0, sent: 0, skipped: 0, failed: 0 };
  const today = getWorkingDate(now);

  // tenantId named outright, not left to the tenant plugin. This job sends
  // mail AS a company — its sender, its branding, its links — and with
  // TENANT_ENFORCEMENT=shadow the plugin filters nothing, so each company's
  // pass would also pick up every other company's policies and remind their
  // owners in the wrong company's name.
  const policies = await PolicyModel.find({
    tenantId: createObjectId(tenantId),
    isDeleted: false,
    status: "active",
    nextReviewDate: {
      $ne: null,
      $lte: new Date(today.getTime() + REVIEW_WARNING_DAYS * 86400000),
    },
  }).lean();
  if (!policies.length) return results;

  const [appUrl, hrMailbox, categories, owners] = await Promise.all([
    resolveTenantAppUrl(tenantId),
    resolveTenantFeatureMailbox(tenantId, "HR"),
    PolicyCategoryModel.find({ _id: { $in: policies.map((p) => p.categoryId) } })
      .select("_id name")
      .lean(),
    OfficeEmployeeModel.find({
      _id: { $in: policies.map((p) => p.ownerId).filter(Boolean) },
      isActive: true,
      delete: { $ne: true },
    })
      .select("_id name email")
      .lean(),
  ]);
  const categoryName = Object.fromEntries(categories.map((c) => [String(c._id), c.name]));
  const ownerOf = Object.fromEntries(owners.map((o) => [String(o._id), o]));

  for (const policy of policies) {
    const daysUntilDue = daysBetween(today, policy.nextReviewDate);
    const milestone = reviewMilestone(daysUntilDue);
    if (!milestone) continue;
    results.due++;

    const dueDate = policy.nextReviewDate;
    const claim = await PolicyModel.updateOne(
      {
        _id: policy._id,
        nextReviewDate: dueDate,
        reviewRemindersSent: { $not: { $elemMatch: { milestone, dueDate } } },
      },
      { $push: { reviewRemindersSent: { milestone, dueDate, sentAt: now } } },
    );
    if (!claim.modifiedCount) {
      results.skipped++;
      continue;
    }

    const owner = policy.ownerId ? ownerOf[String(policy.ownerId)] : null;
    const toOwner = Boolean(owner?.email);
    const to = toOwner ? owner.email : hrMailbox;
    const cc = toOwner && hrMailbox && hrMailbox !== owner.email ? [hrMailbox] : [];

    const audit = (status, description, errorMessage) =>
      logAuditDirect({
        actor: { system: true },
        action: "Policy.reviewReminder",
        module: "Policy",
        entityId: policy._id,
        description,
        status,
        errorMessage,
        metadata: { milestone, dueDate: dueDate.toISOString(), to, cc, daysUntilDue },
      });

    if (!to) {
      // Nobody to tell. The claim is kept: retrying tomorrow would find
      // nobody again and fill the audit log. The next milestone tries afresh,
      // by which time somebody may have set an owner or an HR mailbox.
      results.failed++;
      await audit(
        "failure",
        `No one to remind about policy "${policy.title}" — it has no owner with an email and no HR mailbox is set`,
        "No recipient",
      );
      continue;
    }

    const { subject, heading, html } = policyReviewTemplate({
      milestone,
      daysUntilDue,
      title: policy.title,
      categoryName: categoryName[String(policy.categoryId)],
      dueDate,
      versionNumber: policy.currentVersionNumber,
      publishedAt: policy.currentPublishedAt,
      lastReviewedAt: policy.lastReviewedAt,
      lastReviewedByName: policy.lastReviewedByName,
      recipientName: toOwner ? owner.name : "",
      toOwner,
      link: `${appUrl}/admin/policies/${policy._id}`,
    });

    const res = await send({ tenantId, feature: "HR", to, cc, subject, heading, html });

    if (res?.success) {
      results.sent++;
      await audit("success", `Sent the ${milestone} review reminder for policy "${policy.title}" to ${to}`);
    } else {
      // Given back, so tomorrow's run tries again.
      await PolicyModel.updateOne(
        { _id: policy._id },
        { $pull: { reviewRemindersSent: { milestone, dueDate } } },
      );
      results.failed++;
      await audit(
        "failure",
        `Could not send the ${milestone} review reminder for policy "${policy.title}"`,
        res?.message || "Send failed",
      );
    }
  }

  return results;
}
