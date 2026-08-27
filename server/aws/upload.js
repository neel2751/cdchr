"use server";
import * as AWS from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerSideProps } from "../session/session";
import axios from "axios";
import { generateRandomFileName } from "@/utils/generateRandomFileName";
import {
  assertKeyOwnedByTenant,
  tenantAssetKey,
} from "@/lib/tenantAssets";
import {
  assertStorageAllows,
  noteStorageDelta,
} from "./storageGuard";

const S3 = new AWS.S3({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
  },
});
const Bucket = process.env.AWS_BUCKET_NAME;

/**
 * Where a company's objects live in the bucket.
 *
 * Keys were `<employeeId>/<file>`, which puts every company's documents in one
 * flat namespace. A tenant prefix makes per-company export and deletion a
 * prefix operation, and lets a bucket policy or lifecycle rule target one
 * company. Objects written before this keep their old keys and are still read
 * by their stored URL — this only shapes new writes.
 */
async function tenantScopedKey(employeeId, fileName, category = "documents") {
  const { props } = await getServerSideProps();
  const tenantId = props?.session?.user?.tenantId;
  if (!tenantId) {
    // Without a company there is nowhere isolated to put the object, and a
    // shared namespace is what this exists to prevent.
    throw new Error("Cannot store a file without a company in context");
  }
  return tenantAssetKey({ tenantId, category, parts: [employeeId, fileName] });
}


export const uploadAWSMultipartDocument = async (file) => {
  const { props } = await getServerSideProps();
  const { _id: employeeId, tenantId } = props?.session?.user;

  const room = await assertStorageAllows(tenantId, file?.size || 0);
  if (!room.allowed) return { success: false, message: room.message };

  const params = {
    Bucket,
    Key: await tenantScopedKey(employeeId, file.name),
    ContentType: file.type,
    ACL: "private", // or "public-read" if needed
  };
  const command = new AWS.CreateMultipartUploadCommand(params);
  const { UploadId } = await S3.send(command);

  noteStorageDelta(tenantId, file?.size || 0);

  return { uploadId: UploadId };
};

export const getPresignedURLAWS = async (uploadId, partNumber, fileName) => {
  const { props } = await getServerSideProps();
  const { _id: employeeId } = props?.session?.user;
  const params = {
    Bucket,
    Key: await tenantScopedKey(employeeId, fileName),
    PartNumber: partNumber,
    UploadId: uploadId,
  };
  const putObjectCommand = new AWS.UploadPartCommand(params);
  const SignedURL = await getSignedUrl(S3, putObjectCommand, {
    expiresIn: 3600, // 1 hour
  });
  return { url: SignedURL };
};

export const completeUploadAwsMultipartDocument = async (
  uploadId,
  parts,
  fileName
) => {
  try {
    const { props } = await getServerSideProps();
    const { _id: employeeId } = props?.session?.user;
    const params = {
      Bucket,
      Key: await tenantScopedKey(employeeId, fileName),
      MultipartUpload: {
        Parts: parts,
      },
      UploadId: uploadId,
    };
    const command = new AWS.CompleteMultipartUploadCommand(params);
    const { Location } = await S3.send(command);
    console.log(Location);
  } catch (error) {
    console.log(error);
  }
};

export const listParts = async (uploadId, fileName) => {
  const { props } = await getServerSideProps();
  const { _id: employeeId } = props?.session?.user;
  const params = {
    Bucket,
    Key: await tenantScopedKey(employeeId, fileName),
    UploadId: uploadId,
  };

  const response = await S3.send(new AWS.ListPartsCommand(params));
  console.log("AWS Uploaded Parts:", response.Parts);
};

export const uploadToAws = async (file) => {
  try {
    // if (typeof files === "object") {
    const data = await generatePreSignedURL(file);
    return data;
    // }
    // upload multiple files
    // const multipleUpload = files.map(async (file) => {
    //   return await generatePreSignedURL(file);
    // });
    // const data = await Promise.all(multipleUpload);
    // return data;
  } catch (error) {
    console.log(error);
  }
};

export const generatePreSignedURL = async (file) => {
  const { props } = await getServerSideProps();
  const { _id: employeeId } = props?.session?.user;
  const params = {
    Bucket,
    Key: await tenantScopedKey(employeeId, file.name),
    ContentType: file.type,
  };
  const putObjectCommand = new AWS.PutObjectCommand(params);

  const signedUrl = await getSignedUrl(S3, putObjectCommand, {
    expiresIn: 60,
  });
  if (signedUrl) {
    return uploadFileOnSignedUrl(file, signedUrl);
  }
};

const uploadFileOnSignedUrl = async (file, signedUrl) => {
  try {
    // const options = {
    //   headers: {
    //     "Content-Type": file.type,
    //   },
    // };
    // const formData = new FormData();
    // formData.append("file", file);
    // const response = await axios.put(signedUrl, formData, options);
    // console.log(response);
    const response = await fetch(signedUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type,
      },
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(error);
  }
};

/**
 * A signed PUT for a browser upload.
 *
 * `path` used to be written into the key verbatim, so a caller chose where the
 * object landed — including inside another company's prefix. It is now only a
 * category *within* the caller's own prefix.
 */
export async function generatePreSignedUrl({
  path,
  fileName,
  access = "private",
  contentType,
  fileSize = 0,
}) {
  try {
    const validAccessTypes = ["public", "private"];
    if (!validAccessTypes.includes(access)) {
      throw new Error("Invalid access type. Use 'public' or 'private'.");
    }
    if (!fileName || !contentType) {
      throw new Error("File name and content type are required.");
    }

    const { props } = await getServerSideProps();
    const tenantId = props?.session?.user?.tenantId;
    if (!tenantId) {
      throw new Error("Cannot store a file without a company in context");
    }

    // Checked before the URL is handed out: once a signed PUT exists the bytes
    // are already authorised, and refusing afterwards means deleting them.
    const room = await assertStorageAllows(tenantId, fileSize);
    if (!room.allowed) {
      return { success: false, message: room.message };
    }

    const key = tenantAssetKey({
      tenantId,
      category: path || "uploads",
      parts: [fileName],
    });

    const params = {
      Bucket,
      Key: key,
      ContentType: contentType,
    };
    const command = new AWS.PutObjectCommand(params);
    const url = await getSignedUrl(S3, command, {
      expiresIn: 3600, // URL valid for 1 hour
    });

    // The upload is now permitted, so count it. A signed URL that goes unused
    // over-counts slightly until the next measurement, which is the safe
    // direction to be wrong in.
    noteStorageDelta(tenantId, fileSize);

    return { success: true, url, fileName, key };
  } catch (error) {
    console.error("Error generating pre-signed URL:", error);
    return {
      success: false,
      message: "Failed to generate pre-signed URL",
    };
  }
}

export async function createMultipartUpload({
  fileName,
  contentType,
  path = "uploads",
  access = "private",
  fileSize = 0,
}) {
  try {
    const validAccessTypes = ["public", "private"];
    if (!validAccessTypes.includes(access)) {
      throw new Error("Invalid access type. Use 'public' or 'private'.");
    }
    if (!fileName || !contentType) {
      throw new Error("File name and content type are required.");
    }
    const { props } = await getServerSideProps();
    const tenantId = props?.session?.user?.tenantId;
    if (!tenantId) {
      throw new Error("Cannot store a file without a company in context");
    }

    const room = await assertStorageAllows(tenantId, fileSize);
    if (!room.allowed) {
      return { success: false, message: room.message };
    }

    // `path` was only ever placed in a `path:` property, which is not an S3
    // parameter and was dropped by the SDK — so every multipart upload landed
    // at the bucket root, unprefixed, whatever the caller asked for.
    const key = tenantAssetKey({
      tenantId,
      category: path || "uploads",
      parts: [generateRandomFileName(fileName)],
    });

    const params = {
      Bucket,
      Key: key,
      ContentType: contentType,
    };
    const command = new AWS.CreateMultipartUploadCommand(params);
    const response = await S3.send(command);
    noteStorageDelta(tenantId, fileSize);

    return {
      success: true,
      uploadId: response.UploadId,
      key: response.Key,
    };
  } catch (error) {
    console.error("Error creating multipart upload:", error);
    return {
      success: false,
      message: "Failed to create multipart upload",
    };
  }
}

// make one universal upload function for all types of files
export async function uploadImage({ file, path, access = "private" }) {
  if (!file) return null;
  const { props } = await getServerSideProps();
  const { _id: employeeId } = props?.session?.user;

  const files = Array.isArray(file) ? file : [file];

  const uploaded = await Promise.all(
    files.map(async (f) => {
      const fileName = generateRandomFileName(f.name);
      const { url, key, success, message } = await generatePreSignedUrl({
        fileName: fileName,
        contentType: f.type,
        path,
        access,
        fileSize: f.size,
      });

      // Refused by the storage allowance — surfaced rather than swallowed, so
      // the caller can tell the user why nothing was stored.
      if (success === false) throw new Error(message || "Upload refused");

      try {
        const res = await axios.put(url, f, {
          headers: { "Content-Type": f.type },
        });

        if (res.status === 200) {
          return {
            key,
            access,
            fileName,
            fileSize: f.size,
            fileType: f.type,
            uploadedAt: new Date(),
            uploadedBy: employeeId,
          };
        } else {
          console.error(`Failed to upload ${f.name}`);
          return null;
        }
      } catch (err) {
        console.error(`Upload error for ${f.name}:`, err);
        return null;
      }
    })
  );

  // Filter out failed uploads
  return uploaded.filter((f) => f !== null);
}

/**
 * Remove one object. Same reasoning as generateDownloadUrl, with more at stake:
 * unchecked, this deleted any object in the bucket.
 */
export async function deleteFileFromS3(key) {
  try {
    const safeKey = await assertKeyOwnedByTenant(key);
    const params = {
      Bucket,
      Key: safeKey,
    };
    // Size before removal, so the cached usage can be reduced by it.
    let freed = 0;
    try {
      const head = await S3.send(
        new AWS.HeadObjectCommand({ Bucket, Key: safeKey })
      );
      freed = head?.ContentLength || 0;
    } catch {
      // Not fatal: the figure is re-measured on its own schedule.
    }

    const command = new AWS.DeleteObjectCommand(params);
    await S3.send(command);

    const { props } = await getServerSideProps();
    noteStorageDelta(props?.session?.user?.tenantId, -freed);

    return { success: true, message: "File deleted successfully" };
  } catch (error) {
    console.error("Error deleting file from S3:", error);
    return { success: false, message: "Failed to delete file" };
  }
}

/**
 * A time-limited link to one object.
 *
 * The key arrives from the browser — file lists hand it out — so ownership is
 * checked before anything is signed. Without that, this signs whatever it is
 * given using the server's credentials, which is a read of any object in the
 * bucket by anyone with an account.
 */
export async function generateDownloadUrl({ key, expiresIn = 3600 }) {
  try {
    const safeKey = await assertKeyOwnedByTenant(key);
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: safeKey,
    };
    const command = new AWS.GetObjectCommand(params);
    const url = await getSignedUrl(S3, command, { expiresIn });
    return {
      success: true,
      url,
    };
  } catch (error) {
    console.error("Error generating download URL:", error);
    return {
      success: false,
      message: "Failed to generate download URL",
    };
  }
}

/**
 * A direct bucket URL for an object.
 *
 * Ownership is checked even though this only builds a string: the object may be
 * publicly readable, and echoing an arbitrary key back is the same class of
 * mistake as signing one.
 */
export async function getPublicUrl({ key }) {
  if (!key) {
    return {
      success: false,
      message: "Key is required to generate public URL",
    };
  }
  try {
    const safeKey = await assertKeyOwnedByTenant(key);
    const url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${safeKey}`;
    return { success: true, url };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
