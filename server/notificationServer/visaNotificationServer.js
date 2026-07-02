"use server";

import { connect } from "@/db/db";
import OfficeEmployeeModel from "@/models/officeEmployeeModel";
import EmployeModel from "@/models/employeModel";
import { getServerSideProps } from "../session/session";
import {
  daysUntil,
  getVisaUrgencyLevel,
  formatVisaRemaining,
  MILESTONE_WINDOW_DAYS,
} from "@/lib/visaMilestones";

const EMPTY = { success: true, data: JSON.stringify([]), totalCount: 0 };

/**
 * Live-computed visa notifications for the header bell. No stored state — this
 * reads the current active employees whose visa is expired or expiring within
 * the reminder window (90 days) and returns them newest-urgency first.
 *
 * Restricted to admin / superAdmin (visa expiry is an HR concern).
 */
export async function getVisaNotifications() {
  try {
    const { props } = await getServerSideProps();
    const role = props?.session?.user?.role;
    if (role !== "admin" && role !== "superAdmin") return EMPTY;

    await connect();

    // Upper bound: today + 90 days. No lower bound so already-expired visas are
    // included too. Mirrors the daily visa reminder cron.
    const upper = new Date();
    upper.setDate(upper.getDate() + MILESTONE_WINDOW_DAYS);

    const [office, field] = await Promise.all([
      OfficeEmployeeModel.find({
        delete: { $ne: true },
        isActive: true,
        immigrationType: { $ne: "British" },
        visaEndDate: { $ne: null, $lte: upper },
      })
        .select("name visaEndDate")
        .lean(),
      EmployeModel.find({
        delete: { $ne: true },
        isActive: true,
        immigrationType: { $ne: "British" },
        eVisaExp: { $ne: null, $lte: upper },
      })
        .select("firstName lastName eVisaExp")
        .lean(),
    ]);

    const notifications = [];

    const push = (type, id, name, date, href) => {
      const urgency = getVisaUrgencyLevel(date);
      if (!urgency || urgency === "safe") return;
      const days = daysUntil(date);
      const expired = urgency === "expired";
      notifications.push({
        // Urgency is part of the id so a fresh alert surfaces when a visa
        // escalates (e.g. expiring -> expired).
        id: `${type}:${id}:${urgency}`,
        type,
        name,
        href,
        urgency,
        daysLeft: days,
        date: date ? new Date(date).toISOString() : null,
        remaining: formatVisaRemaining(date),
        title: expired ? "Visa expired" : "Visa expiring soon",
        message: expired
          ? `${name}'s visa has expired`
          : `${name}'s visa expires in ${formatVisaRemaining(date)}`,
      });
    };

    for (const e of office) {
      push(
        "office",
        String(e._id),
        e.name || "Office employee",
        e.visaEndDate,
        "/admin/officeEmployee",
      );
    }
    for (const e of field) {
      const name = `${e.firstName || ""} ${e.lastName || ""}`.trim();
      push("field", String(e._id), name || "Employee", e.eVisaExp, "/admin/employee");
    }

    // Expired first, then soonest to expire.
    notifications.sort((a, b) => {
      if (a.urgency === "expired" && b.urgency !== "expired") return -1;
      if (b.urgency === "expired" && a.urgency !== "expired") return 1;
      return (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
    });

    return {
      success: true,
      data: JSON.stringify(notifications),
      totalCount: notifications.length,
    };
  } catch (error) {
    console.error("Error in getVisaNotifications:", error);
    return EMPTY;
  }
}
