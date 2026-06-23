"use server";

import { logAuditDirect } from "@/lib/audit";
import { getServerSideProps } from "../session/session";

/**
 * Record that a user exported data (CSV/report). Captures who exported, what,
 * the optional date range and row count — a compliance trail of data exports.
 * Visible on the audit screen under module "Export" (action "Export.csv").
 *
 * @param {{ source?: string, label?: string, dateFrom?: string, dateTo?: string,
 *           rowCount?: number, module?: string }} args
 */
export async function logCsvExport({
  source,
  label,
  dateFrom,
  dateTo,
  rowCount,
  module = "Export",
} = {}) {
  try {
    const { props } = await getServerSideProps();
    const user = props?.session?.user;
    if (!user) return { success: false };

    const range = dateFrom && dateTo ? ` for ${dateFrom} → ${dateTo}` : "";
    const count = rowCount != null ? `, ${rowCount} row(s)` : "";

    await logAuditDirect({
      actor: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      action: "Export.csv",
      module,
      description: `Exported ${label || source || "data"} CSV${range}${count}`,
      metadata: { source, label, dateFrom, dateTo, rowCount },
    });

    return { success: true };
  } catch (error) {
    console.log("logCsvExport error", error);
    return { success: false };
  }
}
