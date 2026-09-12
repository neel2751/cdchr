"use server";

import { addDays, isMonday, startOfWeek } from "date-fns";
import { connect } from "@/db/db";
import { withAudit, recordAudit } from "@/lib/audit";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import AttendanceUploadModel from "@/models/attendanceUploadModel";
import { getServerSideProps } from "../session/session";
import { uploadImage, deleteFileFromS3 } from "../aws/upload";

// Weekly attendance sheets are usually an export from a spreadsheet or a
// scanned/printed sign-in sheet. Anything outside this list is rejected before
// it reaches S3.
const ALLOWED_FILE_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/csv",
  "application/csv",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

// Extension fallback: browsers disagree on the MIME type of .csv / .xls files
// (Windows reports "application/octet-stream" for CSV often enough to matter).
const ALLOWED_EXTENSIONS = new Set(["xlsx", "xls", "csv", "pdf", "png", "jpg", "jpeg", "webp"]);

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const EMPTY_LIST = { success: false, data: "[]", totalCount: 0 };

// Every action here is super-admin only: the sheets carry whole-company
// attendance, and uploading is an explicitly privileged step in the process.
async function requireSuperAdmin() {
  const { props } = await getServerSideProps();
  const user = props?.session?.user;
  if (user?.role !== "superAdmin") return null;
  return user;
}

/**
 * Snap any date inside a week to that week's Monday at UTC midnight, so the
 * week a record covers never depends on the uploader's timezone or on which
 * day of the week they happened to click.
 */
function normalizeWeekStart(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const monday = isMonday(parsed) ? parsed : startOfWeek(parsed, { weekStartsOn: 1 });
  return new Date(
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate())
  );
}

function fileExtension(name = "") {
  const parts = String(name).split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function validateFile(file) {
  if (!file || typeof file !== "object" || !file.name) {
    return "Please choose an attendance file to upload";
  }
  if (!file.size) {
    return "The selected file is empty";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "File is too large. The maximum size is 10 MB";
  }
  const typeOk = ALLOWED_FILE_TYPES.has(file.type);
  const extOk = ALLOWED_EXTENSIONS.has(fileExtension(file.name));
  if (!typeOk && !extOk) {
    return "Unsupported file type. Upload an Excel, CSV, PDF or image file";
  }
  return null;
}

/** Serializable summary of one stored file, used in audit snapshots. */
function fileSnapshot(file) {
  if (!file) return undefined;
  return {
    originalName: file.originalName,
    key: file.key,
    fileSize: file.fileSize,
    fileType: file.fileType,
  };
}

/**
 * Paginated list of uploaded weeks, newest week first. `month` (1-12) and
 * `year` narrow the list by the month the week *starts* in, which is how the
 * weeks are labelled everywhere else in the app.
 */
export async function getWeeklyAttendanceUploads(filterData) {
  try {
    const user = await requireSuperAdmin();
    if (!user) return { ...EMPTY_LIST, message: "Not authorized" };

    const validPage = Number.isInteger(parseInt(filterData?.page))
      ? parseInt(filterData?.page)
      : 1;
    const validLimit = Number.isInteger(parseInt(filterData?.pageSize))
      ? parseInt(filterData?.pageSize)
      : 10;
    const skip = Math.max((validPage - 1) * validLimit, 0);

    const match = {};

    const year = parseInt(filterData?.year);
    const month = parseInt(filterData?.month); // 1-12
    if (Number.isInteger(year)) {
      const from = Number.isInteger(month)
        ? new Date(Date.UTC(year, month - 1, 1))
        : new Date(Date.UTC(year, 0, 1));
      const to = Number.isInteger(month)
        ? new Date(Date.UTC(year, month, 1))
        : new Date(Date.UTC(year + 1, 0, 1));
      match.weekStartDate = { $gte: from, $lt: to };
    }

    const query = filterData?.query?.trim();
    if (query) {
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [
        { "file.originalName": regex },
        { note: regex },
        { uploadedByName: regex },
        { uploadedByEmail: regex },
      ];
    }

    await connect();
    const [totalCount, records] = await Promise.all([
      AttendanceUploadModel.countDocuments(match),
      AttendanceUploadModel.find(match)
        .sort({ weekStartDate: -1 })
        .skip(skip)
        .limit(validLimit)
        .lean(),
    ]);

    return {
      success: true,
      message: "Attendance uploads fetched successfully",
      data: JSON.stringify(records),
      totalCount,
    };
  } catch (error) {
    console.log("Error in getWeeklyAttendanceUploads function", error);
    return { ...EMPTY_LIST, message: "Error fetching attendance uploads" };
  }
}

/** Years that actually have an upload, for the year filter dropdown. */
export async function getWeeklyAttendanceUploadYears() {
  try {
    const user = await requireSuperAdmin();
    if (!user) return { success: false, data: "[]" };

    await connect();
    const years = await AttendanceUploadModel.aggregate([
      { $group: { _id: { $year: "$weekStartDate" } } },
      { $sort: { _id: -1 } },
    ]);

    const options = years
      .map((y) => y?._id)
      .filter((y) => Number.isInteger(y))
      .map((y) => ({ label: String(y), value: String(y) }));

    // Always offer the current year so the filter is usable before the first
    // upload of a new year lands.
    const currentYear = String(new Date().getFullYear());
    if (!options.some((o) => o.value === currentYear)) {
      options.unshift({ label: currentYear, value: currentYear });
    }

    return { success: true, data: JSON.stringify(options) };
  } catch (error) {
    console.log("Error in getWeeklyAttendanceUploadYears function", error);
    return { success: false, data: "[]" };
  }
}

/** Header counters: total weeks covered, this month's uploads, latest week. */
export async function getWeeklyAttendanceUploadStats() {
  try {
    const user = await requireSuperAdmin();
    if (!user) return { success: false, data: "{}" };

    await connect();
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const nextMonthStart = new Date(
      Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)
    );

    const [totalWeeks, thisMonth, latest] = await Promise.all([
      AttendanceUploadModel.countDocuments({}),
      AttendanceUploadModel.countDocuments({
        weekStartDate: { $gte: monthStart, $lt: nextMonthStart },
      }),
      AttendanceUploadModel.findOne({}).sort({ weekStartDate: -1 }).lean(),
    ]);

    return {
      success: true,
      data: JSON.stringify({
        totalWeeks,
        thisMonth,
        latestWeekStart: latest?.weekStartDate || null,
        latestWeekEnd: latest?.weekEndDate || null,
      }),
    };
  } catch (error) {
    console.log("Error in getWeeklyAttendanceUploadStats function", error);
    return { success: false, data: "{}" };
  }
}

/**
 * Does the given week already have a sheet? The upload form calls this as soon
 * as a week is picked so it can say so before the user selects a file.
 */
export async function getWeeklyAttendanceUploadByWeek(weekStart) {
  try {
    const user = await requireSuperAdmin();
    if (!user) return { success: false, data: "null" };

    const weekStartDate = normalizeWeekStart(weekStart);
    if (!weekStartDate) return { success: false, data: "null" };

    await connect();
    const record = await AttendanceUploadModel.findOne({ weekStartDate }).lean();
    return { success: true, data: JSON.stringify(record || null) };
  } catch (error) {
    console.log("Error in getWeeklyAttendanceUploadByWeek function", error);
    return { success: false, data: "null" };
  }
}

/**
 * Store one week's attendance sheet.
 *
 * A week can hold only one live file. Uploading over a week that already has
 * one requires `replace: true` — the old file is kept in `previousFiles` (and
 * in S3) so the record stays a complete history rather than silently losing
 * the sheet it used to point at.
 */
export const saveWeeklyAttendanceUpload = withAudit(
  "AttendanceUpload.save",
  async function ({ weekStart, note, file, replace = false } = {}) {
    let uploadedKey;
    try {
      const user = await requireSuperAdmin();
      if (!user) {
        return { success: false, message: "Not authorized" };
      }

      const weekStartDate = normalizeWeekStart(weekStart);
      if (!weekStartDate) {
        return { success: false, message: "Select the week this sheet covers" };
      }
      // A sheet can only record attendance that has happened, so refuse weeks
      // that have not started yet.
      if (weekStartDate > new Date()) {
        return {
          success: false,
          message: "That week has not started yet",
        };
      }
      const weekEndDate = addDays(weekStartDate, 6);

      const fileError = validateFile(file);
      if (fileError) {
        return { success: false, message: fileError };
      }

      await connect();
      const existing = await AttendanceUploadModel.findOne({ weekStartDate });
      if (existing && !replace) {
        return {
          success: false,
          message:
            "This week's attendance is already uploaded. Choose Replace to upload a new file for it.",
        };
      }

      const uploaded = await uploadImage({
        file,
        path: `attendance/weekly/${weekStartDate.getUTCFullYear()}`,
        access: "private",
      });
      const stored = uploaded?.[0];
      if (!stored) {
        return { success: false, message: "Failed to upload the attendance file" };
      }
      uploadedKey = stored.key;

      const filePayload = {
        originalName: file.name,
        fileName: stored.fileName,
        key: stored.key,
        fileType: file.type || stored.fileType,
        fileSize: file.size || stored.fileSize,
        access: "private",
        uploadedAt: new Date(),
        uploadedBy: isValidObjectId(user._id) ? createObjectId(user._id) : undefined,
        uploadedByName: user.name,
      };

      const trimmedNote = typeof note === "string" ? note.trim() : "";

      if (existing) {
        const previousFile = existing.file;
        existing.previousFiles = [
          ...(previousFile ? [previousFile.toObject?.() ?? previousFile] : []),
          ...(existing.previousFiles || []),
        ];
        existing.file = filePayload;
        existing.note = trimmedNote;
        existing.lastReplacedAt = new Date();
        await existing.save();

        recordAudit({
          entityId: existing._id?.toString(),
          before: { weekStartDate, file: fileSnapshot(previousFile) },
          after: { weekStartDate, file: fileSnapshot(filePayload) },
          description: `Replaced the attendance sheet for the week of ${
            weekStartDate.toISOString().split("T")[0]
          }`,
        });

        return {
          success: true,
          message: "Attendance file replaced successfully",
        };
      }

      const created = await AttendanceUploadModel.create({
        weekStartDate,
        weekEndDate,
        note: trimmedNote,
        file: filePayload,
        uploadedBy: isValidObjectId(user._id) ? createObjectId(user._id) : undefined,
        uploadedByName: user.name,
        uploadedByEmail: user.email,
      });

      recordAudit({
        entityId: created._id?.toString(),
        after: { weekStartDate, file: fileSnapshot(filePayload) },
        description: `Uploaded the attendance sheet for the week of ${
          weekStartDate.toISOString().split("T")[0]
        }`,
      });

      return { success: true, message: "Attendance uploaded successfully" };
    } catch (error) {
      // A duplicate key means another super admin saved the same week between
      // our check and the write — report it as the "already uploaded" case
      // rather than a generic failure.
      const isDuplicate = error?.code === 11000;
      console.log("Error in saveWeeklyAttendanceUpload function", error);

      // Don't leave the just-uploaded object orphaned in S3 when the write failed.
      if (uploadedKey) {
        try {
          await deleteFileFromS3(uploadedKey);
        } catch (cleanupError) {
          console.log("Failed to clean up orphaned attendance file", cleanupError);
        }
      }

      return {
        success: false,
        message: isDuplicate
          ? "This week's attendance was just uploaded by someone else"
          : "Something went wrong while saving the attendance file",
      };
    }
  },
  { module: "AttendanceUpload" }
);
