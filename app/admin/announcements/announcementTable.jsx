"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCommonContext } from "@/context/commonContext";
import {
  archiveAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  unpublishAnnouncement,
} from "@/server/announcementServer/announcementServer";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  PRIORITY_VARIANT,
  STATUS_VARIANT,
  describeAudience,
} from "./constants";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

export default function AnnouncementTable() {
  const { result = [], departmentNames = {}, siteNames = {} } = useCommonContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [confirm, setConfirm] = useState(null); // { row, action }

  const { mutate, isPending } = useMutation({
    mutationFn: ({ action, id }) => {
      if (action === "publish") return publishAnnouncement(id);
      if (action === "unpublish") return unpublishAnnouncement(id);
      if (action === "archive") return archiveAnnouncement(id);
      return deleteAnnouncement(id);
    },
    onSuccess: (res) => {
      if (res?.success) {
        toast.success(res.message || "Done");
        queryClient.invalidateQueries({ queryKey: ["announcements"] });
        // The recipient-side bell reads a different key and would otherwise keep
        // showing a count that no longer matches what was just published.
        queryClient.invalidateQueries({ queryKey: ["myAnnouncements"] });
        queryClient.invalidateQueries({ queryKey: ["myAnnouncementsUnread"] });
        router.refresh();
      } else {
        toast.error(res?.message || "Action failed");
      }
      setConfirm(null);
    },
    onError: (err) => {
      toast.error(err?.message || "Action failed");
      setConfirm(null);
    },
  });

  // Publishing and deleting both warrant a confirmation — one is irreversible,
  // the other reaches everybody.
  const run = (row, action) => {
    if (action === "publish" || action === "delete") {
      setConfirm({ row, action });
      return;
    }
    mutate({ action, id: row._id });
  };

  const CONFIRM_COPY = {
    publish: {
      title: "Publish this announcement?",
      body: `"${confirm?.row?.title}" will appear for everyone it is addressed to.`,
      action: "Publish",
    },
    delete: {
      title: "Delete this announcement?",
      body: `"${confirm?.row?.title}" and its read history will be removed. This cannot be undone.`,
      action: "Delete",
    },
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Audience</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Published</TableHead>
            <TableHead className="text-right">Recipients</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.map((row) => (
            <TableRow key={row._id}>
              <TableCell className="font-medium">
                <Link
                  href={`/admin/announcements/${row._id}`}
                  className="hover:underline"
                >
                  {row.title}
                </Link>
                {row.requireAck && (
                  <span className="ml-2 text-xs text-neutral-500">
                    needs acknowledgement
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[row.status] || "outline"}>
                  {row.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-neutral-600">
                {describeAudience(row.audience, {
                  departments: departmentNames,
                  sites: siteNames,
                })}
              </TableCell>
              <TableCell className="text-sm">
                {CATEGORY_LABEL[row.category] || row.category}
              </TableCell>
              <TableCell>
                <Badge variant={PRIORITY_VARIANT[row.priority] || "outline"}>
                  {PRIORITY_LABEL[row.priority] || row.priority}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-neutral-600">
                {row.status === "scheduled"
                  ? `Scheduled ${formatDate(row.publishAt)}`
                  : formatDate(row.publishedAt)}
              </TableCell>
              <TableCell className="text-right text-sm">
                {row.status === "draft" ? "—" : row.recipientCount}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={isPending}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {row.status !== "archived" && (
                      <DropdownMenuItem asChild>
                        <Link href={`/admin/announcements/${row._id}`}>
                          <Pencil className="mr-2 size-4" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {(row.status === "draft" || row.status === "scheduled") && (
                      <DropdownMenuItem onClick={() => run(row, "publish")}>
                        <Send className="mr-2 size-4" />
                        Publish
                      </DropdownMenuItem>
                    )}
                    {(row.status === "published" ||
                      row.status === "scheduled") && (
                      <DropdownMenuItem onClick={() => run(row, "unpublish")}>
                        <Undo2 className="mr-2 size-4" />
                        Move back to draft
                      </DropdownMenuItem>
                    )}
                    {row.status !== "archived" && (
                      <DropdownMenuItem onClick={() => run(row, "archive")}>
                        <Archive className="mr-2 size-4" />
                        Archive
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => run(row, "delete")}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Delete
                    </DropdownMenuItem>
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
            <AlertDialogTitle>
              {CONFIRM_COPY[confirm?.action]?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {CONFIRM_COPY[confirm?.action]?.body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() =>
                mutate({ action: confirm.action, id: confirm.row._id })
              }
            >
              {CONFIRM_COPY[confirm?.action]?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
