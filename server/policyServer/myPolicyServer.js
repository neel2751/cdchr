"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import PolicyCategoryModel from "@/models/policyCategoryModel";
import PolicyModel from "@/models/policyModel";
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
      .select("_id title summary categoryId currentVersionId currentVersionNumber currentPublishedAt")
      .sort({ title: 1 })
      .lean();
    if (!policies.length) return empty;

    const [categories, versions] = await Promise.all([
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
    ]);

    const versionOf = Object.fromEntries(versions.map((v) => [String(v._id), v]));
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
      .select("currentVersionId")
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
    return { success: true, data: JSON.stringify({ url: res.url }) };
  } catch (error) {
    console.log("Error opening policy:", error);
    return fail("Could not open the policy");
  }
}
