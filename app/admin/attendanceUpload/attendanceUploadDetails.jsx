"use client";

import { useState } from "react";
import { format } from "date-fns";
import { DownloadIcon, FileTextIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatBytes } from "@/lib/utils";
import { generateDownloadUrl } from "@/server/aws/upload";
import { weekLabel } from "./uploadAttendanceDialog";

const dateTime = (value) =>
  value ? format(new Date(value), "dd MMM yyyy, HH:mm") : "—";

/**
 * Opens a stored sheet through a short-lived signed URL. The bucket is private,
 * so there is no durable link to put in the table.
 */
export function DownloadFileButton({ file, variant = "outline", label }) {
  const [isLoading, setIsLoading] = useState(false);

  const handleDownload = async () => {
    if (!file?.key) {
      toast.error("This record has no file attached");
      return;
    }
    setIsLoading(true);
    try {
      const response = await generateDownloadUrl({ key: file.key, expiresIn: 600 });
      if (response?.success && response?.url) {
        window.open(response.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error(response?.message || "Could not download the file");
      }
    } catch (error) {
      toast.error("Could not download the file");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant={variant}
      size="sm"
      className="gap-2"
      disabled={isLoading}
      onClick={handleDownload}
    >
      {isLoading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <DownloadIcon className="size-4" />
      )}
      {label ?? "Download"}
    </Button>
  );
}

const Row = ({ label, children }) => (
  <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
    <dt className="text-neutral-500">{label}</dt>
    <dd className="col-span-2 text-neutral-900">{children}</dd>
  </div>
);

export default function AttendanceUploadDetails({ record, onClose }) {
  if (!record) return null;

  const previousFiles = record.previousFiles || [];

  return (
    <Dialog open={!!record} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Weekly attendance</DialogTitle>
          <DialogDescription>
            {weekLabel(record.weekStartDate, record.weekEndDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <dl className="divide-y">
            <Row label="Week">
              {weekLabel(record.weekStartDate, record.weekEndDate)}
            </Row>
            <Row label="Uploaded by">
              {record.uploadedByName || "—"}
              {record.uploadedByEmail ? (
                <span className="block text-xs text-neutral-500">
                  {record.uploadedByEmail}
                </span>
              ) : null}
            </Row>
            <Row label="Uploaded at">{dateTime(record.createdAt)}</Row>
            {record.lastReplacedAt ? (
              <Row label="Last replaced">{dateTime(record.lastReplacedAt)}</Row>
            ) : null}
            <Row label="Note">
              {record.note ? (
                <span className="whitespace-pre-wrap">{record.note}</span>
              ) : (
                <span className="text-neutral-400">No note</span>
              )}
            </Row>
          </dl>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
              Current file
            </h3>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileTextIcon className="size-4 shrink-0 text-neutral-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {record.file?.originalName || "—"}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {formatBytes(record.file?.fileSize)} ·{" "}
                    {dateTime(record.file?.uploadedAt)}
                  </p>
                </div>
              </div>
              <DownloadFileButton file={record.file} />
            </div>
          </div>

          {previousFiles.length > 0 ? (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Replaced files ({previousFiles.length})
                </h3>
                {previousFiles.map((file) => (
                  <div
                    key={file.key}
                    className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileTextIcon className="size-4 shrink-0 text-neutral-400" />
                      <div className="min-w-0">
                        <p className="truncate text-sm">{file.originalName}</p>
                        <p className="text-xs text-neutral-500">
                          {formatBytes(file.fileSize)} ·{" "}
                          {file.uploadedByName || "—"} ·{" "}
                          {dateTime(file.uploadedAt)}
                        </p>
                      </div>
                    </div>
                    <DownloadFileButton file={file} variant="ghost" />
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
