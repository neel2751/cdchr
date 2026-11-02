"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { isReadOnly } from "@/lib/tenantContext";
import PolicyCategoryModel from "@/models/policyCategoryModel";
import PolicyModel from "@/models/policyModel";
import PolicyReceiptModel from "@/models/policyReceiptModel";
import PolicyVersionModel from "@/models/policyVersionModel";
import { getViewer, visibilityFilter } from "../announcementServer/audience";
import { generateDownloadUrl } from "../aws/upload";
import { getServerSideProps } from "../session/session";

/**
 * The policies a member of staff can read.
 *
 * Not gated by the plan, the same as announcements: switching a company's
 * module off stops anyone maintaining the library, not people reading what
 * they were already given.
 *
 * A policy is readable when every one of these holds — and they are all in
 * readableFilter(), the one place either export below asks:
 *   - it is active (published, not archived or deleted)
 *   - a manager has switched it to visible
 *   - the viewer is in its audience
 *
 * Only the current version is ever offered. The file key never leaves the
 * server: openMyPolicy() signs it for five minutes after asking the same
 * question again, so a link cannot outlive the permission that produced it
 * by long, and a policy hidden this morning cannot be opened with a key
 * somebody kept.
 */

const fail = (message) => ({ success: false, message });
const empty = { success: true, data: JSON.stringify([]) };

// "New" and "Updated" badges last this long after a version is published.
const RECENT_DAYS = 30;

/**
 * The signed-in person as an office employee, or null.
 *
 * Site staff get null: they have no portal, and policies cannot yet be
 * addressed to them, so there is nothing for them here.
 */
async function currentViewer() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id || user.role === "siteEmployee") return null;
  await connect();
  const viewer = await getViewer(user._id, "office");
  return viewer?.kind === "office" ? viewer : null;
}

function readableFilter(viewer) {
  return {
    isDeleted: false,
    status: "active",
    visibleToEmployees: true,
    currentVersionId: { $ne: null },
    ...visibilityFilter(viewer),
  };
}

/** Everything this person can read, grouped by category. */
export async function getMyPolicies() {
  try {
    const viewer = await currentViewer();
    if (!viewer) return empty;

    const policies = await PolicyModel.find(readableFilter(viewer))
      .select("_id title summary categoryId currentVersionId currentVersionNumber currentPublishedAt requireAck")
      .sort({ title: 1 })
      .lean();
    if (!policies.length) return empty;

    const [categories, versions, receipts] = await Promise.all([
      PolicyCategoryModel.find({
        _id: { $in: policies.map((p) => p.categoryId) },
      })
        .select("_id name sortOrder")
        .lean(),
      PolicyVersionModel.find({
        _id: { $in: policies.map((p) => p.currentVersionId) },
      })
        .select("_id changeNote effectiveDate file.fileType")
        .lean(),
      PolicyReceiptModel.find({
        employeeId: viewer.employeeId,
        versionId: { $in: policies.map((p) => p.currentVersionId) },
      })
        .select("versionId firstOpenedAt acknowledgedAt")
        .lean(),
    ]);

    const versionOf = Object.fromEntries(versions.map((v) => [String(v._id), v]));
    // Receipts for the version in force only: a confirmation of version 2
    // says nothing about version 3.
    const receiptOf = Object.fromEntries(receipts.map((r) => [String(r.versionId), r]));
    const recentSince = Date.now() - RECENT_DAYS * 86400000;

    const groups = categories
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((category) => ({
        _id: category._id,
        name: category.name,
        policies: policies
          .filter((p) => String(p.categoryId) === String(category._id))
          .map((p) => {
            const version = versionOf[String(p.currentVersionId)] || {};
            const receipt = receiptOf[String(p.currentVersionId)] || {};
            const recent =
              p.currentPublishedAt &&
              new Date(p.currentPublishedAt).getTime() > recentSince;
            return {
              _id: p._id,
              title: p.title,
              summary: p.summary,
              versionNumber: p.currentVersionNumber,
              publishedAt: p.currentPublishedAt,
              effectiveDate: version.effectiveDate || null,
              changeNote: version.changeNote || "",
              fileType: version.file?.fileType || "",
              badge: recent ? (p.currentVersionNumber > 1 ? "updated" : "new") : null,
              requireAck: !!p.requireAck,
              openedAt: receipt.firstOpenedAt || null,
              acknowledgedAt: receipt.acknowledgedAt || null,
            };
          }),
      }))
      .filter((group) => group.policies.length);

    return { success: true, data: JSON.stringify(groups) };
  } catch (error) {
    console.log("Error listing my policies:", error);
    return empty;
  }
}

/** A five-minute link to the current version of a policy this person can read. */
export async function openMyPolicy(policyId) {
  try {
    if (!isValidObjectId(policyId)) return fail("Invalid policy");
    const viewer = await currentViewer();
    if (!viewer) return fail("Policy not found");

    const policy = await PolicyModel.findOne({
      _id: createObjectId(policyId),
      ...readableFilter(viewer),
    })
      .select("currentVersionId currentVersionNumber")
      .lean();
    // The same answer for "does not exist" and "not for you": whether a
    // hidden policy exists is itself something a reader should not learn.
    if (!policy) return fail("Policy not found");

    const version = await PolicyVersionModel.findOne({
      _id: policy.currentVersionId,
      status: "published",
      isDeleted: false,
    })
      .select("file.key")
      .lean();
    if (!version) return fail("Policy not found");

    const res = await generateDownloadUrl({ key: version.file.key, expiresIn: 300 });
    if (!res?.success) return fail("Could not open the policy");

    // Recorded only once the link exists: a failure to sign is not a read.
    // And a failure to record must not stop somebody reading the policy.
    await recordOpen(policy, viewer).catch((error) =>
      console.log("Could not record a policy open:", error?.message),
    );

    return { success: true, data: JSON.stringify({ url: res.url }) };
  } catch (error) {
    console.log("Error opening policy:", error);
    return fail("Could not open the policy");
  }
}

/**
 * "I have read and understood this policy" — for the version in force.
 *
 * Only on a policy that asks, and only after opening it: a confirmation
 * pressed on a list without the document ever being opened is the thing an
 * acknowledgement is meant to rule out. Pressing it twice keeps the first
 * time, which is the one that answers "when did they confirm".
 */
export async function acknowledgeMyPolicy(policyId) {
  try {
    if (!isValidObjectId(policyId)) return fail("Invalid policy");
    const viewer = await currentViewer();
    if (!viewer) return fail("Policy not found");
    if (await isReadOnly()) return fail("This session is read-only.");

    const policy = await PolicyModel.findOne({
      _id: createObjectId(policyId),
      ...readableFilter(viewer),
    })
      .select("currentVersionId requireAck")
      .lean();
    if (!policy) return fail("Policy not found");
    if (!policy.requireAck) {
      return fail("This policy does not ask for a confirmation.");
    }

    const query = { versionId: policy.currentVersionId, employeeId: viewer.employeeId };
    const receipt = await PolicyReceiptModel.findOne(query)
      .select("firstOpenedAt acknowledgedAt")
      .lean();
    if (!receipt?.firstOpenedAt) {
      return fail("Open the policy and read it first.");
    }
    if (receipt.acknowledgedAt) {
      return { success: true, message: "You have already confirmed this one." };
    }

    await PolicyReceiptModel.updateOne(
      { ...query, acknowledgedAt: null },
      { $set: { acknowledgedAt: new Date() } },
    );
    return { success: true, message: "Thank you — confirmed." };
  } catch (error) {
    console.log("Error acknowledging policy:", error);
    return fail("Could not record your confirmation");
  }
}

/**
 * Note that this person opened the version in force.
 *
 * Created with create() rather than an upsert, for the reason given on
 * stamp() in myAnnouncementServer.js: under TENANT_ENFORCEMENT=shadow an
 * upserted document would be inserted with no tenantId, while the save hook
 * stamps it in both modes. Two opens racing to create the first receipt meet
 * on the unique index, and the loser becomes an update.
 *
 * Nothing is written during a read-only support visit — the policy still
 * opens, it is just not counted as read by someone who is not the reader.
 */
async function recordOpen(policy, viewer) {
  if (await isReadOnly()) return;

  const now = new Date();
  const query = { versionId: policy.currentVersionId, employeeId: viewer.employeeId };
  const touch = () =>
    PolicyReceiptModel.updateOne(query, {
      $set: { lastOpenedAt: now },
      $inc: { openCount: 1 },
    });

  if (await PolicyReceiptModel.exists(query)) {
    await touch();
    return;
  }

  try {
    await PolicyReceiptModel.create({
      ...query,
      policyId: policy._id,
      versionNumber: policy.currentVersionNumber,
      employeeKind: viewer.kind,
      firstOpenedAt: now,
      lastOpenedAt: now,
      openCount: 1,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    await touch();
  }
}
