"use server";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { connect } from "@/db/db";
import { createObjectId, isValidObjectId } from "@/lib/mongodb";
import { tenantAssetKey } from "@/lib/tenantAssets";
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

/**
 * Store one attachment and return the metadata the form should keep.
 *
 * Uploaded through the server rather than a browser-signed PUT because the
 * announcement may not exist yet — the form uploads while the author is still
 * writing — and a signed URL handed to the browser is authorised before we know
 * whether the draft will ever be saved.
 *
 * The storage allowance is checked BEFORE the bytes are written. Without this
 * an announcement is a way around the per-company cap that every other upload
 * path enforces.
 *
 * @param {FormData} formData with a "file" entry
 */
export const uploadAnnouncementAttachment = withAudit(
  "Announcement.attach",
  async (formData) => {
    try {
      const user = await requireAuthor();
      if (!user) return fail("Not authorized");

      const tenantId = user.tenantId;
      if (!tenantId) return fail("No company in context");

      const file = formData?.get?.("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return fail("No file received");
      }
      if (file.size > MAX_BYTES) {
        return fail(
          `Attachments are limited to ${MAX_BYTES / (1024 * 1024)} MB.`
        );
      }

      const room = await assertStorageAllows(tenantId, file.size || 0);
      if (!room.allowed) return fail(room.message);

      const fileName = safeName(file.name);
      const key = tenantAssetKey({
        tenantId,
        category: "announcements",
        // Prefixed with a timestamp so two files of the same name do not
        // overwrite each other.
        parts: [`${Date.now()}-${fileName}`],
      });

      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: key,
          Body: Buffer.from(await file.arrayBuffer()),
          ContentType: file.type || "application/octet-stream",
        })
      );

      noteStorageDelta(tenantId, file.size || 0);

      recordAudit({
        description: `Uploaded announcement attachment ${fileName}`,
      });

      return {
        success: true,
        data: JSON.stringify({
          key,
          fileName,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size || 0,
        }),
      };
    } catch (error) {
      console.log("Error uploading announcement attachment:", error);
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
