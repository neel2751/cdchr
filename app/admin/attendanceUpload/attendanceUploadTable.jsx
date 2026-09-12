"use client";

import { useState } from "react";
import { format } from "date-fns";
import { EyeIcon, FileTextIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCommonContext } from "@/context/commonContext";
import { formatBytes } from "@/lib/utils";
import AttendanceUploadDetails, {
  DownloadFileButton,
} from "./attendanceUploadDetails";
import { weekLabel } from "./uploadAttendanceDialog";

export default function AttendanceUploadTable() {
  const { result = [] } = useCommonContext();
  const [selected, setSelected] = useState(null);

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Uploaded by</TableHead>
              <TableHead>Uploaded on</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.map((record) => (
              <TableRow key={record._id}>
                <TableCell className="font-medium whitespace-nowrap">
                  {weekLabel(record.weekStartDate, record.weekEndDate)}
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <span className="flex items-center gap-2">
                    <FileTextIcon className="size-4 shrink-0 text-neutral-400" />
                    <span className="truncate">
                      {record.file?.originalName || "—"}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-neutral-500">
                  {formatBytes(record.file?.fileSize)}
                </TableCell>
                <TableCell>{record.uploadedByName || "—"}</TableCell>
                <TableCell className="text-neutral-500 whitespace-nowrap">
                  {record.createdAt
                    ? format(new Date(record.createdAt), "dd MMM yyyy")
                    : "—"}
                </TableCell>
                <TableCell>
                  {record.previousFiles?.length ? (
                    <Badge variant="secondary">
                      Replaced ×{record.previousFiles.length}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Uploaded</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                      onClick={() => setSelected(record)}
                    >
                      <EyeIcon className="size-4" />
                      Details
                    </Button>
                    <DownloadFileButton file={record.file} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AttendanceUploadDetails
        record={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
