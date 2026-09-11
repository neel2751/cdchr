"use server";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";
import AnnouncementModel from "@/models/announcementModel";
import AnnouncementReceiptModel from "@/models/announcementReceiptModel";
import RoleBasedModel from "@/models/rolebasedModel";
import { getServerSideProps } from "../session/session";
import { resolveAudience } from "./audience";
import { emailAnnouncementTo } from "./announcementDelivery";

const MENU_PATH = "/admin/announcements";

const fail = (message) => ({ success: false, message });

/** Same rule as announcementServer.requireAuthor — the report is author-side. */
async function requireAuthor() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (!user?._id) return null;
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

/**
 * The audience, joined to whatever receipts exist for it.
 *
 * The join runs in memory rather than as an aggregation because the two sides
 * live in different shapes: the audience is computed from OfficeEmploye by
 * rules, not stored as a list, so there is nothing to $lookup against. For a
 * company's headcount this is a couple of hundred rows.
 *
 * Sorted unread-first — the useful question is who has NOT seen it.
 */
async function buildRows(announcement) {
  const recipients = await resolveAudience(announcement.audience);

  const receipts = await AnnouncementReceiptModel.find({
    announcementId: announcement._id,
  })
    .select("employeeId readAt acknowledgedAt")
    .lean();

  const byEmployee = new Map(receipts.map((r) => [String(r.employeeId), r]));

  const rows = recipients.map((person) => {
    const receipt = byEmployee.get(String(person.employeeId));
    return {
      employeeId: String(person.employeeId),
      name: person.name,
      email: person.email,
      readAt: receipt?.readAt || null,
      acknowledgedAt: receipt?.acknowledgedAt || null,
    };
  });

  rows.sort((a, b) => {
    // Unread first, then read-but-not-acknowledged, then done. Within a group,
    // alphabetically, so the list is stable between refreshes.
    const rank = (r) => (!r.readAt ? 0 : !r.acknowledgedAt ? 1 : 2);
    return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
  });

  return rows;
}

/**
 * Who has read an announcement, and who has not.
 *
 * Takes one object rather than (id, filter) so react-query's single-argument
 * fetch signature can pass it straight through.
 *
 * @param {{id:string, page?:number, pageSize?:number, status?:"all"|"unread"|"read"|"acknowledged"}} filterData
 */
export async function getAnnouncementRecipients(filterData = {}) {
  const { id } = filterData;
  const empty = {
    success: true,
    data: JSON.stringify([]),
    totalCount: 0,
    stats: JSON.stringify({ total: 0, read: 0, acknowledged: 0, requireAck: false }),
  };

  try {
    const user = await requireAuthor();
    if (!user) return empty;
    if (!isValidObjectId(id)) return empty;

    await connect();

    const announcement = await AnnouncementModel.findOne({
      _id: createObjectId(id),
      isDeleted: false,
    })
      .select("audience requireAck status")
      .lean();
    if (!announcement) return empty;

    const rows = await buildRows(announcement);

    const stats = {
      total: rows.length,
      read: rows.filter((r) => r.readAt).length,
      acknowledged: rows.filter((r) => r.acknowledgedAt).length,
      requireAck: !!announcement.requireAck,
      // A draft has been sent to nobody, so a 0/40 read rate on one is not a
      // fact about engagement.
      published: announcement.status === "published",
    };

    const status = filterData?.status || "all";
    const filtered =
      status === "unread"
        ? rows.filter((r) => !r.readAt)
        : status === "read"
          ? rows.filter((r) => r.readAt)
          : status === "acknowledged"
            ? rows.filter((r) => r.acknowledgedAt)
            : rows;

    const page = Math.max(parseInt(filterData?.page) || 1, 1);
    const pageSize = Math.min(
      Math.max(parseInt(filterData?.pageSize) || 10, 1),
      100
    );
    const slice = filtered.slice((page - 1) * pageSize, page * pageSize);

    return {
      success: true,
      data: JSON.stringify(slice),
      totalCount: filtered.length,
      stats: JSON.stringify(stats),
    };
  } catch (error) {
    console.log("Error building recipient report:", error);
    return empty;
  }
}

/**
 * Email everyone who has not opened it yet.
 *
 * Ignores the announcement's own email setting: an in-app-only announcement
 * that nobody has read is exactly when someone wants to nudge by email, and the
 * admin pressing this button is the decision.
 */
export const remindUnread = withAudit(
  "Announcement.remind",
  async (id) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");
      if (!isValidObjectId(id)) return fail("Invalid announcement");

      await connect();

      const announcement = await AnnouncementModel.findOne({
        _id: createObjectId(id),
        isDeleted: false,
      }).lean();
      if (!announcement) return fail("Announcement not found");
      if (announcement.status !== "published") {
        return fail("Only a published announcement can be chased up");
      }

      const rows = await buildRows(announcement);
      const unread = rows.filter((r) => !r.readAt && r.email);
      if (!unread.length) {
        return fail("Everyone has read this already");
      }

      const result = await emailAnnouncementTo(
        announcement,
        unread.map((r) => ({
          employeeId: r.employeeId,
          name: r.name,
          email: r.email,
        })),
        user
      );

      recordAudit({
        entityId: id,
        description:
          `Reminded ${result.sent} of ${unread.length} people who had not read ` +
          `"${announcement.title}"`,
      });

      return {
        success: true,
        message: `Reminder sent to ${result.sent} ${
          result.sent === 1 ? "person" : "people"
        }${result.failed ? ` (${result.failed} failed)` : ""}`,
      };
    } catch (error) {
      console.log("Error reminding unread:", error);
      return fail("Could not send the reminders");
    }
  },
  { module: "Announcement" }
);
