import { useCallback, useEffect, useRef, useState } from "react";

export function useImageUpload({ onUpload }) {
  const previewRef = useRef(null);
  const fileInputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Dummy upload function that simulates a delay and returns the local preview URL
  const dummyUpload = async (file, localUrl) => {
    try {
      setUploading(true);
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Simulate random upload errors (20% chance)
      if (Math.random() < 0.2) {
        throw new Error("Upload failed - This is a demo error");
      }

      setError(null);
      // In a real implementation, this would be the URL from the server
      return localUrl;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Upload failed";
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      if (file) {
        setFileName(file.name);
        const localUrl = URL.createObjectURL(file);
        setPreviewUrl(localUrl);
        previewRef.current = localUrl;

        try {
          const uploadedUrl = await dummyUpload(file, localUrl);
          onUpload?.(uploadedUrl);
        } catch (err) {
          URL.revokeObjectURL(localUrl);
          setPreviewUrl(null);
          setFileName(null);
          return console.error(err);
        }
      }
    },
    [onUpload]
  );

  const handleRemove = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setFileName(null);
    previewRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setError(null);
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
      }
    };
  }, []);

  return {
    previewUrl,
    fileName,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    handleRemove,
    uploading,
    error,
  };
}
