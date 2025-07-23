"use client";
import mime from "mime";
import { useAvatar } from "@/components/Avatar/AvatarContext";
import { GlobalForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useFetchQuery } from "@/hooks/use-query";
import { useUploader } from "@/hooks/useUploader";
import { decrypt } from "@/lib/algo";
import { generateDownloadUrl } from "@/server/aws/upload";
import {
  deleteEmployeeDocument,
  getEmployeeDocuments,
  uploadDocument,
} from "@/server/officeServer/officeEmployeeDetails";
import {
  ChartSplineIcon,
  DownloadCloudIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  FileIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { SelectFilter } from "@/components/selectFilter/selectFilter";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import Image from "next/image";

export default function EmployeDocument() {
  const [showForm, setShowForm] = useState(false);
  const [filteredDocType, setFilteredDocType] = useState("all");
  const [open, setOpen] = useState(false);
  const { slug } = useAvatar();

  const { data } = useFetchQuery({
    fetchFn: getEmployeeDocuments,
    params: { slug: slug[0] },
    enabled: !!slug?.length,
    queryKey: ["employee-documents", slug[0]],
  });

  const { newData } = data || {};

  // get total docType count
  // Assuming newData is an array of objects with a documentsFiles property
  const docTypeCount =
    newData && newData[0]
      ? newData[0]?.documentsFiles?.reduce((acc, file) => {
          const type = file?.docType || "other"; // Default to 'other' if docType is not defined
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {})
      : {};
  const options = [
    { value: "proofOfIdentification", label: "Proof of Identification" },
    { value: "proofOfAddress", label: "Proof of Address" },
    { value: "proofOfEmployment", label: "Proof of Employment" },
    // Proof of immigration status
    {
      value: "proofOfImmigrationStatus",
      label: "Proof of Immigration Status",
    },
    // HR From
    { value: "hrForm", label: "HR Form" },
    { value: "bankDetails", label: "Bank Details" },
    { value: "proofOfQualification", label: "Proof of Qualification" },
    { value: "proofOfExperience", label: "Proof of Experience" },
    { value: "taxDocument", label: "Tax Document" },
    { value: "medicalRecords", label: "Medical Records" },
    { value: "contractAgreement", label: "Contract Agreement" },
    { value: "other", label: "Other" },
  ];
  // Format the document types with their counts for display
  // This will create an array of objects with value and label properties
  const showName = options.map((option) => {
    const count = docTypeCount[option.value] || 0; // Get the count or default to 0
    return {
      value: option.value,
      label: `${option.label} (${count})`, // Format the label with count
      count: count, // Include count if needed for further processing
    };
  });

  const fields = [
    {
      name: "docType",
      labelText: "Document Type",
      type: "select",
      placeholder: "Select Document Type",
      options: showName, // Use the formatted options with counts
      validationOptions: {
        required: "Document type is required",
      },
    },
    {
      name: "docName",
      labelText: "Document Name",
      type: "text",
      placeholder: "Enter Document Name",
      validationOptions: {
        required: "Document name is required",
        minLength: {
          value: 3,
          message: "Document name must be at least 3 characters long",
        },
      },
    },
    {
      name: "docImage",
      labelText: "Document",
      type: "image",
      placeholder: "Upload Profile Image",
      acceptedFileTypes: {
        "image/*": [".png", ".jpg", ".jpeg"],
        "application/pdf": [".pdf"],
        "application/msword": [".doc", ".docx"],
      },
      maxFileSize: 1024 * 1024 * 10,
      maxFiles: 5,
      size: true,
      validationOptions: {
        required: "At least one document is required",
      },
    },
  ];

  const { progressMap, uploadFile, setProgressMap } = useUploader();

  const { mutate: uploadDocumentMutation } = useSubmitMutation({
    mutationFn: async (docData) => await uploadDocument(docData),
    onSuccessMessage: (message) => message || "Files uploaded successfully.",
    onClose: () => {
      setShowForm(false), setProgressMap({}), setOpen(false);
    }, // Reset progress map on success
    invalidateKey: ["employee-documents", slug[0]],
  });

  const { mutate: deleteDocumentMutation } = useSubmitMutation({
    mutationFn: async (docData) => await deleteEmployeeDocument(docData),
    onSuccessMessage: (message) => message || "Document deleted successfully.",
    onClose: () => {
      setShowForm(false), setProgressMap({});
      setOpen(false);
    }, // Reset progress map on success
    invalidateKey: ["employee-documents", slug[0]],
  });

  const handleSubmit = (data) => {
    const { docType, docName, docImage } = data;

    if (!docImage || docImage.length === 0) {
      console.error("No document uploaded");
      return;
    }

    const employeeId = decrypt(slug[0]);

    const uploadPromises = docImage.map((file) =>
      uploadFile(file, `employee-documents/${employeeId}`, "private")
    );

    Promise.all(uploadPromises)
      .then(async (results) => {
        const uploadedFiles = results.filter((result) => result.success);
        if (uploadedFiles.length > 0) {
          const documentData = {
            employeeId: employeeId,
            docType,
            title: docName,
            documentsFiles: uploadedFiles.map((file) => ({
              title: docName,
              fileName: file.fileName,
              docType: docType,
              key: file.key,
              access: "private",
              fileSize: file.fileSize,
              fileType: file.fileType,
            })),
          };

          uploadDocumentMutation(documentData);
        } else {
          toast.error("No files were uploaded successfully.");
        }
      })
      .catch((error) => {
        console.error("Error uploading files:", error);
        toast.error("An error occurred while uploading files.");
      });
  };

  const handleView = async (key) => {
    const response = await generateDownloadUrl({
      key: key,
      // only for 1 minute to show
      expiresIn: 60, // 1 minute
    });
    if (response) {
      window.open(response.url, "_blank");
    } else {
      toast.error("Failed to generate download URL.");
    }
  };
  const handleDownload = async (key) => {
    const response = await generateDownloadUrl({
      key: key,
      expiresIn: 600, // 10 minutes
    });
    if (response.success) {
      toast.success("Download started successfully.");
      window.open(response.url, "_blank");
    } else {
      toast.error("Failed to generate download URL.");
    }
  };

  const filterData = useMemo(() => {
    if (!newData || newData?.length === 0) return [];
    if (filteredDocType === "all") {
      // we have to send _id
      return newData[0]?.documentsFiles;
    }
    return newData[0]?.documentsFiles.filter(
      (item) => item?.docType === filteredDocType
    );
  }, [filteredDocType, newData]);

  const shwoIcon = useCallback((fileType) => {
    switch (fileType) {
      case "application/pdf":
      case "application/msword":
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      case "application/vnd.ms-excel":
        return <FileTextIcon className="text-gray-600" />;
      case "image/png":
      case "image/jpeg":
      case "image/jpg":
      case "image/gif":
      case "image/webp":
      case "image/svg+xml":
        return <ImageIcon className="text-gray-600" />;
      case "video/mp4":
      case "video/webm":
      case "video/ogg":
        return <FileVideoIcon className="text-gray-600" />;
      default:
        return <FileIcon className="text-gray-600" />;
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <CardTitle>Employee Files</CardTitle>
        <Button
          size="icon"
          variant="secondary"
          onClick={() => setShowForm(!showForm)}
        >
          <PlusIcon
            className={`transition-all duration-500 ${
              showForm ? "rotate-[45deg]" : ""
            } `}
          />
        </Button>
      </div>
      {showForm && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Upload Employee Dcoument</CardTitle>
            </CardHeader>
            <CardContent>
              <GlobalForm
                fields={fields}
                btnName={"Upload"}
                onSubmit={handleSubmit}
              />
            </CardContent>
            {/* UI for Upload progress */}
          </Card>
          <Separator />
        </>
      )}
      <div className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Object.entries(progressMap).map(([name, progress]) => (
            <div key={name} className="space-y-1">
              <div className="font-medium">{name}</div>
              <Progress
                progressClassName={
                  progress === 100 ? "bg-green-500" : "bg-indigo-600"
                }
                value={progress}
              />
              <div className="text-xs text-gray-500">
                {progress === 100 ? "Upload Complete" : `${progress}%`}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border rounded-xl">
        <div className="flex items-center justify-between border-b p-4">
          <CardTitle className="text-indigo-600 ">
            All Document ({(newData && newData[0]?.documentsFiles?.length) || 0}
            )
          </CardTitle>
          <SelectFilter
            value={filteredDocType}
            onChange={setFilteredDocType}
            frameworks={[
              { value: "all", label: "All Document Types" },
              ...showName,
            ]}
            placeholder="Filter by Document Type"
            noData="No Document Type Found"
          />
        </div>
        <div className="px-4 py-2">
          <ScrollArea className="h-96 mt-2 border-gray-300">
            <div className="sm:grid-cols-2 grid grid-cols-1 gap-8">
              {filterData && filterData.length > 0 ? (
                filterData?.map((item, index) => (
                  <div
                    key={index}
                    className="p-3 flex items-center justify-between border rounded-lg hover:bg-gray-50 transition-all duration-300 hover:text-indigo-600"
                  >
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" size="icon">
                        {shwoIcon(item.fileType)}
                      </Button>
                      <div>
                        <CardTitle className="truncate whitespace-nowrap w-48 leading-relaxed">
                          {item.fileName || item?.title || "Untitled Document"}
                        </CardTitle>
                        <CardDescription>
                          <div className="flex space-x-2 h-3 items-center mt-1 text-xs">
                            <span className="text-gray-500">
                              {item.fileSize
                                ? item.fileSize >= 1048576
                                  ? `${(item.fileSize / (1024 * 1024)).toFixed(
                                      2
                                    )} MB`
                                  : item.fileSize >= 1024
                                  ? `${(item.fileSize / 1024).toFixed(2)} KB`
                                  : `${item.fileSize} Bytes`
                                : "Unknown Size"}
                            </span>
                            <Separator
                              orientation="vertical"
                              className="text-indigo-600"
                            />
                            <span className="text-gray-500 w-6 truncate">
                              {item.fileType
                                ? mime.getExtension(item.fileType) ||
                                  "Unknown Type"
                                : "Unknown Type"}
                            </span>
                            <Separator
                              orientation="vertical"
                              className="text-indigo-600"
                            />
                            <span className="text-gray-500">
                              {item.uploadedAt
                                ? new Date(item.uploadedAt).toLocaleDateString()
                                : "Unknown Date"}
                            </span>
                          </div>
                        </CardDescription>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="flex items-center gap-1">
                        <EllipsisVerticalIcon className="text-gray-400 cursor-pointer size-5" />
                        <span className="sr-only">Toggle menu</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onClick={() => handleView(item?.key)}
                          >
                            <EyeIcon />
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDownload(item?.key)}
                          >
                            <DownloadCloudIcon />
                            <span>Download</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <ChartSplineIcon />
                            <span>Usage Report</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <AlertDialog open={open} onOpenChange={setOpen}>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem
                                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                onSelect={(e) => e.preventDefault()} // prevent auto-close on select
                              >
                                <Trash2Icon className="text-rose-600 mr-2" />
                                <span>Delete</span>
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Are you sure you want to delete this document?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This action cannot be undone. Deleting this
                                  document will remove it permanently from the
                                  system.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-rose-600 text-white hover:bg-rose-700"
                                  onClick={() =>
                                    deleteDocumentMutation({
                                      documentId: item._id,
                                      fileKey: item.key,
                                    })
                                  }
                                >
                                  Continue
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))
              ) : (
                <div className="h-96 col-span-2 flex flex-col items-center justify-center bg-gray-50 rounded-lg space-y-1">
                  <Image
                    src="/images/emptyFile.svg"
                    alt="No Data"
                    width={200}
                    height={200}
                    className="opacity-80"
                  />
                  <CardTitle>No documents found.</CardTitle>
                  <CardDescription>
                    You can upload documents by clicking the "+" button above.
                  </CardDescription>
                  {/* <span className="text-gray-500">
                    No documents found for the selected type.
                  </span> */}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
