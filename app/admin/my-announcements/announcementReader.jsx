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
import {
  acknowledgeAnnouncement,
  markAnnouncementRead,
} from "@/server/announcementServer/myAnnouncementServer";
import { getAttachmentUrl } from "@/server/announcementServer/announcementAttachments";
import { formatBytes } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  PRIORITY_VARIANT,
} from "../announcements/constants";

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

export default function AnnouncementReader({ announcement }) {
  const queryClient = useQueryClient();
  const [acknowledgedAt, setAcknowledgedAt] = useState(
    announcement.acknowledgedAt
  );
  const [saving, setSaving] = useState(false);

  // Opening the page is what "read" means. Fire-and-forget: a failure here is
  // not worth interrupting someone who is in the middle of reading, and the
  // server treats a repeat as a no-op.
  useEffect(() => {
    if (announcement.readAt) return;
    markAnnouncementRead(announcement._id)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["myAnnouncementsUnread"] });
        queryClient.invalidateQueries({ queryKey: ["myAnnouncements"] });
      })
      .catch(() => {});
  }, [announcement._id, announcement.readAt, queryClient]);

  // Signed on demand rather than embedded in the page: a download URL expires,
  // so one baked into the HTML would be dead by the time anyone came back to it.
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
    <div className="mx-auto max-w-3xl space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/my-announcements">
          <ArrowLeft className="mr-1 size-4" />
          All announcements
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={PRIORITY_VARIANT[announcement.priority] || "outline"}>
              {announcement.priority}
            </Badge>
            <Badge variant="outline">
              {CATEGORY_LABEL[announcement.category] || announcement.category}
            </Badge>
          </div>
          <h1 className="mt-2 text-xl font-semibold">{announcement.title}</h1>
          <p className="text-sm text-neutral-500">
            {announcement.createdByName || "Your company"} ·{" "}
            {formatDateTime(announcement.publishedAt)}
            {announcement.expiresAt &&
              ` · expires ${formatDateTime(announcement.expiresAt)}`}
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
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-neutral-50"
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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              {acknowledgedAt ? (
                <p className="flex items-center gap-2 text-sm text-green-700">
                  <Check className="size-4" />
                  You acknowledged this on {formatDateTime(acknowledgedAt)}.
                </p>
              ) : (
                <>
                  <p className="text-sm text-neutral-600">
                    Please confirm you have read this.
                  </p>
                  <Button onClick={acknowledge} disabled={saving}>
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
