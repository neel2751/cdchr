"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Paperclip } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatBytes } from "@/lib/utils";
import { getAttachmentUrl } from "@/server/announcementServer/announcementAttachments";
import {
  acknowledgeAnnouncement,
  markAnnouncementRead,
} from "@/server/announcementServer/myAnnouncementServer";

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/**
 * The field portal's reader. Same server actions as the office one — the
 * difference is the shell around it and the phone-sized controls.
 */
export default function EmployeeAnnouncementReader({ announcement }) {
  const queryClient = useQueryClient();
  const [acknowledgedAt, setAcknowledgedAt] = useState(
    announcement.acknowledgedAt
  );
  const [saving, setSaving] = useState(false);

  // Opening the page is what "read" means. Fire-and-forget: a failure is not
  // worth interrupting someone mid-read, and a repeat is a no-op server-side.
  useEffect(() => {
    if (announcement.readAt) return;
    markAnnouncementRead(announcement._id)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["myAnnouncements"] });
        queryClient.invalidateQueries({ queryKey: ["myAnnouncementsUnread"] });
      })
      .catch(() => {});
  }, [announcement._id, announcement.readAt, queryClient]);

  const openAttachment = async (attachment) => {
    const res = await getAttachmentUrl(announcement._id, attachment.key);
    if (!res?.success) {
      toast.error(res?.message || "Could not open the file");
      return;
    }
    window.open(JSON.parse(res.data).url, "_blank", "noopener,noreferrer");
  };

  const acknowledge = async () => {
    setSaving(true);
    try {
      const res = await acknowledgeAnnouncement(announcement._id);
      if (res?.success) {
        setAcknowledgedAt(new Date().toISOString());
        toast.success("Thanks — recorded.");
        queryClient.invalidateQueries({ queryKey: ["myAnnouncements"] });
      } else {
        toast.error(res?.message || "Could not record that");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/employee/announcements">
          <ArrowLeft className="mr-1 size-4" />
          All announcements
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {announcement.priority === "urgent" && (
              <Badge variant="destructive">Urgent</Badge>
            )}
            <Badge variant="outline">{announcement.category}</Badge>
          </div>
          <h1 className="mt-2 text-xl font-semibold">{announcement.title}</h1>
          <p className="text-sm text-neutral-500">
            {announcement.createdByName || "Your company"} ·{" "}
            {formatDateTime(announcement.publishedAt)}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{announcement.body || ""}</ReactMarkdown>
          </div>

          {announcement.attachments?.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-neutral-500">
                Attachments
              </p>
              <ul className="divide-y rounded-lg border">
                {announcement.attachments.map((attachment) => (
                  <li key={attachment.key}>
                    <button
                      type="button"
                      onClick={() => openAttachment(attachment)}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm active:bg-neutral-100"
                    >
                      <Paperclip className="size-4 shrink-0 text-neutral-400" />
                      <span className="min-w-0 flex-1 truncate">
                        {attachment.fileName}
                      </span>
                      <span className="shrink-0 text-xs text-neutral-400">
                        {formatBytes(attachment.fileSize || 0)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {announcement.requireAck && (
            <div className="rounded-lg border p-4">
              {acknowledgedAt ? (
                <p className="flex items-center gap-2 text-sm text-green-700">
                  <Check className="size-4" />
                  You confirmed this on {formatDateTime(acknowledgedAt)}.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-neutral-600">
                    Please confirm you have read this.
                  </p>
                  <Button
                    onClick={acknowledge}
                    disabled={saving}
                    className="w-full"
                    size="lg"
                  >
                    {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                    I have read this
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
