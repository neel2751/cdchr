import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { tenantAssetKey } from "@/lib/tenantAssets";
import { generateRandomFileName } from "@/utils/generateRandomFileName";
import { assertStorageAllows, noteStorageDelta } from "./storageGuard";

/**
 * Storing an employee's own photo.
 *
 * Not a "use server" module, for the same reason as branding.js: it takes a
 * tenant id and trusts it. Whoever calls in has already established whose photo
 * this is — here, the session's own employee record and nobody else's.
 *
 * Avatars live under `tenants/<id>/avatars/` and stay **private**. They are not
 * added to PUBLIC_CATEGORIES in app/api/asset/[...key]/route.js, and should not
 * be: an avatar only ever renders to somebody signed into the same company, so
 * the session check costs nothing, whereas "public" would mean anyone holding
 * the URL can fetch a photograph of a member of staff indefinitely, with no way
 * to withdraw it. Widen that list only if avatars ever have to appear before
 * sign-in — nothing needs that today.
 */

export const ALLOWED_AVATAR_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

// The browser squares and re-encodes the image before it gets here, so a file
// anywhere near this is one that skipped that step. The cap is what stops an
// original camera photo — 8 MB and rising — being stored per employee.
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
  },
});

/**
 * Write a photo into the company's avatar prefix.
 *
 * @param {string} tenantId
 * @param {File} file
 * @returns {Promise<{ success: boolean, key?: string, url?: string, size?: number, message?: string }>}
 */
export async function storeEmployeeAvatar(tenantId, file) {
  try {
    const size = file?.size || 0;
    const room = await assertStorageAllows(tenantId, size);
    if (!room.allowed) return { success: false, message: room.message };

    const key = tenantAssetKey({
      tenantId,
      category: "avatars",
      // Randomised, so replacing a photo cannot be served from a cached copy of
      // the old one — the URL itself changes.
      parts: [generateRandomFileName(file.name || "avatar.jpg")],
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        Body: Buffer.from(await file.arrayBuffer()),
        ContentType: file.type,
      })
    );

    noteStorageDelta(tenantId, size);

    return { success: true, key, url: `/api/asset/${key}`, size };
  } catch (error) {
    console.log("storeEmployeeAvatar error:", error?.message);
    return { success: false, message: "Could not store the photo" };
  }
}
