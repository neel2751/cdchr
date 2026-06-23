"use server";

import { connect } from "@/db/db";
import AuditLogModel from "@/models/auditLogModel";
import { getServerSideProps } from "../session/session";

// Read-only, paginated audit log feed. Restricted to super admins since the
// log exposes the change history of every privileged user.
export async function getAuditLogs(filterData) {
  try {
    const { props } = await getServerSideProps();
    const role = props?.session?.user?.role;
    if (role !== "superAdmin") {
      return { success: false, message: "Not authorized", data: "[]", totalCount: 0 };
    }

    const validPage = Number.isInteger(parseInt(filterData?.page))
      ? parseInt(filterData?.page)
      : 1;
    const validLimit = Number.isInteger(parseInt(filterData?.pageSize))
      ? parseInt(filterData?.pageSize)
      : 10;
    const skip = Math.max((validPage - 1) * validLimit, 0);

    const query = filterData?.query?.trim();
    const match = {};
    if (query) {
      const regex = new RegExp(query, "i");
      match.$or = [
        { actorName: regex },
        { actorEmail: regex },
        { actorRole: regex },
        { action: regex },
        { module: regex },
        { description: regex },
        { status: regex },
      ];
    }
    if (filterData?.module) match.module = filterData.module;

    await connect();
    const [totalCount, logs] = await Promise.all([
      AuditLogModel.countDocuments(match),
      AuditLogModel.find(match)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validLimit)
        .lean(),
    ]);

    return {
      success: true,
      message: "Audit logs fetched successfully",
      data: JSON.stringify(logs),
      totalCount,
    };
  } catch (error) {
    console.log("Error in getAuditLogs function", error);
    return { success: false, message: "Error fetching audit logs", data: "[]", totalCount: 0 };
  }
}

// Distinct module list to populate the filter dropdown.
export async function getAuditLogModules() {
  try {
    const { props } = await getServerSideProps();
    if (props?.session?.user?.role !== "superAdmin") {
      return { success: false, data: JSON.stringify([]) };
    }
    await connect();
    const modules = await AuditLogModel.distinct("module");
    const options = modules
      .filter(Boolean)
      .map((m) => ({ label: m, value: m }));
    return { success: true, data: JSON.stringify(options) };
  } catch (error) {
    console.log("Error in getAuditLogModules function", error);
    return { success: false, data: JSON.stringify([]) };
  }
}
