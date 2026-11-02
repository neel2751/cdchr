// Plain functions, no "use server": imported by policyServer.js, not called
// from the browser. Assumes a tenant is already in context.

import PolicyCategoryModel from "@/models/policyCategoryModel";
import PolicyReceiptModel from "@/models/policyReceiptModel";
import PolicyVersionModel from "@/models/policyVersionModel";
import {
  resolveTenantAppUrl,
  sendTenantMail,
} from "@/server/email/tenantMail";
import { policyReadTemplate } from "@/server/email/templates/policyReadTemplate";
import { resolveAudience } from "../announcementServer/audience";

// The same pacing as announcement email, for the same reason: a company of
// 400 on a shared SMTP account is throttled, or blacklisted, if 400 messages
// leave at once.
const BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Everyone a policy is addressed to, with where each of them has got to on
 * the version in force:
 *
 *   "acknowledged"  confirmed they have read and understood it
 *   "opened"        opened it, not (or not asked to) confirm
 *   "not-opened"    nothing yet
 *
 * Judged against today's audience. Somebody who confirmed and has since left
 * the audience is not counted: the report answers "of the people this
 * applies to, who has read it", and they are no longer one of them.
 *
 * @returns {Promise<Array<{employeeId, name, email, status, firstOpenedAt, acknowledgedAt}>>}
 */
export async function policyReaderRows(policy) {
  if (!policy?.currentVersionId) return [];

  const people = (await resolveAudience(policy.audience)).filter(
    (p) => p.kind === "office",
  );
  if (!people.length) return [];

  const receipts = await PolicyReceiptModel.find({
    versionId: policy.currentVersionId,
    employeeId: { $in: people.map((p) => p.employeeId) },
  })
    .select("employeeId firstOpenedAt acknowledgedAt")
    .lean();
  const receiptOf = Object.fromEntries(receipts.map((r) => [String(r.employeeId), r]));

  return people
    .map((person) => {
      const receipt = receiptOf[String(person.employeeId)];
      return {
        employeeId: person.employeeId,
        name: person.name,
        email: person.email || "",
        status: receipt?.acknowledgedAt
          ? "acknowledged"
          : receipt?.firstOpenedAt
            ? "opened"
            : "not-opened",
        firstOpenedAt: receipt?.firstOpenedAt || null,
        acknowledgedAt: receipt?.acknowledgedAt || null,
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Counts for the library table and the report header. */
export function summariseReaders(rows) {
  const count = (status) => rows.filter((r) => r.status === status).length;
  return {
    total: rows.length,
    acknowledged: count("acknowledged"),
    opened: count("opened"),
    notOpened: count("not-opened"),
  };
}

/**
 * Who still has something to do: for a policy that asks for confirmation,
 * everyone who has not confirmed; otherwise everyone who has not opened it.
 */
export function outstandingReaders(policy, rows) {
  return rows.filter((r) =>
    policy.requireAck ? r.status !== "acknowledged" : r.status === "not-opened",
  );
}

/**
 * Email a list of people asking them to read a policy.
 *
 * Failures are per person and never stop the run. People with no email
 * address are counted, not silently dropped, so the manager is told how many
 * the email could not reach.
 *
 * @param {object} p
 * @param {object} p.policy      lean policy
 * @param {Array}  p.recipients  rows from policyReaderRows
 * @param {string} p.tenantId
 * @param {Function} [p.send]    defaults to sendTenantMail; tests pass a fake
 * @param {number} [p.pauseMs]   between batches; tests pass 0
 * @returns {Promise<{sent:number, failed:number, noEmail:number}>}
 */
export async function emailPolicyReaders({
  policy,
  recipients,
  tenantId,
  send = sendTenantMail,
  pauseMs = BATCH_PAUSE_MS,
}) {
  const result = { sent: 0, failed: 0, noEmail: 0 };

  const [appUrl, category, version] = await Promise.all([
    resolveTenantAppUrl(tenantId),
    PolicyCategoryModel.findById(policy.categoryId).select("name").lean(),
    PolicyVersionModel.findById(policy.currentVersionId)
      .select("changeNote effectiveDate")
      .lean(),
  ]);

  const { subject, heading, html } = policyReadTemplate({
    title: policy.title,
    summary: policy.summary,
    categoryName: category?.name,
    versionNumber: policy.currentVersionNumber,
    changeNote: policy.currentVersionNumber > 1 ? version?.changeNote : "",
    effectiveDate: version?.effectiveDate,
    requireAck: policy.requireAck,
    link: `${String(appUrl || "").replace(/\/$/, "")}/admin/my-policies`,
  });

  const withEmail = recipients.filter((r) => r.email);
  result.noEmail = recipients.length - withEmail.length;

  for (let i = 0; i < withEmail.length; i += BATCH_SIZE) {
    const batch = withEmail.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(
      batch.map(async (person) => {
        try {
          const res = await send({
            tenantId,
            // A broadcast nobody should reply to, like announcement email.
            feature: "Noreply",
            to: person.email,
            subject,
            heading,
            html,
          });
          return !!res?.success;
        } catch (error) {
          console.log(`[policy-mail] ${person.email} failed:`, error?.message);
          return false;
        }
      }),
    );
    for (const ok of outcomes) {
      if (ok) result.sent++;
      else result.failed++;
    }
    if (pauseMs && i + BATCH_SIZE < withEmail.length) await sleep(pauseMs);
  }

  return result;
}
