"use server";

import { connect } from "@/db/db";
import { isValidObjectId } from "@/lib/mongodb";
import { withAudit, recordAudit } from "@/lib/audit";
import MediaModel from "@/models/document/mediaModel";
import DocumentModel from "@/models/document/documentModel";
import ExpenseModel from "@/models/expense/expenseModel";
import { getServerSideProps } from "../session/session";

const STATUSES = ["active", "archived", "deleted"];
const SOURCES = ["media", "document", "expense"];

// Reject anyone who is not a super admin. Returns the user when authorized.
async function requireSuperAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (user?.role !== "superAdmin") return null;
  return user;
}

// Normalizes a value into one of: "active" | "archived" | "deleted".
// Used inside aggregation $switch branches per source.
function statusSwitch(deletedExpr, archivedExpr) {
  return {
    $switch: {
      branches: [
        { case: deletedExpr, then: "deleted" },
        { case: archivedExpr, then: "archived" },
      ],
      default: "active",
    },
  };
}

// Builds the pipeline that projects every file (across the 3 collections) into a
// single normalized shape: { source, parentId, key, name, fileType, docType,
// fileSize, status, uploadedAt }. Run against MediaModel.aggregate(...).
function buildUnionPipeline() {
  return [
    // --- Media library ---
    {
      $project: {
        _id: 0,
        source: { $literal: "media" },
        parentId: { $toString: "$_id" },
        key: "$key",
        name: "$fileName",
        fileType: { $ifNull: ["$fileType", "unknown"] },
        docType: { $ifNull: ["$category", "other"] },
        fileSize: { $ifNull: ["$fileSize", 0] },
        status: statusSwitch(
          { $eq: ["$status", "deleted"] },
          { $eq: ["$status", "archived"] }
        ),
        uploadedAt: "$createdAt",
      },
    },
    // --- Employee documents ---
    {
      $unionWith: {
        coll: DocumentModel.collection.collectionName,
        pipeline: [
          { $unwind: "$documentsFiles" },
          {
            $project: {
              _id: 0,
              source: { $literal: "document" },
              parentId: { $toString: "$_id" },
              key: "$documentsFiles.key",
              name: "$documentsFiles.fileName",
              fileType: { $ifNull: ["$documentsFiles.fileType", "unknown"] },
              docType: { $ifNull: ["$documentsFiles.docType", "other"] },
              fileSize: { $ifNull: ["$documentsFiles.fileSize", 0] },
              status: statusSwitch(
                { $or: ["$isDeleted", "$documentsFiles.isDeleted"] },
                "$documentsFiles.isArchived"
              ),
              uploadedAt: {
                $ifNull: ["$documentsFiles.uploadedAt", "$createdAt"],
              },
            },
          },
        ],
      },
    },
    // --- Expense receipts ---
    {
      $unionWith: {
        coll: ExpenseModel.collection.collectionName,
        pipeline: [
          { $unwind: "$receiptFiles" },
          {
            $project: {
              _id: 0,
              source: { $literal: "expense" },
              parentId: { $toString: "$_id" },
              key: "$receiptFiles.key",
              name: "$title",
              fileType: { $ifNull: ["$receiptFiles.fileType", "unknown"] },
              docType: { $literal: "receipt" },
              fileSize: { $ifNull: ["$receiptFiles.fileSize", 0] },
              status: statusSwitch(
                { $or: ["$isDeleted", "$receiptFiles.isDeleted"] },
                "$receiptFiles.isArchived"
              ),
              uploadedAt: { $ifNull: ["$receiptFiles.uploadedAt", "$createdAt"] },
            },
          },
        ],
      },
    },
  ];
}

// Aggregate overview stats across every file source.
export async function getMediaStats() {
  try {
    if (!(await requireSuperAdmin())) {
      return { success: false, message: "Not authorized", data: JSON.stringify(null) };
    }
    await connect();

    const [result] = await MediaModel.aggregate([
      ...buildUnionPipeline(),
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalFiles: { $sum: 1 },
                totalBytes: { $sum: "$fileSize" },
              },
            },
          ],
          byStatus: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                bytes: { $sum: "$fileSize" },
              },
            },
          ],
          byType: [
            {
              $group: {
                _id: "$docType",
                count: { $sum: 1 },
                bytes: { $sum: "$fileSize" },
              },
            },
            { $sort: { count: -1 } },
          ],
          bySource: [
            {
              $group: {
                _id: "$source",
                count: { $sum: 1 },
                bytes: { $sum: "$fileSize" },
              },
            },
          ],
        },
      },
    ]);

    const totals = result?.totals?.[0] || { totalFiles: 0, totalBytes: 0 };
    const byStatus = { active: 0, archived: 0, deleted: 0 };
    (result?.byStatus || []).forEach((s) => {
      if (s._id) byStatus[s._id] = s.count;
    });
    const byType = (result?.byType || []).map((t) => ({
      type: t._id || "other",
      count: t.count,
      bytes: t.bytes,
    }));
    const bySource = (result?.bySource || []).map((s) => ({
      source: s._id,
      count: s.count,
      bytes: s.bytes,
    }));

    return {
      success: true,
      data: JSON.stringify({
        totalFiles: totals.totalFiles,
        totalBytes: totals.totalBytes,
        typeCount: byType.length,
        byStatus,
        byType,
        bySource,
      }),
    };
  } catch (error) {
    console.log("Error in getMediaStats", error);
    return { success: false, message: "Failed to load stats", data: JSON.stringify(null) };
  }
}

// Distinct document types to populate the type filter.
export async function getMediaTypes() {
  try {
    if (!(await requireSuperAdmin())) {
      return { success: false, data: JSON.stringify([]) };
    }
    await connect();
    const rows = await MediaModel.aggregate([
      ...buildUnionPipeline(),
      { $group: { _id: "$docType" } },
      { $sort: { _id: 1 } },
    ]);
    const options = rows
      .map((r) => r._id)
      .filter(Boolean)
      .map((t) => ({ label: t, value: t }));
    return { success: true, data: JSON.stringify(options) };
  } catch (error) {
    console.log("Error in getMediaTypes", error);
    return { success: false, data: JSON.stringify([]) };
  }
}

// Paginated, filterable list of every file across the 3 sources.
export async function getMediaFiles(filterData) {
  try {
    if (!(await requireSuperAdmin())) {
      return { success: false, message: "Not authorized", data: "[]", totalCount: 0 };
    }

    const validPage = Number.isInteger(parseInt(filterData?.page))
      ? parseInt(filterData?.page)
      : 1;
    const validLimit = Number.isInteger(parseInt(filterData?.pageSize))
      ? parseInt(filterData?.pageSize)
      : 10;
    const skip = Math.max((validPage - 1) * validLimit, 0);

    const match = {};
    if (STATUSES.includes(filterData?.status)) match.status = filterData.status;
    if (SOURCES.includes(filterData?.source)) match.source = filterData.source;
    if (filterData?.type) match.docType = filterData.type;
    const query = filterData?.query?.trim();
    if (query) {
      const regex = new RegExp(query, "i");
      match.$or = [
        { name: regex },
        { docType: regex },
        { fileType: regex },
        { key: regex },
      ];
    }

    await connect();
    const [result] = await MediaModel.aggregate([
      ...buildUnionPipeline(),
      { $match: match },
      {
        $facet: {
          data: [
            { $sort: { uploadedAt: -1 } },
            { $skip: skip },
            { $limit: validLimit },
          ],
          total: [{ $count: "count" }],
        },
      },
    ]);

    const files = result?.data || [];
    const totalCount = result?.total?.[0]?.count || 0;

    return {
      success: true,
      message: "Files fetched successfully",
      data: JSON.stringify(files),
      totalCount,
    };
  } catch (error) {
    console.log("Error in getMediaFiles", error);
    return { success: false, message: "Failed to fetch files", data: "[]", totalCount: 0 };
  }
}

// Field updates for a given action, by source.
function buildStatusFields(source, action) {
  const now = new Date();
  if (source === "media") {
    if (action === "archive") return { status: "archived", archivedAt: now };
    if (action === "delete") return { status: "deleted", deletedAt: now };
    return { status: "uploaded", archivedAt: null, deletedAt: null }; // restore
  }
  // document & expense use boolean sub-file flags
  if (action === "archive")
    return { isArchived: true, isDeleted: false, archivedAt: now };
  if (action === "delete") return { isDeleted: true, deletedAt: now };
  return { isArchived: false, isDeleted: false }; // restore
}

// Archive / delete (soft) / restore a single file, routed to the right
// collection. Audit-logged for super admins via withAudit.
async function updateMediaFileStatusHandler({ source, parentId, key, action }) {
  if (!(await requireSuperAdmin())) {
    return { success: false, message: "Not authorized" };
  }
  if (!SOURCES.includes(source)) {
    return { success: false, message: "Invalid source" };
  }
  if (!["archive", "delete", "restore"].includes(action)) {
    return { success: false, message: "Invalid action" };
  }
  if (!isValidObjectId(parentId) || !key) {
    return { success: false, message: "Invalid file reference" };
  }

  await connect();
  const fields = buildStatusFields(source, action);

  let modified = 0;
  if (source === "media") {
    const res = await MediaModel.updateOne({ _id: parentId }, { $set: fields });
    modified = res.modifiedCount;
  } else {
    const arrayName = source === "document" ? "documentsFiles" : "receiptFiles";
    const set = {};
    for (const [k, v] of Object.entries(fields)) {
      set[`${arrayName}.$[f].${k}`] = v;
    }
    const Model = source === "document" ? DocumentModel : ExpenseModel;
    const res = await Model.updateOne(
      { _id: parentId, [`${arrayName}.key`]: key },
      { $set: set },
      { arrayFilters: [{ "f.key": key }] }
    );
    modified = res.modifiedCount;
  }

  if (!modified) {
    return { success: false, message: "File not found or already in that state" };
  }

  const newStatus =
    action === "archive" ? "archived" : action === "delete" ? "deleted" : "active";
  recordAudit({
    entityId: parentId,
    after: { source, key, status: newStatus },
    description: `${action} ${source} file`,
    module: "Media",
  });

  return { success: true, message: `File ${action}d successfully` };
}

export const updateMediaFileStatus = withAudit(
  "Media.statusUpdate",
  updateMediaFileStatusHandler,
  { module: "Media" }
);
