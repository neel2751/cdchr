"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";
import AnnouncementModel from "@/models/announcementModel";
import AnnouncementReceiptModel from "@/models/announcementReceiptModel";
import EmployeModel from "@/models/employeModel";
import { getServerSideProps } from "../session/session";
import RoleBasedModel from "@/models/rolebasedModel";
import { countAudience, resolveAudience } from "./audience";
import { deliverAnnouncement } from "./announcementDelivery";
import { emitToTenant } from "@/lib/realtime";
import { featureRefusal } from "@/lib/requireFeature";

const MENU_PATH = "/admin/announcements";

const CATEGORIES = ["general", "policy", "hr", "safety", "it", "event"];
const PRIORITIES = ["normal", "important", "urgent"];
const AUDIENCE_MODES = ["all", "roles", "departments", "sites", "people"];
const ROLES = ["superAdmin", "admin", "user", "siteEmployee"];

const fail = (message) => ({ success: false, message });
const empty = { success: true, data: JSON.stringify([]), totalCount: 0 };

/**
 * May this user write announcements?
 *
 * Super admins always may. Everyone else needs the /admin/announcements page in
 * their role's permission list — the same grant that puts the page in their
 * sidebar and lets them past the route guard in proxy.js. Checking the same
 * thing here matters because proxy.js only guards navigation: a server action
 * can be called directly.
 *
 * Two questions, in this order: does the company's plan include the module, and
 * is this person allowed to use it? The plan comes first because a super admin
 * passes every role check but must still not author for a company that does not
 * have announcements.
 *
 * Every export in this file goes through here, which is why the plan check sits
 * in this one function rather than at eleven call sites. Reading announcements
 * already sent is deliberately not gated — see myAnnouncementServer.js.
 *
 * @returns {Promise<Object|null>} the session user, or null if not authorized
 */
async function requireAuthor() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return null;

  if (await featureRefusal("announcements")) return null;

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

const oneOf = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toOidList = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((v) => isValidObjectId(v))
    .map((v) => createObjectId(v));

/**
 * Narrow whatever the form sent to the fields this model accepts.
 *
 * Written as an allow-list rather than a spread: the payload arrives from a
 * client component, and spreading it would let a caller set `tenantId`,
 * `publishedAt` or `recipientCount` by hand.
 */
function sanitizeInput(data = {}) {
  const mode = oneOf(data?.audience?.mode, AUDIENCE_MODES, "all");

  return {
    title: String(data.title || "").trim(),
    body: String(data.body || "").trim(),
    category: oneOf(data.category, CATEGORIES, "general"),
    priority: oneOf(data.priority, PRIORITIES, "normal"),
    requireAck: !!data.requireAck,
    // Each entry was produced by uploadAnnouncementAttachment, which is where
    // the storage allowance and the tenant-prefixed key are enforced. Only the
    // metadata is copied through — a caller cannot invent a key here and have
    // it served, because getAttachmentUrl re-checks ownership before signing.
    attachments: (Array.isArray(data.attachments) ? data.attachments : [])
      .filter((a) => a?.key)
      .slice(0, 10)
      .map((a) => ({
        key: String(a.key),
        fileName: String(a.fileName || "file"),
        fileType: String(a.fileType || "application/octet-stream"),
        fileSize: Number(a.fileSize) || 0,
      })),
    publishAt: toDate(data.publishAt),
    expiresAt: toDate(data.expiresAt),
    channels: {
      inApp: true, // never optional
      email: !!data?.channels?.email,
      push: !!data?.channels?.push,
    },
    audience: {
      mode,
      roles: (data?.audience?.roles || []).filter((r) => ROLES.includes(r)),
      departments: toOidList(data?.audience?.departments),
      sites: toOidList(data?.audience?.sites),
      // The kind travels with each id: office and field staff are different
      // collections, and dropping it here would leave the resolver guessing.
      people: (Array.isArray(data?.audience?.people) ? data.audience.people : [])
        .map((p) => ({
          kind: p?.kind === "field" ? "field" : "office",
          employeeId: p?.employeeId ?? p,
        }))
        .filter((p) => isValidObjectId(p.employeeId))
        .map((p) => ({ kind: p.kind, employeeId: createObjectId(p.employeeId) })),
      includeField: !!data?.audience?.includeField,
    },
  };
}

/** Reject inputs the schema would accept but a reader would not. */
function validate(input) {
  if (!input.title) return "A title is required.";
  if (!input.body) return "A message body is required.";
  if (
    input.expiresAt &&
    input.publishAt &&
    input.expiresAt <= input.publishAt
  ) {
    return "The expiry date must be after the publish date.";
  }
  const { mode, roles, departments, people, sites } = input.audience;
  if (mode === "roles" && !roles.length) return "Choose at least one role.";
  if (mode === "departments" && !departments.length) {
    return "Choose at least one department.";
  }
  if (mode === "people" && !people.length) return "Choose at least one person.";
  if (mode === "sites" && !sites.length) return "Choose at least one site.";
  return null;
}

export const createAnnouncement = withAudit(
  "Announcement.create",
  async (data) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");

      const input = sanitizeInput(data);
      const problem = validate(input);
      if (problem) return fail(problem);

      await connect();

      const announcement = new AnnouncementModel({
        ...input,
        status: "draft",
        createdBy: user._id,
        createdByName: user.name || user.email,
      });
      await announcement.save();

      recordAudit({
        entityId: announcement._id,
        after: announcement.toObject(),
        description: `Created announcement "${input.title}"`,
      });

      return {
        success: true,
        message: "Announcement saved as a draft",
        data: JSON.stringify({ _id: announcement._id }),
      };
    } catch (error) {
      console.log("Error creating announcement:", error);
      return fail("Could not create the announcement");
    }
  },
  { module: "Announcement" }
);

export const updateAnnouncement = withAudit(
  "Announcement.update",
  async (id, data) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid announcement");

      const input = sanitizeInput(data);
      const problem = validate(input);
      if (problem) return fail(problem);

      await connect();

      const before = await AnnouncementModel.findById(id).lean();
      if (!before || before.isDeleted) return fail("Announcement not found");
      if (before.status === "archived") {
        return fail("An archived announcement cannot be edited");
      }

      const after = await AnnouncementModel.findByIdAndUpdate(
        id,
        {
          ...input,
          updatedBy: user._id,
          // The audience may have changed, so the snapshot taken at publish
          // time is no longer right. Only meaningful once published.
          ...(before.status === "published" || before.status === "scheduled"
            ? { recipientCount: await countAudience(input.audience) }
            : {}),
        },
        { new: true }
      );

      recordAudit({
        entityId: id,
        before,
        after: after?.toObject ? after.toObject() : after,
        description: `Updated announcement "${input.title}"`,
      });

      return { success: true, message: "Announcement updated" };
    } catch (error) {
      console.log("Error updating announcement:", error);
      return fail("Could not update the announcement");
    }
  },
  { module: "Announcement" }
);

/**
 * Send it.
 *
 * A future publishAt makes this "scheduled" rather than "published" — the
 * scheduler (phase 2) flips it over at the right time. Until that exists a
 * scheduled announcement simply sits there, which is the safe failure: nothing
 * goes out early.
 */
export const publishAnnouncement = withAudit(
  "Announcement.publish",
  async (id) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid announcement");

      await connect();

      const before = await AnnouncementModel.findById(id).lean();
      if (!before || before.isDeleted) return fail("Announcement not found");
      if (before.status === "published") {
        return fail("This announcement is already published");
      }

      const recipientCount = await countAudience(before.audience);
      if (!recipientCount) {
        return fail("This announcement's audience currently includes nobody");
      }

      const scheduled = before.publishAt && before.publishAt > new Date();

      const after = await AnnouncementModel.findByIdAndUpdate(
        id,
        {
          status: scheduled ? "scheduled" : "published",
          publishedAt: scheduled ? null : new Date(),
          recipientCount,
          updatedBy: user._id,
        },
        { new: true }
      );

      recordAudit({
        entityId: id,
        before,
        after: after?.toObject ? after.toObject() : after,
        description: scheduled
          ? `Scheduled announcement "${before.title}" for ${before.publishAt.toISOString()} (${recipientCount} recipients)`
          : `Published announcement "${before.title}" to ${recipientCount} recipients`,
      });

      // Deliberately not awaited. The announcement is already published and
      // readable in the app; the email copies are a slow best-effort tail —
      // 400 recipients at 25 per batch is ~16 seconds, and making an admin
      // watch a spinner for that is worse than letting it finish behind them.
      // Safe here because this runs on the long-lived server in server.mjs, not
      // a function that is frozen once the response is sent. Failures land in
      // the audit log, which is where deliverAnnouncement records outcomes.
      // In-app is the channel that always fires, so the nudge goes out on every
      // publish rather than only when a copy is emailed. Clients refetch on it;
      // the payload is a hint, not the record, so the audience check stays on
      // the server where it belongs.
      if (!scheduled) {
        emitToTenant(before.tenantId, "announcement:new", {
          announcementId: String(id),
        });
      }

      const sendsCopies = after?.channels?.email || after?.channels?.push;
      if (!scheduled && sendsCopies) {
        deliverAnnouncement(after.toObject ? after.toObject() : after, {
          actor: user,
        }).catch((e) =>
          console.log("[announcement-delivery] failed:", e?.message)
        );
      }

      const emailNote =
        !scheduled && sendsCopies ? " Notifications are going out now." : "";

      return {
        success: true,
        message: scheduled
          ? "Announcement scheduled"
          : `Published to ${recipientCount} ${
              recipientCount === 1 ? "person" : "people"
            }.${emailNote}`,
      };
    } catch (error) {
      console.log("Error publishing announcement:", error);
      return fail("Could not publish the announcement");
    }
  },
  { module: "Announcement" }
);

/** Back to draft. Receipts are kept — if it goes out again, so does the history. */
export const unpublishAnnouncement = withAudit(
  "Announcement.unpublish",
  async (id) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid announcement");

      await connect();

      const before = await AnnouncementModel.findById(id).lean();
      if (!before || before.isDeleted) return fail("Announcement not found");

      const after = await AnnouncementModel.findByIdAndUpdate(
        id,
        { status: "draft", publishedAt: null, updatedBy: user._id },
        { new: true }
      );

      recordAudit({
        entityId: id,
        before,
        after: after?.toObject ? after.toObject() : after,
        description: `Unpublished announcement "${before.title}"`,
      });

      return { success: true, message: "Announcement moved back to draft" };
    } catch (error) {
      console.log("Error unpublishing announcement:", error);
      return fail("Could not unpublish the announcement");
    }
  },
  { module: "Announcement" }
);

/**
 * Archive: it stops appearing for recipients but stays readable to the author,
 * with its receipts intact. This is the normal end of an announcement's life —
 * deletion is for mistakes.
 */
export const archiveAnnouncement = withAudit(
  "Announcement.archive",
  async (id) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid announcement");

      await connect();

      const before = await AnnouncementModel.findById(id).lean();
      if (!before || before.isDeleted) return fail("Announcement not found");

      const after = await AnnouncementModel.findByIdAndUpdate(
        id,
        { status: "archived", updatedBy: user._id },
        { new: true }
      );

      recordAudit({
        entityId: id,
        before,
        after: after?.toObject ? after.toObject() : after,
        description: `Archived announcement "${before.title}"`,
      });

      return { success: true, message: "Announcement archived" };
    } catch (error) {
      console.log("Error archiving announcement:", error);
      return fail("Could not archive the announcement");
    }
  },
  { module: "Announcement" }
);

export const deleteAnnouncement = withAudit(
  "Announcement.delete",
  async (id) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid announcement");

      await connect();

      const before = await AnnouncementModel.findById(id).lean();
      if (!before || before.isDeleted) return fail("Announcement not found");

      await AnnouncementModel.findByIdAndUpdate(id, {
        isDeleted: true,
        updatedBy: user._id,
      });
      // Receipts are meaningless once the announcement is gone, and leaving
      // them would keep counting towards nothing.
      await AnnouncementReceiptModel.deleteMany({ announcementId: id });

      recordAudit({
        entityId: id,
        before,
        description: `Deleted announcement "${before.title}"`,
      });

      return { success: true, message: "Announcement deleted" };
    } catch (error) {
      console.log("Error deleting announcement:", error);
      return fail("Could not delete the announcement");
    }
  },
  { module: "Announcement" }
);

/** The author-side list: everything this company has written. */
export async function getAnnouncements(filterData = {}) {
  try {
    const user = await requireAuthor();
    if (!user) return empty;

    const page = Math.max(parseInt(filterData?.page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(filterData?.pageSize) || 10, 1), 100);

    await connect();

    const filter = { isDeleted: false };
    if (["draft", "scheduled", "published", "archived"].includes(filterData?.status)) {
      filter.status = filterData.status;
    }
    if (CATEGORIES.includes(filterData?.category)) {
      filter.category = filterData.category;
    }
    if (PRIORITIES.includes(filterData?.priority)) {
      filter.priority = filterData.priority;
    }
    if (filterData?.query) {
      // Escaped: the value comes straight from a search box, and an unescaped
      // "(" is enough to throw an invalid-regex error out of the driver.
      const safe = String(filterData.query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.title = { $regex: safe, $options: "i" };
    }

    const [rows, totalCount] = await Promise.all([
      AnnouncementModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      AnnouncementModel.countDocuments(filter),
    ]);

    return { success: true, data: JSON.stringify(rows), totalCount };
  } catch (error) {
    console.log("Error listing announcements:", error);
    return empty;
  }
}

export async function getAnnouncementById(id) {
  try {
    const user = await requireAuthor();
    if (!user) return fail("Not authorized");
    if (!isValidObjectId(id)) return fail("Invalid announcement");

    await connect();

    const announcement = await AnnouncementModel.findOne({
      _id: id,
      isDeleted: false,
    }).lean();
    if (!announcement) return fail("Announcement not found");

    return { success: true, data: JSON.stringify(announcement) };
  } catch (error) {
    console.log("Error loading announcement:", error);
    return fail("Could not load the announcement");
  }
}

/**
 * How many people an audience currently covers, with a few names.
 *
 * Drives the live count on the compose screen. Publishing to the whole company
 * is irreversible and the author has, until now, had no way to see the size of
 * what they were about to send — the count was only ever computed server-side
 * at the moment of publishing.
 *
 * Takes the unsaved audience from the form, so it runs through the same
 * sanitiser as a save; a caller cannot use it to count arbitrary queries.
 */
export async function previewAudience(data) {
  const empty = { success: true, data: JSON.stringify({ count: 0, sample: [] }) };
  try {
    const user = await requireAuthor();
    if (!user) return empty;

    await connect();
    const { audience } = sanitizeInput({ audience: data?.audience });
    const people = await resolveAudience(audience);

    return {
      success: true,
      data: JSON.stringify({
        count: people.length,
        // Enough to recognise the group, not enough to be a directory listing.
        sample: people.slice(0, 5).map((p) => p.name).filter(Boolean),
        withoutEmail: people.filter((p) => !p.email).length,
      }),
    };
  } catch (error) {
    console.log("Error previewing audience:", error);
    return empty;
  }
}

/**
 * Field staff as picker options.
 *
 * selectServer's getSelectEmployee merges field and office staff into one list,
 * which loses the one thing the audience picker needs: which collection each id
 * came from. This returns field staff only, tagged.
 */
export async function getFieldStaffSelect() {
  try {
    const user = await requireAuthor();
    if (!user) return { success: true, data: JSON.stringify([]) };

    await connect();
    const rows = await EmployeModel.find({
      isActive: true,
      delete: { $ne: true },
    })
      .select("_id firstName lastName")
      .sort({ firstName: 1 })
      .lean();

    return {
      success: true,
      data: JSON.stringify(
        rows.map((r) => ({
          value: String(r._id),
          label: [r.firstName, r.lastName].filter(Boolean).join(" "),
          kind: "field",
        }))
      ),
    };
  } catch (error) {
    console.log("Error listing field staff:", error);
    return { success: true, data: JSON.stringify([]) };
  }
}

/** Whether the signed-in user may write announcements — for conditional UI. */
export async function canManageAnnouncements() {
  const user = await requireAuthor();
  return { success: true, data: JSON.stringify(!!user) };
}
