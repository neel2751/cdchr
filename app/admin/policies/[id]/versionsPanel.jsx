"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, FileText, Send, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Card, CardContent } from "@/components/ui/card";
import { formatFileSize } from "@/lib/policies";
import {
  deletePolicyDraft,
  getPolicyVersionFileUrl,
  publishPolicyVersion,
} from "@/server/policyServer/policyServer";
import { openSignedFile } from "../openSignedFile";
import UploadVersionDialog from "./uploadVersionDialog";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

/**
 * Every version of a policy: the draft waiting, if there is one, then the
 * published history newest first. The current one is marked; the rest stay
 * openable, because the reason to keep them is to be able to show what was
 * in force on a given day.
 */
export default function VersionsPanel({ policy }) {
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // { version, action }

  const versions = policy.versions || [];
  const draft = versions.find((v) => v.status === "draft");
  const archived = policy.status === "archived";

  const { mutate, isPending } = useMutation({
    mutationFn: ({ action, id }) =>
      action === "publish" ? publishPolicyVersion(id) : deletePolicyDraft(id),
    onSuccess: (res) => {
      if (res?.success) {
        toast.success(res.message || "Done");
        queryClient.invalidateQueries({ queryKey: ["policy", policy._id] });
        queryClient.invalidateQueries({ queryKey: ["policies"] });
        queryClient.invalidateQueries({ queryKey: ["myPolicies"] });
        // Publishing is a review, so it can take a policy off the dashboard.
        queryClient.invalidateQueries({ queryKey: ["policyReviewsDue"] });
      } else {
        toast.error(res?.message || "That did not work");
      }
      setConfirm(null);
    },
    onError: (err) => {
      toast.error(err?.message || "That did not work");
      setConfirm(null);
    },
  });

  const nextNumber = (policy.currentVersionNumber || 0) + 1;
  const CONFIRM = {
    publish: {
      title: `Publish this as version ${nextNumber}?`,
      body: policy.visibleToEmployees
        ? `It replaces version ${policy.currentVersionNumber} straight away for everyone who can see this policy. Version ${policy.currentVersionNumber} stays in the history.`
        : policy.currentVersionNumber
          ? `It replaces version ${policy.currentVersionNumber}, which stays in the history. Staff still cannot see this policy until you choose who can.`
          : "It becomes the version in force. Staff cannot see it until you choose who can.",
      action: "Publish",
    },
    delete: {
      title: "Delete this draft?",
      body: "The file is removed. This cannot be undone.",
      action: "Delete draft",
    },
  }[confirm?.action] || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {policy.currentVersionNumber
            ? `Version ${policy.currentVersionNumber} is in force.`
            : "Nothing published yet."}{" "}
          Published versions cannot be changed. A correction is a new version.
        </p>
        <Button
          onClick={() => setUploadOpen(true)}
          disabled={!!draft || archived}
          title={draft ? "Publish or delete the draft first" : undefined}
        >
          <Upload className="mr-1.5 size-4" />
          {policy.currentVersionNumber ? "Upload new version" : "Upload the policy"}
        </Button>
      </div>

      {versions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Upload the document to get started. It is saved as a draft until
            you publish it.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {versions.map((version) => {
            const isCurrent = String(version._id) === String(policy.currentVersionId);
            const isDraft = version.status === "draft";
            return (
              <li key={version._id}>
                <Card className={isDraft ? "border-dashed" : isCurrent ? "border-neutral-400" : ""}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {isDraft ? "Draft" : `Version ${version.versionNumber}`}
                        </span>
                        {isCurrent ? <Badge>In force</Badge> : null}
                        {version.status === "superseded" ? (
                          <Badge variant="secondary">Superseded</Badge>
                        ) : null}
                        {isDraft ? <Badge variant="outline">Not published</Badge> : null}
                      </div>
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <FileText className="size-3.5 shrink-0" />
                        <span className="truncate">{version.file.fileName}</span>
                        <span className="shrink-0">· {formatFileSize(version.file.fileSize)}</span>
                      </p>
                      {version.changeNote ? (
                        <p className="whitespace-pre-line text-sm">{version.changeNote}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Uploaded by {version.uploadedByName || "someone"} on{" "}
                        {formatDate(version.createdAt)}
                        {version.publishedAt
                          ? ` · published by ${version.publishedByName || "someone"} on ${formatDate(version.publishedAt)}`
                          : ""}
                        {version.effectiveDate
                          ? ` · in force from ${formatDate(version.effectiveDate)}`
                          : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          openSignedFile(() => getPolicyVersionFileUrl(version._id))
                        }
                      >
                        <ExternalLink className="mr-1.5 size-3.5" />
                        Open
                      </Button>
                      {isDraft ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => setConfirm({ version, action: "delete" })}
                          >
                            <Trash2 className="mr-1.5 size-3.5" />
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            disabled={isPending || archived}
                            onClick={() => setConfirm({ version, action: "publish" })}
                          >
                            <Send className="mr-1.5 size-3.5" />
                            Publish
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <UploadVersionDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        policy={policy}
      />

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CONFIRM.title}</AlertDialogTitle>
            <AlertDialogDescription>{CONFIRM.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                mutate({ action: confirm.action, id: confirm.version._id });
              }}
            >
              {CONFIRM.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
