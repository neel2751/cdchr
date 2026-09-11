"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { isReadOnly } from "@/lib/tenantContext";
import AnnouncementModel from "@/models/announcementModel";
import AnnouncementReceiptModel from "@/models/announcementReceiptModel";
import { getServerSideProps } from "../session/session";
import { getViewer, visibilityFilter } from "./audience";

// How many recent announcements the unread badge considers. A company that has
// published more than this and left them all unread has a bigger problem than
// an inexact badge, and the alternative is an unbounded scan on every page load.
const UNREAD_SCAN_LIMIT = 200;

const fail = (message) => ({ success: false, message });
const empty = { success: true, data: JSON.stringify([]), totalCount: 0 };

/**
 * The signed-in person, resolved to their employee record in whichever of the
 * two populations they belong to.
 *
 * The role is passed as a hint so the usual case is one lookup rather than two:
 * office and field staff live in different collections and only the session
 * knows which app the caller signed into.
 */
async function currentViewer() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return null;
  await connect();
  return getViewer(user._id, user.role === "siteEmployee" ? "field" : "office");
}

/**
 * Everything currently addressed to this person.
 *
 * Expiry is applied here rather than by a job, so an expired announcement stops
 * appearing the moment it expires with nothing scheduled to make that true.
 */
function liveFilter(viewer) {
  return {
    status: "published",
    isDeleted: false,
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
      visibilityFilter(viewer),
    ],
  };
}

export async function getMyAnnouncements(filterData = {}) {
  try {
    const viewer = await currentViewer();
    if (!viewer) return empty;

    const page = Math.max(parseInt(filterData?.page) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(filterData?.pageSize) || 10, 1),
      100
    );

    const filter = liveFilter(viewer);

    const [rows, totalCount] = await Promise.all([
      AnnouncementModel.aggregate([
        { $match: filter },
        // Important and urgent announcements pin to the top. Sorting on the
        // priority string itself would order them alphabetically —
        // important < normal < urgent — which puts "normal" in the middle.
        {
          $addFields: {
            pinRank: {
              $cond: [{ $in: ["$priority", ["important", "urgent"]] }, 0, 1],
            },
          },
        },
        { $sort: { pinRank: 1, publishedAt: -1 } },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
        {
          $project: {
            title: 1,
            body: 1,
            category: 1,
            priority: 1,
            requireAck: 1,
            publishedAt: 1,
            expiresAt: 1,
            createdByName: 1,
            attachments: 1,
          },
        },
      ]),
      AnnouncementModel.countDocuments(filter),
    ]);

    const receipts = await AnnouncementReceiptModel.find({
      employeeId: viewer.employeeId,
      announcementId: { $in: rows.map((r) => r._id) },
    })
      .select("announcementId readAt acknowledgedAt")
      .lean();

    const byAnnouncement = new Map(
      receipts.map((r) => [String(r.announcementId), r])
    );

    const data = rows.map((row) => {
      const receipt = byAnnouncement.get(String(row._id));
      return {
        ...row,
        readAt: receipt?.readAt || null,
        acknowledgedAt: receipt?.acknowledgedAt || null,
      };
    });

    return { success: true, data: JSON.stringify(data), totalCount };
  } catch (error) {
    console.log("Error listing my announcements:", error);
    return empty;
  }
}

/**
 * The bell's badge: how many addressed to me I have not opened.
 *
 * Wrapped in an object rather than returned as a bare number because
 * useFetchSelectQuery falls back to `[]` on any falsy parse — a genuine zero
 * would come back as an empty array.
 */
export async function getMyUnreadCount() {
  const none = { success: true, data: JSON.stringify({ count: 0 }) };
  try {
    const viewer = await currentViewer();
    if (!viewer) return none;

    const visible = await AnnouncementModel.find(liveFilter(viewer))
      .select("_id")
      .sort({ publishedAt: -1 })
      .limit(UNREAD_SCAN_LIMIT)
      .lean();

    if (!visible.length) return none;

    const readCount = await AnnouncementReceiptModel.countDocuments({
      employeeId: viewer.employeeId,
      announcementId: { $in: visible.map((a) => a._id) },
      readAt: { $ne: null },
    });

    return {
      success: true,
      data: JSON.stringify({
        count: Math.max(visible.length - readCount, 0),
      }),
    };
  } catch (error) {
    console.log("Error counting unread announcements:", error);
    return none;
  }
}

/**
 * Urgent announcements this person has not dealt with yet, for the banner.
 *
 * "Dealt with" depends on the announcement: one that asks for an
 * acknowledgement keeps nagging until it gets one, so the banner cannot be
 * dismissed out of it. An ordinary urgent one goes away when dismissed.
 */
export async function getUrgentAnnouncements() {
  const empty = { success: true, data: JSON.stringify([]) };
  try {
    const viewer = await currentViewer();
    if (!viewer) return empty;

    const rows = await AnnouncementModel.find({
      ...liveFilter(viewer),
      priority: "urgent",
    })
      .select("title requireAck publishedAt")
      .sort({ publishedAt: -1 })
      .limit(5)
      .lean();

    if (!rows.length) return empty;

    const receipts = await AnnouncementReceiptModel.find({
      employeeId: viewer.employeeId,
      announcementId: { $in: rows.map((r) => r._id) },
    })
      .select("announcementId acknowledgedAt dismissedAt")
      .lean();

    const byAnnouncement = new Map(
      receipts.map((r) => [String(r.announcementId), r])
    );

    const outstanding = rows.filter((row) => {
      const receipt = byAnnouncement.get(String(row._id));
      return row.requireAck ? !receipt?.acknowledgedAt : !receipt?.dismissedAt;
    });

    return { success: true, data: JSON.stringify(outstanding) };
  } catch (error) {
    console.log("Error loading urgent announcements:", error);
    return empty;
  }
}

/** One announcement, but only if it is addressed to the person asking. */
export async function getMyAnnouncementById(id) {
  try {
    if (!isValidObjectId(id)) return fail("Invalid announcement");

    const viewer = await currentViewer();
    if (!viewer) return fail("Not authorized");

    const announcement = await AnnouncementModel.findOne({
      _id: createObjectId(id),
      ...liveFilter(viewer),
    }).lean();
    if (!announcement) return fail("Announcement not found");

    const receipt = await AnnouncementReceiptModel.findOne({
      announcementId: announcement._id,
      employeeId: viewer.employeeId,
    })
      .select("readAt acknowledgedAt")
      .lean();

    return {
      success: true,
      data: JSON.stringify({
        ...announcement,
        readAt: receipt?.readAt || null,
        acknowledgedAt: receipt?.acknowledgedAt || null,
      }),
    };
  } catch (error) {
    console.log("Error loading my announcement:", error);
    return fail("Could not load the announcement");
  }
}

/**
 * Record something about this person's relationship with this announcement.
 *
 * All three recipient actions are the same operation with a different field, so
 * they share this. Two things it has to get right:
 *
 * 1. Visibility is checked first. Without it, any signed-in user could post
 *    receipts for announcements never addressed to them and corrupt the
 *    author's read report.
 *
 * 2. Creation goes through save() rather than an upsert. In shadow mode the
 *    tenant plugin adds no filter, so an upsert's inserted document would carry
 *    no tenantId at all — the pre("save") hook stamps it in both modes.
 *    The unique index turns the resulting race into a duplicate-key error,
 *    which is retried as an update rather than surfaced.
 */
async function stamp(id, field) {
  if (!isValidObjectId(id)) return fail("Invalid announcement");

  const viewer = await currentViewer();
  if (!viewer) return fail("Not authorized");

  // A platform support visit is read-only, and every write throws
  // (ReadOnlySessionError). Marking-as-read happens on page load, so without
  // this a support visitor gets an error page instead of the announcement.
  if (await isReadOnly()) {
    return { success: true, message: "Read-only session; nothing recorded" };
  }

  const announcement = await AnnouncementModel.findOne({
    _id: createObjectId(id),
    ...liveFilter(viewer),
  })
    .select("_id requireAck")
    .lean();
  if (!announcement) return fail("Announcement not found");

  if (field === "acknowledgedAt" && !announcement.requireAck) {
    return fail("This announcement does not ask for an acknowledgement");
  }

  const query = {
    announcementId: announcement._id,
    employeeId: viewer.employeeId,
  };

  const existing = await AnnouncementReceiptModel.findOne(query)
    .select(`_id ${field}`)
    .lean();

  if (existing) {
    // Keep the first timestamp: "when did they read it" should not move every
    // time they open it again.
    if (existing[field]) return { success: true, message: "Already recorded" };
    await AnnouncementReceiptModel.updateOne(query, {
      $set: { [field]: new Date() },
    });
    return { success: true, message: "Recorded" };
  }

  try {
    await AnnouncementReceiptModel.create({
      ...query,
      // Which population this id belongs to. Two people — one office, one field
      // — can hold the same ObjectId value in principle, so the report would
      // credit the wrong person without it.
      employeeKind: viewer.kind,
      // Acknowledging or dismissing implies having read it.
      readAt: new Date(),
      [field]: new Date(),
    });
    return { success: true, message: "Recorded" };
  } catch (error) {
    // Lost the race against a concurrent first write; the row now exists.
    if (error?.code === 11000) {
      await AnnouncementReceiptModel.updateOne(query, {
        $set: { [field]: new Date() },
      });
      return { success: true, message: "Recorded" };
    }
    throw error;
  }
}

export async function markAnnouncementRead(id) {
  try {
    return await stamp(id, "readAt");
  } catch (error) {
    console.log("Error marking announcement read:", error);
    return fail("Could not mark as read");
  }
}

export async function acknowledgeAnnouncement(id) {
  try {
    return await stamp(id, "acknowledgedAt");
  } catch (error) {
    console.log("Error acknowledging announcement:", error);
    return fail("Could not record your acknowledgement");
  }
}

export async function dismissAnnouncement(id) {
  try {
    return await stamp(id, "dismissedAt");
  } catch (error) {
    console.log("Error dismissing announcement:", error);
    return fail("Could not dismiss the announcement");
  }
}
