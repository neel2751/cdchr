"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCommonContext } from "@/context/commonContext";
import { formatBytes } from "@/lib/utils";
import { updateMediaFileStatus } from "@/server/document/documentManagementServer";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATUS_VARIANT = {
  active: "default",
  archived: "secondary",
  deleted: "destructive",
};

const SOURCE_LABEL = {
  media: "Media Library",
  document: "Employee Docs",
  expense: "Expense Receipt",
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function DocumentTable() {
  const { result = [] } = useCommonContext();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(null); // file pending deletion

  const { mutate, isPending } = useMutation({
    mutationFn: (vars) => updateMediaFileStatus(vars),
    onSuccess: (res) => {
      if (res?.success) {
        toast.success(res.message || "File updated");
        queryClient.invalidateQueries({ queryKey: ["mediaFiles"] });
        queryClient.invalidateQueries({ queryKey: ["mediaStats"] });
      } else {
        toast.error(res?.message || "Update failed");
      }
      setConfirm(null);
    },
    onError: (err) => {
      toast.error(err?.message || "Update failed");
      setConfirm(null);
    },
  });

  const runAction = (file, action) =>
    mutate({
      source: file.source,
      parentId: file.parentId,
      key: file.key,
      action,
    });

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.map((file) => (
            <TableRow key={`${file.source}-${file.parentId}-${file.key}`}>
              <TableCell className="max-w-[220px] truncate font-medium">
                {file.name || "—"}
              </TableCell>
              <TableCell>{cap(file.docType)}</TableCell>
              <TableCell>{SOURCE_LABEL[file.source] || file.source}</TableCell>
              <TableCell className="text-neutral-500">{file.fileType}</TableCell>
              <TableCell>{formatBytes(file.fileSize)}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[file.status] || "outline"}>
                  {cap(file.status)}
                </Badge>
              </TableCell>
              <TableCell className="text-neutral-500">
                {file.uploadedAt
                  ? new Date(file.uploadedAt).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isPending}
                      className="size-8"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {file.status !== "active" && (
                      <DropdownMenuItem onClick={() => runAction(file, "restore")}>
                        <RotateCcw className="mr-2 size-4" />
                        Restore
                      </DropdownMenuItem>
                    )}
                    {file.status === "active" && (
                      <DropdownMenuItem onClick={() => runAction(file, "archive")}>
                        <Archive className="mr-2 size-4" />
                        Archive
                      </DropdownMenuItem>
                    )}
                    {file.status !== "deleted" && (
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        onClick={() => setConfirm(file)}
                      >
                        <Trash2 className="mr-2 size-4" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{confirm?.name}&rdquo; will be moved to Deleted. You can
              restore it later from the Deleted filter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700"
              onClick={() => confirm && runAction(confirm, "delete")}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
