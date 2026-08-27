import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { tenantAssetKey } from "@/lib/tenantAssets";
import { generateRandomFileName } from "@/utils/generateRandomFileName";

/**
 * Storing a company's branding images.
 *
 * Not a "use server" module: it takes a tenant id and trusts it, exactly like
 * tenantOps.js. Authorisation belongs to the caller, which checks membership
 * before calling in.
 */

export const ALLOWED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
];

// A logo is shown on every page; anything larger is a mistake rather than a
// requirement, and the limit also caps what an upload can cost.
export const MAX_LOGO_BYTES = 1024 * 1024;

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
  },
});

/**
 * Write a logo into the company's branding prefix.
 * @returns {{ success: boolean, url?: string, message?: string }} a
 * first-party URL, never an S3 one — see app/api/asset/[...key]/route.js.
 */
export async function storeTenantLogo(tenantId, file) {
  try {
    const key = tenantAssetKey({
      tenantId,
      category: "branding",
      // Randomised so replacing a logo busts any cached copy of the old one.
      parts: [generateRandomFileName(file.name || "logo")],
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        Body: Buffer.from(await file.arrayBuffer()),
        ContentType: file.type,
      })
    );

    return { success: true, url: `/api/asset/${key}` };
  } catch (error) {
    console.log("storeTenantLogo error:", error?.message);
    return { success: false, message: "Could not store the logo" };
  }
}

/**
 * How much space one company occupies.
 *
 * Only possible now that every key is prefixed: before this, a company's
 * objects were scattered through a shared namespace with no way to total them.
 * Makes `limits.maxStorageBytes` enforceable the same way `maxEmployees`
 * already is.
 */
export async function tenantStorageUsage(tenantId) {
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  let token;
  let bytes = 0;
  let objects = 0;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: process.env.AWS_BUCKET_NAME,
        Prefix: `tenants/${tenantId}/`,
        ContinuationToken: token,
        MaxKeys: 1000,
      })
    );
    for (const o of res.Contents || []) {
      bytes += o.Size || 0;
      objects++;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return { bytes, objects };
}
