"use server";

import { randomUUID } from "node:crypto";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { connect } from "@/db/db";
import { logAuditDirect, recordAudit, withAudit } from "@/lib/audit";
import { getWorkingDate, toWorkingDate } from "@/lib/clockTime";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import {
  DEFAULT_POLICY_CATEGORIES,
  DEFAULT_REVIEW_INTERVAL_MONTHS,
  POLICY_FILE_TYPES,
  POLICY_MAX_BYTES,
  REVIEW_INTERVAL_OPTIONS,
  REVIEW_WARNING_DAYS,
  addMonthsToDay,
  daysBetween,
  policyNameKey,
} from "@/lib/policies";
import { featureRefusal } from "@/lib/requireFeature";
import { tenantAssetKey } from "@/lib/tenantAssets";
import { isReadOnly } from "@/lib/tenantContext";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import PolicyCategoryModel from "@/models/policyCategoryModel";
import PolicyModel from "@/models/policyModel";
import PolicyReviewModel from "@/models/policyReviewModel";
import PolicyVersionModel from "@/models/policyVersionModel";
import RoleBasedModel from "@/models/rolebasedModel";
import { countAudience, resolveAudience } from "../announcementServer/audience";
import {
  assertStorageAllows,
  noteStorageDelta,
} from "../aws/storageGuard";
import { deleteFileFromS3, generateDownloadUrl } from "../aws/upload";
import { getServerSideProps } from "../session/session";
import {
  emailPolicyReaders,
  outstandingReaders,
  policyReaderRows,
  summariseReaders,
} from "./policyReaders";

/**
 * The policy library, from the side of the people who maintain it.
 *
 * Reading policies is myPolicyServer.js, and is deliberately not gated by the
 * plan: if a company's module is switched off, its staff can still read what
 * they were already given.
 */

const MENU_PATH = "/admin/policies";

// Office staff only until site staff have a portal to read policies in. The
// audience shape can name them; sanitizeAudience() refuses to.
const AUDIENCE_MODES = ["all", "roles", "departments", "people"];
const ROLES = ["superAdmin", "admin", "user"];

const fail = (message) => ({ success: false, message });
const empty = { success: true, data: JSON.stringify([]), totalCount: 0 };

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
  },
});

/**
 * May this user maintain the policy library?
 *
 * The same two questions as announcements, in the same order: does the
 * company's plan include the module, then does this person hold the page. A
 * super admin passes every role check but must still not manage policies for
 * a company whose plan has none.
 *
 * Every export in this file goes through here — npm run audit:feature-guards
 * checks that it does.
 *
 * @returns {Promise<Object|null>} the session user, or null
 */
async function requirePolicyManager() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return null;

  if (await featureRefusal("policies")) return null;

  if (user.role === "superAdmin") return user;
  if (user.role !== "admin") return null;

  await connect();
  const role = await RoleBasedModel.findOne({
    employeeId: user._id,
    isActive: true,
    isDeleted: false,
  })
    .select("permissions")
    .lean();

  return role?.permissions?.includes(MENU_PATH) ? user : null;
}

const toOid = (value) => (isValidObjectId(value) ? createObjectId(value) : null);

const toOidList = (list) =>
  (Array.isArray(list) ? list : []).map(toOid).filter(Boolean);

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Escaped: the value comes straight from a search box. */
const searchRegex = (query) => ({
  $regex: String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  $options: "i",
});

/** Strip anything that would make a key sort outside its prefix. */
function safeFileName(name) {
  return String(name || "file")
    .replace(/[^\w.\- ]+/g, "_")
    .slice(-120);
}

/** Where every file of one policy lives. Ends in "/" so a prefix match is exact. */
function policyKeyPrefix(tenantId, policyId) {
  return `${tenantAssetKey({
    tenantId,
    category: "policies",
    parts: [String(policyId)],
  })}/`;
}

/**
 * Narrow an audience from the form to what a policy may be shown to.
 *
 * An allow-list rather than a spread, and office staff only: a site employee
 * in `people`, the site role, a site list or `includeField` are all dropped
 * here rather than stored and ignored, so what is saved is what applies.
 */
function sanitizeAudience(raw = {}) {
  const mode = AUDIENCE_MODES.includes(raw?.mode) ? raw.mode : "all";
  return {
    mode,
    roles: (Array.isArray(raw?.roles) ? raw.roles : []).filter((r) =>
      ROLES.includes(r),
    ),
    departments: toOidList(raw?.departments),
    sites: [],
    people: (Array.isArray(raw?.people) ? raw.people : [])
      .filter((p) => (p?.kind || "office") === "office")
      .map((p) => toOid(p?.employeeId ?? p))
      .filter(Boolean)
      .map((employeeId) => ({ kind: "office", employeeId })),
    includeField: false,
  };
}

function audienceProblem(audience) {
  const { mode, roles, departments, people } = audience;
  if (mode === "roles" && !roles.length) return "Choose at least one role.";
  if (mode === "departments" && !departments.length) {
    return "Choose at least one department.";
  }
  if (mode === "people" && !people.length) return "Choose at least one person.";
  return null;
}

/** The fields of a policy a manager may set, from whatever the form sent. */
function sanitizeDetails(data = {}) {
  return {
    title: String(data.title || "").trim().slice(0, 200),
    summary: String(data.summary || "").trim().slice(0, 2000),
    categoryId: toOid(data.categoryId),
    ownerId: toOid(data.ownerId),
  };
}

async function detailsProblem(details) {
  if (!details.title) return "A title is required.";
  if (!details.categoryId) return "Choose a category.";

  const category = await PolicyCategoryModel.findById(details.categoryId)
    .select("isArchived")
    .lean();
  if (!category) return "That category no longer exists.";
  if (category.isArchived) return "That category is archived.";

  if (details.ownerId) {
    const owner = await OfficeEmployeeModel.exists({
      _id: details.ownerId,
      delete: { $ne: true },
    });
    if (!owner) return "The owner must be a current member of office staff.";
  }
  return null;
}

/* ------------------------------------------------------------------------ *
 * Review dates
 * ------------------------------------------------------------------------ */

/** An interval from the form: one of the offered values, or null for none. */
function sanitizeInterval(value) {
  const n = Number(value);
  return REVIEW_INTERVAL_OPTIONS.includes(n) ? n : null;
}

/**
 * A next-review date from a form, which means one of three things:
 *   undefined     not given — the caller works one out
 *   "" or null    cleared on purpose — no review scheduled
 *   "YYYY-MM-DD"  this day
 *
 * @returns {{given: boolean, date?: Date|null, problem?: string}}
 */
function readReviewDate(value, { earliest }) {
  if (value === undefined) return { given: false };
  if (value === "" || value === null) return { given: true, date: null };
  const date = toWorkingDate(value);
  if (!date) return { given: true, problem: "That review date is not a date." };
  if (date < earliest) {
    return { given: true, problem: "Choose a later date for the next review." };
  }
  return { given: true, date };
}

/** Days from today (UK) to a policy's next review, or null when it has none. */
function daysUntilReview(policy, today = getWorkingDate()) {
  return policy?.nextReviewDate ? daysBetween(today, policy.nextReviewDate) : null;
}

/**
 * Record that a policy has been reviewed and set when it is next due.
 *
 * Shared by "mark as reviewed" and by publishing, because publishing a new
 * version is a review: whoever did it has read the policy and decided what it
 * should say. Either way the reminders already sent belong to the old due
 * date and are cleared, so the new one gets its own.
 *
 * `nextReviewDate` undefined means "work it out": the interval from today,
 * or — with no interval — the date already set, left alone.
 */
async function recordReview({ policy, user, outcome, versionNumber = null, note = "", nextReviewDate }) {
  const today = getWorkingDate();
  const next =
    nextReviewDate !== undefined
      ? nextReviewDate
      : policy.reviewIntervalMonths
        ? addMonthsToDay(today, policy.reviewIntervalMonths)
        : policy.nextReviewDate || null;
  const dateChanged = String(next || "") !== String(policy.nextReviewDate || "");
  const reviewedByName = user.name || user.email;

  await PolicyReviewModel.create({
    policyId: policy._id,
    outcome,
    versionNumber,
    note,
    dueDate: policy.nextReviewDate || null,
    nextReviewDate: next,
    reviewedAt: new Date(),
    reviewedBy: toOid(user._id),
    reviewedByName,
  });

  await PolicyModel.updateOne(
    { _id: policy._id },
    {
      nextReviewDate: next,
      lastReviewedAt: new Date(),
      lastReviewedByName: reviewedByName,
      ...(dateChanged ? { reviewRemindersSent: [] } : {}),
    },
  );

  return next;
}

/* ------------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------------ */

/**
 * Give a company its starting shelves, once.
 *
 * Runs on the first visit to the library rather than at sign-up, so it covers
 * every company that existed before the module did. "Once" means the company
 * has no categories at all — archived ones count — so archiving every default
 * does not bring them back on the next page load.
 *
 * Two people opening the library at the same moment both see an empty company;
 * the unique (tenantId, nameKey) index turns the second insert into duplicate
 * errors, which are the expected outcome and are ignored.
 */
async function ensureDefaultCategories(user) {
  if (await PolicyCategoryModel.exists({})) return;
  // A support visit is read-only. The shelves appear when the company itself
  // next opens the library.
  if (await isReadOnly()) return;

  try {
    await PolicyCategoryModel.insertMany(
      DEFAULT_POLICY_CATEGORIES.map((category, index) => ({
        ...category,
        nameKey: policyNameKey(category.name),
        sortOrder: index,
        isDefault: true,
        createdBy: toOid(user?._id),
      })),
      { ordered: false },
    );
  } catch (error) {
    if (error?.code !== 11000 && !error?.writeErrors) throw error;
  }
}

/** The shelves, with how many live policies sit on each. */
export async function getPolicyCategories() {
  try {
    const user = await requirePolicyManager();
    if (!user) return empty;

    await connect();
    await ensureDefaultCategories(user);

    const [categories, counts] = await Promise.all([
      PolicyCategoryModel.find({})
        .sort({ isArchived: 1, sortOrder: 1, name: 1 })
        .lean(),
      PolicyModel.aggregate([
        { $match: { isDeleted: false, status: { $ne: "archived" } } },
        { $group: { _id: "$categoryId", n: { $sum: 1 } } },
      ]),
    ]);

    const countOf = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));

    return {
      success: true,
      data: JSON.stringify(
        categories.map((c) => ({ ...c, policyCount: countOf[String(c._id)] || 0 })),
      ),
    };
  } catch (error) {
    console.log("Error listing policy categories:", error);
    return empty;
  }
}

/**
 * Add a category, or rename one when `data.id` is given.
 *
 * Adding a name that matches an archived category restores that category
 * instead — its policies come back with it, which is what somebody re-adding
 * "Fire Safety" almost certainly wants.
 */
export const savePolicyCategory = withAudit(
  "Policy.saveCategory",
  async (data = {}) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");

      const name = String(data.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const description = String(data.description || "").trim().slice(0, 300);
      if (!name) return fail("A category name is required.");
      const nameKey = policyNameKey(name);

      await connect();
      const clash = await PolicyCategoryModel.findOne({ nameKey }).lean();

      if (data.id) {
        if (!isValidObjectId(data.id)) return fail("Invalid category");
        const before = await PolicyCategoryModel.findById(data.id).lean();
        if (!before) return fail("Category not found");
        if (clash && String(clash._id) !== String(before._id)) {
          return fail(`There is already a category called "${clash.name}".`);
        }

        const after = await PolicyCategoryModel.findByIdAndUpdate(
          before._id,
          { name, nameKey, description },
          { new: true },
        ).lean();

        recordAudit({
          entityId: before._id,
          before,
          after,
          description: `Updated policy category "${name}"`,
        });
        return { success: true, message: "Category updated" };
      }

      if (clash && !clash.isArchived) {
        return fail(`There is already a category called "${clash.name}".`);
      }

      if (clash) {
        const after = await PolicyCategoryModel.findByIdAndUpdate(
          clash._id,
          { isArchived: false, name, ...(description ? { description } : {}) },
          { new: true },
        ).lean();
        recordAudit({
          entityId: clash._id,
          before: clash,
          after,
          description: `Restored archived policy category "${name}"`,
        });
        return {
          success: true,
          message: `"${name}" was archived and has been restored`,
          data: JSON.stringify({ _id: clash._id }),
        };
      }

      const last = await PolicyCategoryModel.findOne({})
        .sort({ sortOrder: -1 })
        .select("sortOrder")
        .lean();

      const category = await PolicyCategoryModel.create({
        name,
        nameKey,
        description,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdBy: toOid(user._id),
      });

      recordAudit({
        entityId: category._id,
        after: category.toObject(),
        description: `Added policy category "${name}"`,
      });

      return {
        success: true,
        message: "Category added",
        data: JSON.stringify({ _id: category._id }),
      };
    } catch (error) {
      console.log("Error saving policy category:", error);
      return fail("Could not save the category");
    }
  },
  { module: "Policy" },
);

/**
 * Archive or restore a category.
 *
 * A category still holding live policies cannot be archived: it would take
 * them off the shelf while leaving them visible to employees, under a heading
 * the managers can no longer see. Move or archive them first.
 */
export const setPolicyCategoryArchived = withAudit(
  "Policy.archiveCategory",
  async (id, archived) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid category");

      await connect();
      const before = await PolicyCategoryModel.findById(id).lean();
      if (!before) return fail("Category not found");

      if (archived) {
        const live = await PolicyModel.countDocuments({
          categoryId: before._id,
          isDeleted: false,
          status: { $ne: "archived" },
        });
        if (live) {
          return fail(
            `"${before.name}" still has ${live} ${live === 1 ? "policy" : "policies"}. Move or archive ${live === 1 ? "it" : "them"} first.`,
          );
        }
      }

      const after = await PolicyCategoryModel.findByIdAndUpdate(
        before._id,
        { isArchived: !!archived },
        { new: true },
      ).lean();

      recordAudit({
        entityId: before._id,
        before,
        after,
        description: `${archived ? "Archived" : "Restored"} policy category "${before.name}"`,
      });

      return {
        success: true,
        message: archived ? "Category archived" : "Category restored",
      };
    } catch (error) {
      console.log("Error archiving policy category:", error);
      return fail("Could not update the category");
    }
  },
  { module: "Policy" },
);

/* ------------------------------------------------------------------------ *
 * Policies
 * ------------------------------------------------------------------------ */

/** Office staff names for a set of ids, as { id: name }. */
async function namesFor(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return {};
  const people = await OfficeEmployeeModel.find({ _id: { $in: unique } })
    .select("_id name")
    .lean();
  return Object.fromEntries(people.map((p) => [String(p._id), p.name]));
}

/** The library: policies, filtered and paged, with what the table shows. */
export async function getPolicies(filterData = {}) {
  try {
    const user = await requirePolicyManager();
    if (!user) return empty;

    const page = Math.max(parseInt(filterData?.page) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(filterData?.pageSize) || 10, 1),
      100,
    );

    await connect();

    // Category and search narrow everything, the status tabs' counts included;
    // the status is what the tabs choose between.
    const scope = { isDeleted: false };
    if (isValidObjectId(filterData?.categoryId)) {
      scope.categoryId = createObjectId(filterData.categoryId);
    }
    if (filterData?.query) scope.title = searchRegex(filterData.query);

    const filter = { ...scope };
    if (["draft", "active", "archived"].includes(filterData?.status)) {
      filter.status = filterData.status;
    } else {
      // Archived policies are history. They stay out of the default view and
      // are one filter away.
      filter.status = { $ne: "archived" };
    }

    const today = getWorkingDate();
    // "Needs review": published policies due within the warning window or
    // already overdue — the same set the reminders go out for.
    const dueForReview = {
      status: "active",
      nextReviewDate: {
        $ne: null,
        $lte: new Date(today.getTime() + REVIEW_WARNING_DAYS * 86400000),
      },
    };
    if (filterData?.review === "due") Object.assign(filter, dueForReview);

    const [rows, totalCount, byStatus, dueCount] = await Promise.all([
      PolicyModel.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      PolicyModel.countDocuments(filter),
      PolicyModel.aggregate([
        { $match: scope },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]),
      PolicyModel.countDocuments({ ...scope, ...dueForReview }),
    ]);
    const statusCount = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
    const counts = {
      current: (statusCount.draft || 0) + (statusCount.active || 0),
      review: dueCount,
      draft: statusCount.draft || 0,
      active: statusCount.active || 0,
      archived: statusCount.archived || 0,
    };

    const [categories, owners, withDraft] = await Promise.all([
      PolicyCategoryModel.find({
        _id: { $in: rows.map((r) => r.categoryId) },
      })
        .select("_id name")
        .lean(),
      namesFor(rows.map((r) => r.ownerId)),
      PolicyVersionModel.distinct("policyId", {
        policyId: { $in: rows.map((r) => r._id) },
        status: "draft",
        isDeleted: false,
      }),
    ]);

    const categoryName = Object.fromEntries(
      categories.map((c) => [String(c._id), c.name]),
    );
    const drafted = new Set(withDraft.map(String));

    // How far staff have got with each visible policy. One audience
    // resolution per row; a page is at most 100 rows and usually 10.
    const readers = Object.fromEntries(
      await Promise.all(
        rows
          .filter((r) => r.visibleToEmployees && r.status === "active")
          .map(async (r) => [String(r._id), summariseReaders(await policyReaderRows(r))]),
      ),
    );

    return {
      success: true,
      data: JSON.stringify(
        rows.map(({ reviewRemindersSent, ...r }) => ({
          ...r,
          categoryName: categoryName[String(r.categoryId)] || "Unknown",
          ownerName: r.ownerId ? owners[String(r.ownerId)] || "Former staff" : "",
          hasDraft: drafted.has(String(r._id)),
          // Counted here, against the UK day, so the browser's own clock and
          // timezone cannot disagree with the reminders about what is overdue.
          daysUntilReview: daysUntilReview(r, today),
          readers: readers[String(r._id)] || null,
        })),
      ),
      totalCount,
      counts,
    };
  } catch (error) {
    console.log("Error listing policies:", error);
    return empty;
  }
}

/** One policy with its whole version history, for the detail page. */
export async function getPolicyById(id) {
  try {
    const user = await requirePolicyManager();
    if (!user) return fail("Not authorized");
    if (!isValidObjectId(id)) return fail("Invalid policy");

    await connect();
    const policy = await PolicyModel.findOne({ _id: id, isDeleted: false }).lean();
    if (!policy) return fail("Policy not found");

    const [category, versions, owners, reviews] = await Promise.all([
      PolicyCategoryModel.findById(policy.categoryId).select("_id name").lean(),
      PolicyVersionModel.find({ policyId: policy._id, isDeleted: false })
        .sort({ createdAt: -1 })
        .lean(),
      namesFor([policy.ownerId]),
      PolicyReviewModel.find({ policyId: policy._id })
        .sort({ reviewedAt: -1 })
        .limit(50)
        .lean(),
    ]);

    // Drafts first, then newest published. Sorting on createdAt alone puts a
    // draft uploaded before a later publish below it, out of sight.
    versions.sort((a, b) => {
      if ((a.status === "draft") !== (b.status === "draft")) {
        return a.status === "draft" ? -1 : 1;
      }
      return (b.versionNumber || 0) - (a.versionNumber || 0);
    });

    return {
      success: true,
      data: JSON.stringify({
        ...policy,
        categoryName: category?.name || "Unknown",
        ownerName: policy.ownerId
          ? owners[String(policy.ownerId)] || "Former staff"
          : "",
        audienceCount: policy.visibleToEmployees
          ? await countAudience(policy.audience)
          : 0,
        daysUntilReview: daysUntilReview(policy),
        reviews,
        // The key is how the file is fetched, and the manager screens open
        // files through getPolicyVersionFileUrl by version id instead.
        versions: versions.map(({ file, ...v }) => ({
          ...v,
          file: { fileName: file.fileName, fileType: file.fileType, fileSize: file.fileSize },
        })),
      }),
    };
  } catch (error) {
    console.log("Error loading policy:", error);
    return fail("Could not load the policy");
  }
}

export const createPolicy = withAudit(
  "Policy.create",
  async (data) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");

      await connect();
      const details = sanitizeDetails(data);
      const problem = await detailsProblem(details);
      if (problem) return fail(problem);

      // Reviewed yearly unless the form says otherwise. No date yet: the
      // clock starts when the first version is published.
      const policy = await PolicyModel.create({
        ...details,
        reviewIntervalMonths:
          data?.reviewIntervalMonths === undefined
            ? DEFAULT_REVIEW_INTERVAL_MONTHS
            : sanitizeInterval(data.reviewIntervalMonths),
        status: "draft",
        visibleToEmployees: false,
        createdBy: toOid(user._id),
        createdByName: user.name || user.email,
      });

      recordAudit({
        entityId: policy._id,
        after: policy.toObject(),
        description: `Created policy "${details.title}"`,
      });

      return {
        success: true,
        message: "Policy created. Upload its first version next.",
        data: JSON.stringify({ _id: policy._id }),
      };
    } catch (error) {
      console.log("Error creating policy:", error);
      return fail("Could not create the policy");
    }
  },
  { module: "Policy" },
);

export const updatePolicyDetails = withAudit(
  "Policy.update",
  async (id, data) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid policy");

      await connect();
      const before = await PolicyModel.findOne({ _id: id, isDeleted: false }).lean();
      if (!before) return fail("Policy not found");

      const details = sanitizeDetails(data);
      const problem = await detailsProblem(details);
      if (problem) return fail(problem);

      const after = await PolicyModel.findByIdAndUpdate(
        before._id,
        { ...details, updatedBy: toOid(user._id) },
        { new: true },
      ).lean();

      recordAudit({
        entityId: before._id,
        before,
        after,
        description: `Updated policy "${details.title}"`,
      });

      return { success: true, message: "Policy updated" };
    } catch (error) {
      console.log("Error updating policy:", error);
      return fail("Could not update the policy");
    }
  },
  { module: "Policy" },
);

/**
 * Who may read a policy.
 *
 * Its own action, separate from the details, so the audit log says plainly
 * when a policy was shown to staff and to whom — the change a manager is
 * most likely to be asked about later.
 *
 * Refuses to show a policy with nothing published (there would be nothing to
 * read) or to an audience that currently contains nobody (a switch that says
 * "visible" while nobody can see it is worse than one that says "hidden").
 */
export const setPolicyVisibility = withAudit(
  "Policy.visibility",
  async (id, data = {}) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid policy");

      await connect();
      const before = await PolicyModel.findOne({ _id: id, isDeleted: false }).lean();
      if (!before) return fail("Policy not found");

      const visibleToEmployees = !!data.visibleToEmployees;
      // Left as it was when the form does not mention it.
      const requireAck =
        data.requireAck === undefined ? !!before.requireAck : !!data.requireAck;
      const audience = sanitizeAudience(data.audience);
      const problem = audienceProblem(audience);
      if (problem) return fail(problem);

      let count = 0;
      if (visibleToEmployees) {
        if (before.status === "archived") {
          return fail("Restore this policy before showing it to staff.");
        }
        if (!before.currentVersionId) {
          return fail("Publish a version first — there is nothing for staff to read yet.");
        }
        count = await countAudience(audience);
        if (!count) return fail("That audience currently includes nobody.");
      }

      const after = await PolicyModel.findByIdAndUpdate(
        before._id,
        { visibleToEmployees, audience, requireAck, updatedBy: toOid(user._id) },
        { new: true },
      ).lean();

      recordAudit({
        entityId: before._id,
        before,
        after,
        description: visibleToEmployees
          ? `Showed policy "${before.title}" to ${count} ${count === 1 ? "person" : "people"}${requireAck ? ", asking each to confirm they have read it" : ""}`
          : `Hid policy "${before.title}" from staff`,
      });

      return {
        success: true,
        message: visibleToEmployees
          ? `Visible to ${count} ${count === 1 ? "person" : "people"}`
          : "Hidden from staff",
      };
    } catch (error) {
      console.log("Error setting policy visibility:", error);
      return fail("Could not update who can see this policy");
    }
  },
  { module: "Policy" },
);

/** How many people an unsaved audience covers, with a few names. */
export async function previewPolicyAudience(data) {
  const none = { success: true, data: JSON.stringify({ count: 0, sample: [] }) };
  try {
    const user = await requirePolicyManager();
    if (!user) return none;

    await connect();
    const people = await resolveAudience(sanitizeAudience(data?.audience));
    return {
      success: true,
      data: JSON.stringify({
        count: people.length,
        sample: people.slice(0, 5).map((p) => p.name).filter(Boolean),
      }),
    };
  } catch (error) {
    console.log("Error previewing policy audience:", error);
    return none;
  }
}

/**
 * Archive or restore a policy.
 *
 * Archiving is the normal end of a policy's life: it leaves the library and
 * every employee's list, and keeps its whole history. It also turns visibility
 * off, so restoring one never silently re-publishes it to staff.
 */
export const setPolicyArchived = withAudit(
  "Policy.archive",
  async (id, archived) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid policy");

      await connect();
      const before = await PolicyModel.findOne({ _id: id, isDeleted: false }).lean();
      if (!before) return fail("Policy not found");

      if (!archived) {
        const category = await PolicyCategoryModel.findById(before.categoryId)
          .select("isArchived name")
          .lean();
        if (category?.isArchived) {
          return fail(`Restore the "${category.name}" category first.`);
        }
      }

      const after = await PolicyModel.findByIdAndUpdate(
        before._id,
        archived
          ? { status: "archived", visibleToEmployees: false, updatedBy: toOid(user._id) }
          : {
              status: before.currentVersionId ? "active" : "draft",
              updatedBy: toOid(user._id),
            },
        { new: true },
      ).lean();

      recordAudit({
        entityId: before._id,
        before,
        after,
        description: `${archived ? "Archived" : "Restored"} policy "${before.title}"`,
      });

      return {
        success: true,
        message: archived
          ? "Policy archived"
          : "Policy restored. It is hidden from staff until you show it again.",
      };
    } catch (error) {
      console.log("Error archiving policy:", error);
      return fail("Could not update the policy");
    }
  },
  { module: "Policy" },
);

/**
 * Delete a policy — only one that was never published.
 *
 * Deletion is for mistakes. A policy that was ever in force has a history
 * somebody may need to produce, so it is archived instead.
 */
export const deletePolicy = withAudit(
  "Policy.delete",
  async (id) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid policy");

      await connect();
      const before = await PolicyModel.findOne({ _id: id, isDeleted: false }).lean();
      if (!before) return fail("Policy not found");

      const published = await PolicyVersionModel.exists({
        policyId: before._id,
        status: { $in: ["published", "superseded"] },
      });
      if (published || before.currentVersionId) {
        return fail("This policy has been published. Archive it instead, so its history is kept.");
      }

      const drafts = await PolicyVersionModel.find({
        policyId: before._id,
        isDeleted: false,
      })
        .select("file.key")
        .lean();
      for (const draft of drafts) {
        await deleteFileFromS3(draft.file.key);
      }
      await PolicyVersionModel.updateMany(
        { policyId: before._id },
        { isDeleted: true },
      );
      await PolicyModel.findByIdAndUpdate(before._id, {
        isDeleted: true,
        updatedBy: toOid(user._id),
      });

      recordAudit({
        entityId: before._id,
        before,
        description: `Deleted unpublished policy "${before.title}"`,
      });

      return { success: true, message: "Policy deleted" };
    } catch (error) {
      console.log("Error deleting policy:", error);
      return fail("Could not delete the policy");
    }
  },
  { module: "Policy" },
);

/* ------------------------------------------------------------------------ *
 * Versions
 *
 * Upload is three steps, because the file does not pass through this server:
 *
 *   1. startPolicyUpload   checks everything that can be checked before the
 *                          bytes exist, and signs a PUT for one exact key
 *   2. the browser PUTs the file straight to storage
 *   3. addPolicyVersion    checks the object really is there, under this
 *                          policy, at an allowed type and size, and records it
 *
 * Server actions accept at most 1 MB, and a policy handbook is often more.
 * ------------------------------------------------------------------------ */

/** The draft a policy already has, if any. One at a time — see addPolicyVersion. */
function findDraft(policyId) {
  return PolicyVersionModel.findOne({
    policyId,
    status: "draft",
    isDeleted: false,
  })
    .select("_id")
    .lean();
}

export async function startPolicyUpload(data = {}) {
  try {
    const user = await requirePolicyManager();
    if (!user) return fail("Not authorized");
    if (!user.tenantId) return fail("No company in context");
    if (await isReadOnly()) return fail("This session is read-only.");
    if (!isValidObjectId(data.policyId)) return fail("Invalid policy");

    const contentType = String(data.contentType || "");
    const fileSize = Number(data.fileSize) || 0;
    if (!POLICY_FILE_TYPES[contentType]) {
      return fail("Upload a PDF, a Word document or an image.");
    }
    if (fileSize <= 0) return fail("That file is empty.");
    if (fileSize > POLICY_MAX_BYTES) {
      return fail(`Policy files are limited to ${POLICY_MAX_BYTES / (1024 * 1024)} MB.`);
    }

    await connect();
    const policy = await PolicyModel.findOne({
      _id: data.policyId,
      isDeleted: false,
    })
      .select("_id status")
      .lean();
    if (!policy) return fail("Policy not found");
    if (policy.status === "archived") return fail("Restore this policy first.");
    if (await findDraft(policy._id)) {
      return fail("This policy already has a draft. Publish or delete it first.");
    }

    const room = await assertStorageAllows(user.tenantId, fileSize);
    if (!room.allowed) return fail(room.message);

    // The random part is what keeps the key unguessable. Policy files are
    // only ever handed out as short-lived signed links after a visibility
    // check, and a guessable key would be one way round it.
    const key = `${policyKeyPrefix(user.tenantId, policy._id)}${randomUUID()}-${safeFileName(data.fileName)}`;

    // Content type and length are part of the signature, so the PUT must send
    // exactly the file that was checked above.
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
        ContentLength: fileSize,
      }),
      { expiresIn: 600 },
    );

    noteStorageDelta(user.tenantId, fileSize);

    return { success: true, data: JSON.stringify({ url, key }) };
  } catch (error) {
    console.log("Error starting policy upload:", error);
    return fail("Could not start the upload");
  }
}

/**
 * Record an uploaded file as the policy's draft.
 *
 * Nothing the browser says about the file is believed: the key must sit under
 * this policy's prefix in this company, and the type and size are read back
 * from storage. A change note is required from the second version on, because
 * "what changed?" is the first thing anybody asks of a new version and the
 * uploader is the only person who knows.
 */
export const addPolicyVersion = withAudit(
  "Policy.uploadVersion",
  async (data = {}) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!user.tenantId) return fail("No company in context");
      if (!isValidObjectId(data.policyId)) return fail("Invalid policy");

      await connect();
      const policy = await PolicyModel.findOne({
        _id: data.policyId,
        isDeleted: false,
      }).lean();
      if (!policy) return fail("Policy not found");
      if (policy.status === "archived") return fail("Restore this policy first.");

      const key = String(data.key || "");
      if (!key.startsWith(policyKeyPrefix(user.tenantId, policy._id))) {
        return fail("That file does not belong to this policy.");
      }

      const changeNote = String(data.changeNote || "").trim().slice(0, 2000);
      if (policy.currentVersionNumber > 0 && !changeNote) {
        return fail("Say what changed in this version.");
      }

      if (await findDraft(policy._id)) {
        return fail("This policy already has a draft. Publish or delete it first.");
      }

      let head;
      try {
        head = await s3.send(
          new HeadObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key }),
        );
      } catch {
        return fail("The upload did not arrive. Try again.");
      }

      const fileType = head.ContentType || "";
      const fileSize = Number(head.ContentLength) || 0;
      if (!POLICY_FILE_TYPES[fileType] || fileSize > POLICY_MAX_BYTES) {
        await deleteFileFromS3(key);
        return fail("That file is not a type or size a policy can be.");
      }

      const version = await PolicyVersionModel.create({
        policyId: policy._id,
        status: "draft",
        file: {
          key,
          fileName: safeFileName(data.fileName),
          fileType,
          fileSize,
        },
        changeNote,
        effectiveDate: toDate(data.effectiveDate),
        uploadedBy: toOid(user._id),
        uploadedByName: user.name || user.email,
      });

      recordAudit({
        entityId: policy._id,
        after: version.toObject(),
        description: `Uploaded a draft of policy "${policy.title}" (${version.file.fileName})`,
      });

      return {
        success: true,
        message: "Draft uploaded. Publish it when it is ready.",
        data: JSON.stringify({ _id: version._id }),
      };
    } catch (error) {
      console.log("Error adding policy version:", error);
      return fail("Could not save the upload");
    }
  },
  { module: "Policy" },
);

/**
 * Make a draft the version in force.
 *
 * It takes the next number, the version it replaces becomes superseded, and
 * the policy points at it — in that order, so the unique version number is
 * claimed before anything else changes. If two publishes race, the loser
 * fails on that index with nothing half-done.
 *
 * Publishing does not change who can see the policy. A policy already shown
 * to staff shows them the new version straight away; a hidden one stays
 * hidden until somebody chooses its audience.
 */
export const publishPolicyVersion = withAudit(
  "Policy.publishVersion",
  async (versionId) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(versionId)) return fail("Invalid version");

      await connect();
      const version = await PolicyVersionModel.findOne({
        _id: versionId,
        isDeleted: false,
      }).lean();
      if (!version) return fail("Version not found");
      if (version.status !== "draft") return fail("This version is already published.");

      const before = await PolicyModel.findOne({
        _id: version.policyId,
        isDeleted: false,
      }).lean();
      if (!before) return fail("Policy not found");
      if (before.status === "archived") return fail("Restore this policy first.");

      const latest = await PolicyVersionModel.findOne({
        policyId: before._id,
        versionNumber: { $type: "number" },
      })
        .sort({ versionNumber: -1 })
        .select("versionNumber")
        .lean();
      const versionNumber = (latest?.versionNumber || 0) + 1;
      const now = new Date();

      try {
        await PolicyVersionModel.updateOne(
          { _id: version._id, status: "draft" },
          {
            status: "published",
            versionNumber,
            publishedAt: now,
            publishedBy: toOid(user._id),
            publishedByName: user.name || user.email,
          },
        );
      } catch (error) {
        if (error?.code === 11000) {
          return fail("Someone else published a version just now. Reload and try again.");
        }
        throw error;
      }

      await PolicyVersionModel.updateMany(
        { policyId: before._id, status: "published", _id: { $ne: version._id } },
        { status: "superseded" },
      );

      const after = await PolicyModel.findByIdAndUpdate(
        before._id,
        {
          currentVersionId: version._id,
          currentVersionNumber: versionNumber,
          currentPublishedAt: now,
          status: "active",
          updatedBy: toOid(user._id),
        },
        { new: true },
      ).lean();

      // A new version is a review: it restarts the clock.
      const nextReviewDate = await recordReview({
        policy: after,
        user,
        outcome: "new-version",
        versionNumber,
        note: version.changeNote || "",
      });

      recordAudit({
        entityId: before._id,
        before,
        after: { ...after, nextReviewDate },
        description: `Published version ${versionNumber} of policy "${before.title}"`,
      });

      return {
        success: true,
        message: before.visibleToEmployees
          ? `Version ${versionNumber} is now in force and visible to staff.`
          : `Version ${versionNumber} is now in force. Staff cannot see it until you choose who can.`,
      };
    } catch (error) {
      console.log("Error publishing policy version:", error);
      return fail("Could not publish the version");
    }
  },
  { module: "Policy" },
);

/** Throw away a draft. Published versions are history and cannot be deleted. */
export const deletePolicyDraft = withAudit(
  "Policy.deleteDraft",
  async (versionId) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(versionId)) return fail("Invalid version");

      await connect();
      const version = await PolicyVersionModel.findOne({
        _id: versionId,
        isDeleted: false,
      }).lean();
      if (!version) return fail("Version not found");
      if (version.status !== "draft") {
        return fail("Published versions are kept as history and cannot be deleted.");
      }

      await PolicyVersionModel.updateOne({ _id: version._id }, { isDeleted: true });
      await deleteFileFromS3(version.file.key);

      recordAudit({
        entityId: version.policyId,
        before: version,
        description: `Deleted a draft (${version.file.fileName})`,
      });

      return { success: true, message: "Draft deleted" };
    } catch (error) {
      console.log("Error deleting policy draft:", error);
      return fail("Could not delete the draft");
    }
  },
  { module: "Policy" },
);

/** A short-lived link to any version's file, for the people who manage it. */
export async function getPolicyVersionFileUrl(versionId) {
  try {
    const user = await requirePolicyManager();
    if (!user) return fail("Not authorized");
    if (!isValidObjectId(versionId)) return fail("Invalid version");

    await connect();
    const version = await PolicyVersionModel.findOne({
      _id: versionId,
      isDeleted: false,
    })
      .select("file.key")
      .lean();
    if (!version) return fail("Version not found");

    const res = await generateDownloadUrl({ key: version.file.key, expiresIn: 300 });
    if (!res?.success) return fail("Could not open the file");
    return { success: true, data: JSON.stringify({ url: res.url }) };
  } catch (error) {
    console.log("Error opening policy file:", error);
    return fail("Could not open the file");
  }
}

/* ------------------------------------------------------------------------ *
 * Reviews
 * ------------------------------------------------------------------------ */

/**
 * "I have read it and it is still right."
 *
 * The other way to review a policy is to publish a new version, which records
 * a review by itself. Only a published policy can be reviewed: there is
 * nothing in force to sign off otherwise.
 *
 * The next review is the date given, or the policy's interval from today.
 * With no interval and no date, nothing further is scheduled — said so in the
 * reply, so it is a choice rather than an accident.
 */
export const markPolicyReviewed = withAudit(
  "Policy.review",
  async (id, data = {}) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid policy");

      await connect();
      const before = await PolicyModel.findOne({ _id: id, isDeleted: false }).lean();
      if (!before) return fail("Policy not found");
      if (before.status !== "active") {
        return fail("Only a published policy can be reviewed.");
      }

      // Not given: the interval from today, or nothing without one.
      const tomorrow = new Date(getWorkingDate().getTime() + 86400000);
      const asked = readReviewDate(data.nextReviewDate, { earliest: tomorrow });
      if (asked.problem) return fail(asked.problem);
      const nextReviewDate = asked.given
        ? asked.date
        : before.reviewIntervalMonths
          ? undefined
          : null;

      const next = await recordReview({
        policy: before,
        user,
        outcome: "no-change",
        note: String(data.note || "").trim().slice(0, 2000),
        nextReviewDate,
      });

      recordAudit({
        entityId: before._id,
        before,
        after: { ...before, nextReviewDate: next, lastReviewedAt: new Date() },
        description: `Reviewed policy "${before.title}" with no changes`,
      });

      return {
        success: true,
        message: next
          ? `Marked as reviewed. Next review ${next.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.`
          : "Marked as reviewed. No further review is scheduled.",
      };
    } catch (error) {
      console.log("Error reviewing policy:", error);
      return fail("Could not record the review");
    }
  },
  { module: "Policy" },
);

/**
 * How often a policy is reviewed, and when it is next due.
 *
 * Without an explicit date, the next review is worked out from the interval
 * and the last time it was reviewed — or published, for one never reviewed
 * since. That can land in the past, which is the truth: a yearly policy last
 * looked at two years ago is overdue, and saying otherwise would be the
 * schedule hiding it. A policy not yet published gets no date; its clock
 * starts when it is.
 */
export const updatePolicyReviewSchedule = withAudit(
  "Policy.reviewSchedule",
  async (id, data = {}) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid policy");

      await connect();
      const before = await PolicyModel.findOne({ _id: id, isDeleted: false }).lean();
      if (!before) return fail("Policy not found");

      const reviewIntervalMonths = sanitizeInterval(data.intervalMonths);

      // Not given: worked out from the interval, or — with no interval — the
      // date already set is kept. Switching off the regular review should not
      // quietly cancel the one already booked.
      const asked = readReviewDate(data.nextReviewDate, { earliest: getWorkingDate() });
      if (asked.problem) return fail(asked.problem);

      let nextReviewDate = before.nextReviewDate || null;
      if (asked.given) {
        nextReviewDate = asked.date;
      } else if (reviewIntervalMonths) {
        const since = before.lastReviewedAt || before.currentPublishedAt;
        nextReviewDate = since
          ? addMonthsToDay(getWorkingDate(since), reviewIntervalMonths)
          : null;
      }

      const dateChanged =
        String(nextReviewDate || "") !== String(before.nextReviewDate || "");

      const after = await PolicyModel.findByIdAndUpdate(
        before._id,
        {
          reviewIntervalMonths,
          nextReviewDate,
          ...(dateChanged ? { reviewRemindersSent: [] } : {}),
          updatedBy: toOid(user._id),
        },
        { new: true },
      ).lean();

      recordAudit({
        entityId: before._id,
        before,
        after,
        description: `Changed the review schedule of policy "${before.title}"`,
      });

      return { success: true, message: "Review schedule saved" };
    } catch (error) {
      console.log("Error saving policy review schedule:", error);
      return fail("Could not save the review schedule");
    }
  },
  { module: "Policy" },
);

/**
 * Policies due for review within the warning window, or overdue — for the
 * dashboard. Empty for anyone who does not manage policies, so the card
 * simply does not appear for them.
 */
export async function getPolicyReviewsDue() {
  const none = { success: true, data: JSON.stringify({ total: 0, policies: [] }) };
  try {
    const user = await requirePolicyManager();
    if (!user) return none;

    await connect();
    const today = getWorkingDate();
    const filter = {
      isDeleted: false,
      status: "active",
      nextReviewDate: {
        $ne: null,
        $lte: new Date(today.getTime() + REVIEW_WARNING_DAYS * 86400000),
      },
    };

    const [rows, total] = await Promise.all([
      PolicyModel.find(filter)
        .sort({ nextReviewDate: 1 })
        .limit(5)
        .select("_id title nextReviewDate ownerId")
        .lean(),
      PolicyModel.countDocuments(filter),
    ]);
    const owners = await namesFor(rows.map((r) => r.ownerId));

    return {
      success: true,
      data: JSON.stringify({
        total,
        policies: rows.map((r) => ({
          _id: r._id,
          title: r.title,
          nextReviewDate: r.nextReviewDate,
          daysUntilReview: daysUntilReview(r, today),
          ownerName: r.ownerId ? owners[String(r.ownerId)] || "" : "",
        })),
      }),
    };
  } catch (error) {
    console.log("Error listing policy reviews due:", error);
    return none;
  }
}

/* ------------------------------------------------------------------------ *
 * Readers
 * ------------------------------------------------------------------------ */

// One round of "please read this" email per policy per day. Enough to chase
// people; not enough to become the thing they filter to junk.
const NOTIFY_COOLDOWN_MS = 20 * 60 * 60 * 1000;

/**
 * Who this policy is for, and where each of them has got to with the version
 * in force. Empty, with `visible: false`, while staff cannot see it.
 */
export async function getPolicyReaders(id) {
  try {
    const user = await requirePolicyManager();
    if (!user) return fail("Not authorized");
    if (!isValidObjectId(id)) return fail("Invalid policy");

    await connect();
    const policy = await PolicyModel.findOne({ _id: id, isDeleted: false }).lean();
    if (!policy) return fail("Policy not found");

    const visible = policy.visibleToEmployees && policy.status === "active";
    const rows = visible ? await policyReaderRows(policy) : [];

    return {
      success: true,
      data: JSON.stringify({
        visible,
        requireAck: !!policy.requireAck,
        versionNumber: policy.currentVersionNumber,
        lastNotifiedAt: policy.lastNotifiedAt,
        // Decided here, where notifyPolicyReaders enforces it, so the button
        // and the action cannot disagree.
        notifyCoolingDown:
          !!policy.lastNotifiedAt &&
          Date.now() - new Date(policy.lastNotifiedAt).getTime() < NOTIFY_COOLDOWN_MS,
        summary: summariseReaders(rows),
        outstanding: outstandingReaders(policy, rows).length,
        rows,
      }),
    };
  } catch (error) {
    console.log("Error listing policy readers:", error);
    return fail("Could not load who has read this policy");
  }
}

/**
 * Email everyone who still has something to do with this policy: confirm it,
 * if it asks for that, or else open it.
 *
 * Once a day at most, claimed before sending — a double click, or two
 * managers at once, sends one round. The sending carries on after this
 * returns, in batches, the same as announcement email: a few hundred people
 * take a while, and nobody should watch a spinner for it. The outcome goes
 * to the audit log.
 */
export const notifyPolicyReaders = withAudit(
  "Policy.notifyReaders",
  async (id) => {
    try {
      const user = await requirePolicyManager();
      if (!user) return fail("Not authorized");
      if (!user.tenantId) return fail("No company in context");
      if (!isValidObjectId(id)) return fail("Invalid policy");

      await connect();
      const policy = await PolicyModel.findOne({ _id: id, isDeleted: false }).lean();
      if (!policy) return fail("Policy not found");
      if (!policy.visibleToEmployees || policy.status !== "active") {
        return fail("Staff cannot see this policy yet, so there is nothing to ask them to read.");
      }

      const outstanding = outstandingReaders(policy, await policyReaderRows(policy));
      if (!outstanding.length) {
        return fail(
          policy.requireAck
            ? "Everyone has already confirmed they have read it."
            : "Everyone has already opened it.",
        );
      }

      const since = new Date(Date.now() - NOTIFY_COOLDOWN_MS);
      const claim = await PolicyModel.updateOne(
        {
          _id: policy._id,
          $or: [{ lastNotifiedAt: null }, { lastNotifiedAt: { $lt: since } }],
        },
        { lastNotifiedAt: new Date() },
      );
      if (!claim.modifiedCount) {
        return fail("Staff were already emailed about this policy in the last day.");
      }

      const tenantId = String(user.tenantId);
      emailPolicyReaders({ policy, recipients: outstanding, tenantId })
        .then((result) =>
          logAuditDirect({
            actor: { _id: user._id, name: user.name, email: user.email, role: user.role },
            action: "Policy.readersEmailed",
            module: "Policy",
            entityId: policy._id,
            tenantId,
            description: `Emailed ${result.sent} of ${outstanding.length} people to read policy "${policy.title}"`,
            status: result.failed ? "failure" : "success",
            metadata: { ...result, outstanding: outstanding.length },
          }),
        )
        .catch((error) => console.log("[policy-mail] run failed:", error?.message));

      const noEmail = outstanding.filter((r) => !r.email).length;
      recordAudit({
        entityId: policy._id,
        description: `Asked ${outstanding.length} people to read policy "${policy.title}"`,
      });

      return {
        success: true,
        message: `Emailing ${outstanding.length - noEmail} ${outstanding.length - noEmail === 1 ? "person" : "people"}.${
          noEmail ? ` ${noEmail} ${noEmail === 1 ? "has" : "have"} no email address.` : ""
        }`,
      };
    } catch (error) {
      console.log("Error emailing policy readers:", error);
      return fail("Could not email staff about this policy");
    }
  },
  { module: "Policy" },
);

/** Whether the signed-in user may manage policies — for conditional UI. */
export async function canManagePolicies() {
  const user = await requirePolicyManager();
  return { success: true, data: JSON.stringify(!!user) };
}
