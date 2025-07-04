"use client";
import {
  ChartSplineIcon,
  DownloadCloudIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  FileTextIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { GlobalForm } from "../form/form";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";
import { ScrollArea } from "../ui/scroll-area";
import { useState } from "react";

export default function EmployeeFiles() {
  const [showForm, setShowForm] = useState(false);
  const fields = [
    {
      name: "docImage",
      labelText: "Document",
      type: "image",
      placeholder: "Upload Profile Image",
      acceptedFileTypes: {
        "image/*": [".png", ".jpg", ".jpeg"],
        "application/pdf": [".pdf"],
      },
      maxFileSize: 1024 * 1024 * 2,
      maxFiles: 2,
      size: true,
      validationOptions: {
        required: "At least one document is required",
      },
    },
  ];

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
            className={`transition-all duration-700 ${
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
              <GlobalForm fields={fields} btnName={"Upload"} />
            </CardContent>
          </Card>
          <Separator />
        </>
      )}

      <div className="border rounded-xl">
        <CardTitle className="text-indigo-600 p-4 border-b">
          All Document (11)
        </CardTitle>
        <div className="px-4 py-2">
          <ScrollArea className="h-96 mt-2 border-gray-300">
            <div className="sm:grid-cols-2 grid grid-cols-1 gap-8">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((_, index) => (
                <Card key={index} className="bg-white p-2">
                  <div className="p-2 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" size="icon">
                        <FileTextIcon />
                      </Button>
                      <div>
                        <CardTitle className="truncate whitespace-nowrap w-40 leading-relaxed">
                          Fileeeyehgegxhbdgshshhdhsgevdgdbdg
                        </CardTitle>
                        <CardDescription>
                          <div className="flex space-x-2 h-3 items-center mt-1 text-xs">
                            <span className="text-gray-500">1.5MB</span>
                            <Separator
                              orientation="vertical"
                              className="text-indigo-600"
                            />
                            <span className="text-gray-500">pdf</span>
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
                          <DropdownMenuItem>
                            <EyeIcon />
                            <span>View</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <DownloadCloudIcon />
                            <span>Download</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <ChartSplineIcon />
                            <span>Usage Report</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-rose-600">
                            <Trash2Icon />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
