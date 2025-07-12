"use client";
import { generatePreSignedUrl } from "@/server/aws/upload";
import { generateRandomFileName } from "@/utils/generateRandomFileName";
import axios from "axios";
import { useState } from "react";

export function useUploader() {
  const [progressMap, setProgressMap] = useState({});
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const generateFileId = (fileName) => `${Date.now()}-${fileName}`;

  const uploadFile = async (file, path = "uploads", access = "private") => {
    if (file.size > 20 * 1024 * 1024) {
      console.log("File size exceeds 20MB, using multipart upload");
      return await uploadInChunks(file, path, access);
    } else {
      console.log("File size is within limit, using direct upload");
      return await uploadDirect(file, path, access);
    }
  };

  const uploadDirect = async (file, path = "uploads", access = "private") => {
    const { url, key } = await generatePreSignedUrl({
      fileName: generateRandomFileName(file.name),
      contentType: file.type,
      path,
      access,
    });

    try {
      const response = await axios.put(url, file, {
        headers: {
          "Content-Type": file.type,
        },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setProgressMap((prev) => ({ ...prev, [key]: progress }));
        },
      });

      if (response.status === 200) {
        return { success: true, key, url };
      } else {
        throw new Error("Upload failed");
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      return { success: false, error: error.message };
    }
  };

  const uploadInChunks = async (file, path = "uploads", access = "private") => {
    console.log("Starting multipart upload for file:", file.name);
    const { uploadId, key } = await createMultipartUpload({
      fileName: file.name,
      contentType: file.type,
      path,
      access,
    });
    return await uploadFileParts(file, uploadId, key);
  };

  const uploadFileParts = async (file, uploadId, key) => {
    const chunkSize = 5 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);
    const parts = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      try {
        const presignedUrl = await getChuckPresignedUrl({
          key,
          uploadId,
          partNumber: i + 1,
        });
        console.log(
          `Uploading part ${i + 1}/${totalChunks} to ${presignedUrl}`
        );

        const response = await axios.put(presignedUrl, chunk, {
          headers: {
            "Content-Type": file.type,
          },
          onUploadProgress: (progressEvent) => {
            const percent = Math.round(
              ((i + progressEvent.loaded / progressEvent.total) / totalChunks) *
                100
            );
            setProgressMap((prev) => ({ ...prev, [file.name]: percent }));
          },
        });

        parts.push({
          ETag: response.headers.etag?.replace(/"/g, ""),
          PartNumber: i + 1,
        });
      } catch (error) {
        console.error("Error uploading part:", error);
        return { success: false, error: error.message };
      }
    }

    // ✅ Finish multipart
    return await completeMultipartUploadFn(file, uploadId, key, parts);
  };

  const completeMultipartUploadFn = async (file, uploadId, key, parts) => {
    try {
      const response = await completeMultipartUpload({
        uploadId,
        parts,
        key,
      });

      if (response.success) {
        setProgressMap((prev) => ({ ...prev, [file.name]: 100 }));
        return {
          success: true,
          fileId: generateFileId(file.name),
          key,
          url: response.url,
        };
      } else {
        throw new Error("Failed to complete multipart upload");
      }
    } catch (error) {
      console.error("Error completing multipart upload:", error);
      return { success: false, error: error.message };
    }
  };

  const uploadFiles = async (fileList) => {
    setIsUploading(true);
    const uploadPromises = fileList.map((file) =>
      uploadFile(file, path, access)
    );
    const results = await Promise.all(uploadPromises);
    setFiles((prev) => [...prev, ...results]);
    setIsUploading(false);
    return results;
  };

  const cancelUpload = () => {
    setIsUploading(false);
    setProgressMap({});
    setFiles([]);
  };

  return {
    uploadFile,
    uploadFiles,
    cancelUpload,
    progressMap,
    files,
    isUploading,
  };
}
