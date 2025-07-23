"use server";
import * as AWS from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerSideProps } from "../session/session";
import axios from "axios";
import { generateRandomFileName } from "@/utils/generateRandomFileName";

const S3 = new AWS.S3({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_PORTAL_KEY,
  },
});
const Bucket = process.env.AWS_BUCKET_NAME;

export const uploadAWSMultipartDocument = async (file) => {
  const { props } = await getServerSideProps();
  const { _id: employeeId } = props?.session?.user;
  const params = {
    Bucket,
    Key: `${employeeId}/${file.name}`,
    ContentType: file.type,
    ACL: "private", // or "public-read" if needed
  };
  const command = new AWS.CreateMultipartUploadCommand(params);
  const { UploadId } = await S3.send(command);

  return { uploadId: UploadId };
};

export const getPresignedURLAWS = async (uploadId, partNumber, fileName) => {
  const { props } = await getServerSideProps();
  const { _id: employeeId } = props?.session?.user;
  const params = {
    Bucket,
    Key: `${employeeId}/${fileName}`,
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
      Key: `${employeeId}/${fileName}`,
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
    Key: `${employeeId}/${fileName}`,
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
    Key: `${employeeId}/${file.name}`,
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

export const generatePreSignedGetURL = async (key) => {
  const params = {
    Bucket,
    Key: key,
  };
  const command = new AWS.GetObjectCommand(params);
  const signedUrl = await getSignedUrl(S3, command, {
    expiresIn: 60,
  });
  console.log(signedUrl);
};

export async function generatePreSignedUrl({
  path,
  fileName,
  access = "private",
  contentType,
}) {
  try {
    const validAccessTypes = ["public", "private"];
    if (!validAccessTypes.includes(access)) {
      throw new Error("Invalid access type. Use 'public' or 'private'.");
    }
    if (!fileName || !contentType) {
      throw new Error("File name and content type are required.");
    }
    if (!path) {
      path = "uploads"; // Default path if not provided
    }
    if (access === "public" && !path.startsWith("public")) {
      path = `public/${path}`;
    }

    const params = {
      Bucket,
      Key: `${path}/${fileName}`,
      ContentType: contentType,
    };
    const command = new AWS.PutObjectCommand(params);
    const url = await getSignedUrl(S3, command, {
      expiresIn: 3600, // URL valid for 1 hour
    });

    return {
      success: true,
      url,
      fileName,
      key: `${path}/${fileName}`,
    };
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
}) {
  try {
    const validAccessTypes = ["public", "private"];
    if (!validAccessTypes.includes(access)) {
      throw new Error("Invalid access type. Use 'public' or 'private'.");
    }
    if (!fileName || !contentType) {
      throw new Error("File name and content type are required.");
    }
    if (!path) {
      path = "uploads"; // Default path if not provided
    }
    if (access === "public" && !path.startsWith("public")) {
      path = `public/${path}`;
    }
    // Generate a random file name to avoid conflicts
    const key = generateRandomFileName(fileName);
    const params = {
      Bucket,
      path: `${path}/${key}`,
      Key: key,
      ContentType: contentType,
    };
    console.log("Creating multipart upload with params:", params);
    // Log the S3 client configuration
    const command = new AWS.CreateMultipartUploadCommand(params);
    const response = await S3.send(command);
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
      const { url, key } = await generatePreSignedUrl({
        fileName: fileName,
        contentType: f.type,
        path,
        access,
      });

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

export async function deleteFileFromS3(key) {
  try {
    const params = {
      Bucket,
      Key: key,
    };
    const command = new AWS.DeleteObjectCommand(params);
    await S3.send(command);
    return { success: true, message: "File deleted successfully" };
  } catch (error) {
    console.error("Error deleting file from S3:", error);
    return { success: false, message: "Failed to delete file" };
  }
}

export async function generateDownloadUrl({ key, expiresIn = 3600 }) {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
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
