"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Mail,
  Megaphone,
  Paperclip,
  Send,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/lib/utils";
import {
  createAnnouncement,
  previewAudience,
  publishAnnouncement,
  updateAnnouncement,
} from "@/server/announcementServer/announcementServer";
import {
  deleteAnnouncementAttachment,
  uploadAnnouncementAttachment,
} from "@/server/announcementServer/announcementAttachments";
import AudienceSelector from "./audienceSelector";
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS } from "./constants";

/** A Date (or ISO string) as the value a datetime-local input wants. */
function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // toISOString() is UTC, which would shift the displayed time. Subtracting the
  // offset first makes the sliced string read as local time, which is what the
  // author typed and expects to see again.
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

const emptyDraft = {
  title: "",
  body: "",
  category: "general",
  priority: "normal",
  requireAck: false,
  publishAt: "",
  expiresAt: "",
  channels: { email: false, push: false },
  attachments: [],
  audience: {
    mode: "all",
    roles: [],
    departments: [],
    sites: [],
    people: [],
    includeField: false,
  },
};

const PRIORITY_NOTE = {
  normal: "Appears in the bell and in everyone's list.",
  important: "Pinned to the top of everyone's list.",
  urgent: "Pinned, and shows a banner across every page until it is dealt with.",
};

/** One line in the pre-publish summary. */
function SummaryLine({ icon: Icon, children, tone }) {
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${
          tone === "warn" ? "text-amber-600" : "text-neutral-400"
        }`}
      />
      <span>{children}</span>
    </li>
  );
}

/**
 * Create or edit an announcement.
 *
 * `announcement` absent means create. Saving always writes a draft first, so
 * "Publish" is save-then-publish rather than a second code path — the publish
 * action can then keep its single job of working out the recipient count and
 * flipping the status.
 *
 * The layout is two columns because the two halves of the job are different:
 * the left is authoring (what you say), the right is settings and the send
 * decision (who hears it, when, and how). The right column sticks, so the
 * recipient count and the publish button stay in view while writing — the
 * question "how many people am I about to message" should never require
 * scrolling to answer.
 */
export default function AnnouncementForm({ announcement, showHeader = true }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = !!announcement?._id;

  const [values, setValues] = useState(() =>
    isEdit
      ? {
          title: announcement.title || "",
          body: announcement.body || "",
          category: announcement.category || "general",
          priority: announcement.priority || "normal",
          requireAck: !!announcement.requireAck,
          publishAt: toLocalInput(announcement.publishAt),
          expiresAt: toLocalInput(announcement.expiresAt),
          channels: {
            email: !!announcement.channels?.email,
            push: !!announcement.channels?.push,
          },
          attachments: announcement.attachments || [],
          audience: {
            mode: announcement.audience?.mode || "all",
            roles: announcement.audience?.roles || [],
            departments: (announcement.audience?.departments || []).map(String),
            sites: (announcement.audience?.sites || []).map(String),
            people: (announcement.audience?.people || []).map((p) => ({
              kind: p.kind === "field" ? "field" : "office",
              employeeId: String(p.employeeId),
            })),
            includeField: !!announcement.audience?.includeField,
          },
        }
      : emptyDraft
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }));

  /**
   * Live recipient count.
   *
   * Keyed on the serialised audience rather than debounced: the audience only
   * changes on discrete clicks in the picker, never on a keystroke, so there is
   * no burst to smooth out.
   */
  const audienceKey = JSON.stringify(values.audience);
  const { data: reach, isFetching: counting } = useQuery({
    queryKey: ["audiencePreview", audienceKey],
    queryFn: async () => {
      const res = await previewAudience({ audience: values.audience });
      return JSON.parse(res?.data || '{"count":0,"sample":[]}');
    },
    staleTime: 60_000,
  });

  const recipientCount = reach?.count ?? null;

  const onFilesPicked = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        const res = await uploadAnnouncementAttachment(body);
        if (res?.success) {
          const attachment = JSON.parse(res.data);
          setValues((v) => ({
            ...v,
            attachments: [...v.attachments, attachment],
          }));
        } else {
          toast.error(res?.message || `Could not upload ${file.name}`);
        }
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeAttachment = async (attachment) => {
    setValues((v) => ({
      ...v,
      attachments: v.attachments.filter((a) => a.key !== attachment.key),
    }));
    // Best-effort: the row is already gone from the form, and an object left in
    // the bucket is swept by the media tooling like any other detached file.
    deleteAnnouncementAttachment(attachment.key).catch(() => {});
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["announcements"] });
    queryClient.invalidateQueries({ queryKey: ["myAnnouncements"] });
    queryClient.invalidateQueries({ queryKey: ["myAnnouncementsUnread"] });
  };

  /**
   * @param {boolean} thenPublish send it as well as saving it
   */
  const save = async (thenPublish) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        publishAt: values.publishAt || null,
        expiresAt: values.expiresAt || null,
      };

      const saved = isEdit
        ? await updateAnnouncement(announcement._id, payload)
        : await createAnnouncement(payload);

      if (!saved?.success) {
        toast.error(saved?.message || "Could not save");
        return;
      }

      const id = isEdit
        ? announcement._id
        : JSON.parse(saved.data || "{}")?._id;

      if (!thenPublish) {
        toast.success(saved.message || "Saved");
        invalidate();
        router.push("/admin/announcements");
        return;
      }

      const published = await publishAnnouncement(id);
      if (published?.success) {
        toast.success(published.message || "Published");
      } else {
        // The draft is saved either way, so this is recoverable — say so rather
        // than leaving the author wondering whether they lost their text.
        toast.error(
          `${published?.message || "Could not publish"} — saved as a draft.`
        );
      }
      invalidate();
      router.push("/admin/announcements");
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  const alreadyPublished =
    isEdit &&
    (announcement.status === "published" || announcement.status === "scheduled");

  // Setting a future publish time turns "publish" into "schedule" server-side.
  // The button says so rather than leaving the author to discover it.
  const willSchedule =
    !!values.publishAt && new Date(values.publishAt) > new Date();

  const canSend = values.title.trim() && values.body.trim() && recipientCount > 0;

  const sendLabel = willSchedule ? "Schedule" : "Publish now";

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        {/* Hidden on the detail screen, which puts its own header above the
            Edit / Recipients tabs rather than inside one of them. */}
        {showHeader && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/announcements">
                <ArrowLeft className="mr-1 size-4" />
                Announcements
              </Link>
            </Button>
            <h1 className="text-lg font-semibold">
              {isEdit ? "Edit announcement" : "New announcement"}
            </h1>
            {isEdit && <Badge variant="outline">{announcement.status}</Badge>}
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-3">
          {/* ---------------------------------------------- authoring ---- */}
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardContent className="space-y-5 pt-6">
                <div className="space-y-1.5">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={values.title}
                    placeholder="Office closed on Monday"
                    onChange={(e) => set("title", e.target.value)}
                    className="text-base font-medium md:text-lg"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="body">Message</Label>
                    <span className="text-xs text-neutral-400">
                      **bold** · *italic* · [link](url) · - list
                    </span>
                  </div>
                  <Tabs defaultValue="write">
                    <TabsList>
                      <TabsTrigger value="write">Write</TabsTrigger>
                      <TabsTrigger value="preview">Preview</TabsTrigger>
                    </TabsList>
                    <TabsContent value="write">
                      <Textarea
                        id="body"
                        value={values.body}
                        rows={14}
                        placeholder={
                          "What do people need to know?\n\nMarkdown is supported."
                        }
                        onChange={(e) => set("body", e.target.value)}
                        className="resize-y font-normal"
                        required
                      />
                    </TabsContent>
                    <TabsContent value="preview">
                      {/* Shown the way a recipient sees it, title included —
                          previewing the body alone hides the most-read line. */}
                      <div className="min-h-[19rem] rounded-lg border p-5">
                        <h2 className="mb-1 text-lg font-semibold">
                          {values.title || "Untitled announcement"}
                        </h2>
                        <p className="mb-4 text-xs text-neutral-400">
                          Preview — this is what recipients see.
                        </p>
                        <div className="prose prose-sm max-w-none">
                          {values.body ? (
                            <ReactMarkdown>{values.body}</ReactMarkdown>
                          ) : (
                            <p className="text-neutral-400">
                              Nothing written yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>

                <div className="space-y-2 border-t pt-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={() =>
                        document.getElementById("attachments")?.click()
                      }
                    >
                      {uploading ? (
                        <Loader2 className="mr-1 size-4 animate-spin" />
                      ) : (
                        <Paperclip className="mr-1 size-4" />
                      )}
                      Attach files
                    </Button>
                    <span className="text-xs text-neutral-500">
                      Up to 10 files, 25 MB each. Counts towards your storage
                      allowance.
                    </span>
                  </div>
                  <input
                    id="attachments"
                    type="file"
                    multiple
                    className="hidden"
                    onChange={onFilesPicked}
                  />
                  {values.attachments.length > 0 && (
                    <ul className="divide-y rounded-lg border">
                      {values.attachments.map((attachment) => (
                        <li
                          key={attachment.key}
                          className="flex items-center gap-2 px-3 py-2 text-sm"
                        >
                          <Paperclip className="size-4 shrink-0 text-neutral-400" />
                          <span className="min-w-0 flex-1 truncate">
                            {attachment.fileName}
                          </span>
                          <span className="shrink-0 text-xs text-neutral-400">
                            {formatBytes(attachment.fileSize || 0)}
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label={`Remove ${attachment.fileName}`}
                            onClick={() => removeAttachment(attachment)}
                          >
                            <X className="size-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4" />
                  Who gets this
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AudienceSelector
                  value={values.audience}
                  onChange={(next) => set("audience", next)}
                />
              </CardContent>
            </Card>
          </div>

          {/* ------------------------------------ settings and send ---- */}
          <aside className="space-y-4">
            <div className="space-y-4 lg:sticky lg:top-4">
              <Card>
                <CardContent className="space-y-4 pt-6">
                  {/* The count is the headline: it is the one fact that makes
                      publishing feel safe or reckless, and it was previously
                      invisible until after the fact. */}
                  <div className="rounded-lg border bg-neutral-50 p-4 text-center">
                    <p className="text-xs text-neutral-500">Will reach</p>
                    <p className="mt-0.5 text-3xl font-semibold tabular-nums">
                      {counting && recipientCount === null ? (
                        <Loader2 className="mx-auto size-7 animate-spin text-neutral-400" />
                      ) : (
                        recipientCount ?? 0
                      )}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {recipientCount === 1 ? "person" : "people"}
                    </p>
                    {reach?.sample?.length > 0 && (
                      <p className="mt-2 truncate text-xs text-neutral-400">
                        {reach.sample.join(", ")}
                        {recipientCount > reach.sample.length &&
                          ` +${recipientCount - reach.sample.length} more`}
                      </p>
                    )}
                    {recipientCount === 0 && (
                      <p className="mt-2 text-xs text-amber-600">
                        Nobody matches this audience yet.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Priority</Label>
                    <Select
                      value={values.priority}
                      onValueChange={(v) => set("priority", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-neutral-500">
                      {PRIORITY_NOTE[values.priority]}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <Select
                      value={values.category}
                      onValueChange={(v) => set("category", v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Delivery</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="flex items-start gap-2 text-xs text-neutral-500">
                    <Megaphone className="mt-0.5 size-3.5 shrink-0" />
                    Always appears in the app. These send a copy as well.
                  </p>

                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor="channelEmail"
                      className="flex items-center gap-2 font-normal"
                    >
                      <Mail className="size-4 text-neutral-400" />
                      Email
                    </Label>
                    <Switch
                      id="channelEmail"
                      checked={values.channels.email}
                      onCheckedChange={(v) =>
                        set("channels", { ...values.channels, email: v })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor="channelPush"
                      className="flex items-center gap-2 font-normal"
                    >
                      <Smartphone className="size-4 text-neutral-400" />
                      Push notification
                    </Label>
                    <Switch
                      id="channelPush"
                      checked={values.channels.push}
                      onCheckedChange={(v) =>
                        set("channels", { ...values.channels, push: v })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t pt-3">
                    <Label
                      htmlFor="requireAck"
                      className="flex items-center gap-2 font-normal"
                    >
                      <CheckCircle2 className="size-4 text-neutral-400" />
                      Require acknowledgement
                    </Label>
                    <Switch
                      id="requireAck"
                      checked={values.requireAck}
                      onCheckedChange={(v) => set("requireAck", v)}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarClock className="size-4" />
                    Timing
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="publishAt" className="text-xs">
                      Publish at
                    </Label>
                    <Input
                      id="publishAt"
                      type="datetime-local"
                      value={values.publishAt}
                      onChange={(e) => set("publishAt", e.target.value)}
                    />
                    <p className="text-xs text-neutral-500">
                      {willSchedule
                        ? "It will go out automatically at this time."
                        : "Leave empty to send as soon as you publish."}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expiresAt" className="text-xs">
                      Expires at
                    </Label>
                    <Input
                      id="expiresAt"
                      type="datetime-local"
                      value={values.expiresAt}
                      onChange={(e) => set("expiresAt", e.target.value)}
                    />
                    <p className="text-xs text-neutral-500">
                      Optional. It stops appearing after this.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {!alreadyPublished && (
                  <Button
                    type="button"
                    className="w-full"
                    size="lg"
                    disabled={saving || !canSend}
                    onClick={() => setConfirming(true)}
                    title={
                      !canSend
                        ? "Add a title, a message and an audience first"
                        : undefined
                    }
                  >
                    {saving ? (
                      <Loader2 className="mr-1 size-4 animate-spin" />
                    ) : (
                      <Send className="mr-1 size-4" />
                    )}
                    {sendLabel}
                  </Button>
                )}
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full"
                  disabled={saving}
                >
                  {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                  Save {alreadyPublished ? "changes" : "as draft"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => router.push("/admin/announcements")}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </form>

      {/* The last chance to notice that this reaches 300 people by email. */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {willSchedule ? "Schedule this announcement?" : "Send this now?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="mt-2 space-y-2 text-sm text-neutral-600">
                <SummaryLine icon={Users}>
                  Goes to <strong>{recipientCount}</strong>{" "}
                  {recipientCount === 1 ? "person" : "people"}.
                </SummaryLine>
                {willSchedule && (
                  <SummaryLine icon={CalendarClock}>
                    Held until{" "}
                    <strong>
                      {new Date(values.publishAt).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </strong>
                    .
                  </SummaryLine>
                )}
                {values.channels.email && (
                  <SummaryLine icon={Mail} tone="warn">
                    Emails a copy to everyone in the audience. This cannot be
                    recalled.
                    {reach?.withoutEmail > 0 &&
                      ` ${reach.withoutEmail} of them have no email address on file.`}
                  </SummaryLine>
                )}
                {values.channels.push && (
                  <SummaryLine icon={Smartphone}>
                    Pushes to anyone who has allowed notifications.
                  </SummaryLine>
                )}
                {values.priority === "urgent" && (
                  <SummaryLine icon={AlertTriangle} tone="warn">
                    Marked urgent, so it shows a banner on every page
                    {values.requireAck
                      ? " that cannot be dismissed until acknowledged."
                      : " until dismissed."}
                  </SummaryLine>
                )}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                // Kept open while the request runs, so the button can show a
                // spinner instead of the dialog vanishing into a blank page.
                e.preventDefault();
                save(true);
              }}
            >
              {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
              {sendLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
