"use server";
import * as AWS from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerSideProps } from "../session/session";

const S3 = new AWS.S3({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_ID,
    secretAccessKey: process.env.AWS_ACCESS_KEY,
  },
});

export const uploadAWSMultipartDocument = async (file) => {
  const { props } = await getServerSideProps();
  const { _id: employeeId } = props?.session?.user;
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
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
    Bucket: process.env.AWS_BUCKET_NAME,
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
      Bucket: process.env.AWS_BUCKET_NAME,
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
    Bucket: process.env.AWS_BUCKET_NAME,
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
    Bucket: process.env.AWS_BUCKET_NAME,
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
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
  };
  const command = new AWS.GetObjectCommand(params);
  const signedUrl = await getSignedUrl(S3, command, {
    expiresIn: 60,
  });
  console.log(signedUrl);
};
