import { XIcon } from "lucide-react";
import Image from "next/image";
import React from "react";
import { useDropzone } from "react-dropzone";
import { Label } from "../ui/label";

export const FormImageUpload = ({ field, uploadedFiles, setUploadedFiles }) => {
  //   const [uploadedFiles, setUploadedFiles] = React.useState([]);
  // 🔹 Cleanup Object URLs when the component unmounts
  React.useEffect(() => {
    return () =>
      uploadedFiles.forEach((file) => URL.revokeObjectURL(file.preview));
  }, [uploadedFiles]);

  const onDrop = (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;

    const newFiles = acceptedFiles
      .filter(
        (file) =>
          !uploadedFiles.some((existingFile) => existingFile.name === file.name)
      )
      .map((file) =>
        Object.assign(file, { preview: URL.createObjectURL(file) })
      );

    setUploadedFiles((prev) => {
      const updatedFiles =
        field.maxFiles === 1 ? [newFiles[0]] : [...prev, ...newFiles];
      return updatedFiles;
    });
  };

  const handleRemove = (event, index) => {
    event.stopPropagation(); // Prevent Dropzone from opening file manager

    setUploadedFiles((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const renderPreview = (file) => {
    const fileType = file.type;

    if (fileType.startsWith("image/")) {
      // Image file preview
      return (
        <Image
          src={file.preview}
          alt={file.name}
          height={80}
          width={80}
          className="rounded-md border border-gray-200 size-16 object-cover"
        />
      );
    }

    if (fileType.startsWith("video/")) {
      // Video file preview
      return (
        <video controls className="rounded-md border border-gray-200 size-16">
          <source src={file.preview} type={fileType} />
          Your browser does not support the video tag.
        </video>
      );
    }

    if (fileType === "application/pdf") {
      // PDF file preview
      return (
        <embed
          src={file.preview}
          type="application/pdf"
          className="rounded-md border border-gray-200 size-16"
        />
      );
    }

    if (fileType.startsWith("text/")) {
      // Text file preview
      return (
        <iframe
          src={file.preview}
          title={file.name}
          className="rounded-md border border-gray-200 size-16"
        />
      );
    }

    // Fallback for other file types
    return (
      <div className="size-16 flex items-center justify-center bg-gray-200">
        {file.name}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={field.labelText}>{field.labelText}</Label>
      <Dropzone
        onDrop={onDrop}
        accept={field?.acceptedFileTypes}
        maxSize={field?.maxFileSize}
        maxFiles={field?.maxFiles}
      >
        {({ fileRejections, isDragActive }) => (
          <div
            className={`border-2 border-dashed rounded-md p-5 text-center cursor-pointer ${
              isDragActive ? "border-primary" : "border-gray-300"
            }`}
          >
            {uploadedFiles.length > 0 ? (
              <div className="flex flex-wrap gap-4">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="relative group">
                    {renderPreview(file)}
                    {/* <img
                            src={file.preview}
                            alt="Uploaded"
                            className="h-20 w-20 border border-indigo-500 rounded-lg"
                          /> */}
                    <Button
                      type="button"
                      className="absolute size-5 rounded-full bg-rose-600 hover:bg-rose-700 -right-1 -top-1"
                      size="icon"
                      onClick={(event) => handleRemove(event, index)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                {isDragActive
                  ? "Drop the file here"
                  : `Drag & drop ${
                      field.maxFiles > 1 ? "files" : "a file"
                    } here, or click to select`}
              </p>
            )}
            {console.log(fileRejections)}
            {fileRejections.length > 0 && (
              <div className="text-red-500">
                {fileRejections.map((rejection, index) => (
                  <p key={index}>{rejection.errors[0].message}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </Dropzone>
    </div>
  );
};

const Dropzone = ({
  children,
  accept = { "image/*": [] },
  maxSize,
  maxFiles,
  onDrop,
}) => {
  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      accept,
      maxSize,
      maxFiles,
      onDrop,
    });

  return (
    <div {...getRootProps()} className="">
      <input {...getInputProps()} />
      {children({ isDragActive, fileRejections })}
    </div>
  );
};
