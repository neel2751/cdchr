"use server";

import { randomUUID } from "node:crypto";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { tenantAssetKey } from "@/lib/tenantAssets";
import { isReadOnly } from "@/lib/tenantContext";
import { withAudit, recordAudit } from "@/lib/audit";
import AnnouncementModel from "@/models/announcementModel";
import RoleBasedModel from "@/models/rolebasedModel";
import {
  assertStorageAllows,
  noteStorageDelta,
} from "@/server/aws/storageGuard";
import {
  deleteFileFromS3,
  generateDownloadUrl,
} from "@/server/aws/upload";
import { getServerSideProps } from "../session/session";
import { getViewer, visibilityFilter } from "./audience";

const MENU_PATH = "/admin/announcements";

// Attachments are read by every recipient, so the ceiling is deliberately lower
// than a general document upload: a 200MB video mailed to 400 people is not an
// announcement, it is a hosting bill.
const MAX_BYTES = 25 * 1024 * 1024;

const fail = (message) => ({ success: false, message });

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
  },
  // Without this the SDK puts a checksum of the *empty* body it signed into
  // every presigned PUT URL (x-amz-checksum-crc32=AAAAAA==), and storage then
  // rejects the real file for not matching it.
  requestChecksumCalculation: "WHEN_REQUIRED",
});

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

/** Strip anything that would make a key sort outside the tenant prefix. */
function safeName(name) {
  return String(name || "file")
    .replace(/[^\w.\- ]+/g, "_")
    .slice(-120);
}

/** Where this company's announcement attachments live, ending in "/". */
const attachmentPrefix = (tenantId) =>
  `${tenantAssetKey({ tenantId, category: "announcements" })}/`;

/**
 * Attachments are uploaded in three steps, because the file does not pass
 * through this server — server actions accept at most 1 MB, and an
 * attachment may be up to 25:
 *
 *   1. startAnnouncementAttachment   checks the author, the size and the
 *                                    storage allowance, and signs a PUT for
 *                                    one exact key
 *   2. the browser PUTs the file straight to storage
 *   3. finishAnnouncementAttachment  checks the object really is there, under
 *                                    this company, at an allowed size, and
 *                                    returns the metadata the form keeps
 *
 * Signed for a key rather than for an announcement, because the form uploads
 * while the author is still writing and the announcement may not exist yet.
 * A file uploaded for a draft that is never saved is orphaned in the bucket
 * and swept by the media tooling, like any other detached file.
 *
 * The storage allowance is checked BEFORE the bytes are written. Without this
 * an announcement is a way around the per-company cap that every other upload
 * path enforces.
 */
export async function startAnnouncementAttachment(data = {}) {
  try {
    const user = await requireAuthor();
    if (!user) return fail("Not authorized");
    const tenantId = user.tenantId;
    if (!tenantId) return fail("No company in context");
    if (await isReadOnly()) return fail("This session is read-only.");

    const fileSize = Number(data.fileSize) || 0;
    if (fileSize <= 0) return fail("That file is empty.");
    if (fileSize > MAX_BYTES) {
      return fail(`Attachments are limited to ${MAX_BYTES / (1024 * 1024)} MB.`);
    }

    const room = await assertStorageAllows(tenantId, fileSize);
    if (!room.allowed) return fail(room.message);

    // The random part keeps the key unguessable and stops two files of the
    // same name overwriting each other.
    const key = `${attachmentPrefix(tenantId)}${randomUUID()}-${safeName(data.fileName)}`;

    // Content type and length are part of the signature, so the PUT must send
    // exactly the file that was checked above.
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        ContentType: String(data.contentType || "") || "application/octet-stream",
        ContentLength: fileSize,
      }),
      { expiresIn: 600 }
    );

    noteStorageDelta(tenantId, fileSize);

    return { success: true, data: JSON.stringify({ url, key }) };
  } catch (error) {
    console.log("Error starting announcement attachment:", error);
    return fail("Could not start the upload");
  }
}

/**
 * Confirm an uploaded attachment and return the metadata the form should keep.
 *
 * Nothing the browser says about the file is believed except its display
 * name: the key must sit under this company's announcements prefix, and the
 * type and size are read back from storage.
 */
export const finishAnnouncementAttachment = withAudit(
  "Announcement.attach",
  async (data = {}) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");
      const tenantId = user.tenantId;
      if (!tenantId) return fail("No company in context");

      const key = String(data.key || "");
      if (!key.startsWith(attachmentPrefix(tenantId)) || key.includes("..")) {
        return fail("That file does not belong to this company.");
      }

      let head;
      try {
        head = await s3.send(
          new HeadObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: key })
        );
      } catch {
        return fail("The upload did not arrive. Try again.");
      }

      const fileSize = Number(head.ContentLength) || 0;
      if (fileSize > MAX_BYTES) {
        await deleteFileFromS3(key).catch(() => {});
        return fail(`Attachments are limited to ${MAX_BYTES / (1024 * 1024)} MB.`);
      }

      const fileName = safeName(data.fileName);
      recordAudit({
        description: `Uploaded announcement attachment ${fileName}`,
      });

      return {
        success: true,
        data: JSON.stringify({
          key,
          fileName,
          fileType: head.ContentType || "application/octet-stream",
          fileSize,
        }),
      };
    } catch (error) {
      console.log("Error finishing announcement attachment:", error);
      return fail("Could not upload the file");
    }
  },
  { module: "Announcement" }
);

/**
 * Remove an attachment that is no longer referenced.
 *
 * Called when the author removes one from the form before saving. Removing it
 * after saving happens through updateAnnouncement, which rewrites the array;
 * the object is then orphaned in the bucket and swept by the media tooling,
 * the same as every other detached file in this app.
 */
export const deleteAnnouncementAttachment = withAudit(
  "Announcement.detach",
  async (key) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");
      if (!key) return fail("No file given");

      // deleteFileFromS3 checks the key belongs to this company before removing
      // it, so a forged key cannot reach another tenant's objects.
      // It also measures the object first and returns the freed bytes to the
      // storage cache, so there is nothing to adjust here.
      const res = await deleteFileFromS3(key);
      if (res?.success === false) return fail(res.message || "Could not delete");

      recordAudit({ description: `Removed announcement attachment ${key}` });

      return { success: true, message: "Attachment removed" };
    } catch (error) {
      console.log("Error deleting announcement attachment:", error);
      return fail("Could not remove the file");
    }
  },
  { module: "Announcement" }
);

/**
 * A short-lived download link for an attachment.
 *
 * Any recipient may fetch one, so this checks the announcement is actually
 * addressed to the caller rather than only that the key belongs to the company
 * — otherwise a staff member could read an attachment on an announcement sent
 * to the board.
 */
export async function getAttachmentUrl(announcementId, key) {
  try {
    if (!isValidObjectId(announcementId) || !key) {
      return fail("Invalid attachment");
    }

    const { props } = await getServerSideProps();
    const sessionUser = props?.session?.user;
    if (!sessionUser?._id) return fail("Not authorized");

    await connect();
    const viewer = await getViewer(
      sessionUser._id,
      sessionUser.role === "siteEmployee" ? "field" : "office"
    );
    if (!viewer) return fail("Not authorized");

    const announcement = await AnnouncementModel.findOne({
      _id: createObjectId(announcementId),
      isDeleted: false,
      "attachments.key": key,
      ...visibilityFilter(viewer),
    })
      .select("_id")
      .lean();

    // An author looking at their own draft is not in its audience, so fall back
    // to the author check rather than refusing them their own attachment.
    if (!announcement) {
      const author = await requireAuthor();
      if (!author) return fail("Attachment not found");
      const owned = await AnnouncementModel.findOne({
        _id: createObjectId(announcementId),
        isDeleted: false,
        "attachments.key": key,
      })
        .select("_id")
        .lean();
      if (!owned) return fail("Attachment not found");
    }

    const res = await generateDownloadUrl({ key });
    if (!res?.success) return fail(res?.message || "Could not open the file");

    return { success: true, data: JSON.stringify({ url: res.url }) };
  } catch (error) {
    console.log("Error opening attachment:", error);
    return fail("Could not open the file");
  }
}
