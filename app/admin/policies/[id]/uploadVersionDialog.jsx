"use client";

import { useState } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  POLICY_FILE_ACCEPT,
  POLICY_FILE_TYPES,
  POLICY_MAX_BYTES,
  formatFileSize,
} from "@/lib/policies";
import {
  addPolicyVersion,
  startPolicyUpload,
} from "@/server/policyServer/policyServer";

/**
 * Upload a policy's next version as a draft.
 *
 * The file goes from the browser straight to storage on a link the server
 * signs for this one file, then the server checks what arrived and records
 * it. See the Versions section of server/policyServer/policyServer.js.
 *
 * The dialog cannot be dismissed mid-upload: closing it would unmount the
 * form and leave a file in storage that no version points at.
 *
 * @param {{open: boolean, onOpenChange: Function, policy: object}} props
 */
export default function UploadVersionDialog({ open, onOpenChange, policy }) {
  const [busy, setBusy] = useState(false);
  const isFirst = !policy?.currentVersionNumber;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isFirst
              ? "Upload the policy"
              : `Upload version ${policy.currentVersionNumber + 1}`}
          </DialogTitle>
          <DialogDescription>
            It is saved as a draft. Nothing changes for staff until you publish
            it.
          </DialogDescription>
        </DialogHeader>
        <UploadForm
          policy={policy}
          isFirst={isFirst}
          onBusyChange={setBusy}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({ policy, isFirst, onBusyChange, onDone }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [changeNote, setChangeNote] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [progress, setProgress] = useState(null);

  // Checked here as well as on the server so a wrong file is turned away
  // before it is uploaded, not after.
  const fileProblem = !file
    ? null
    : !POLICY_FILE_TYPES[file.type]
      ? "Choose a PDF, a Word document or an image."
      : file.size > POLICY_MAX_BYTES
        ? `That file is ${formatFileSize(file.size)}; the limit is ${formatFileSize(POLICY_MAX_BYTES)}.`
        : null;

  const uploading = progress !== null;
  const canSubmit =
    file && !fileProblem && (isFirst || changeNote.trim()) && !uploading;

  const setUploading = (value) => {
    setProgress(value);
    onBusyChange(value !== null);
  };

  const submit = async () => {
    setUploading(0);
    try {
      const started = await startPolicyUpload({
        policyId: policy._id,
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
      });
      if (!started?.success) throw new Error(started?.message);
      const { url, key } = JSON.parse(started.data);

      await axios.put(url, file, {
        headers: { "Content-Type": file.type },
        onUploadProgress: (e) =>
          setProgress(e.total ? Math.round((e.loaded * 100) / e.total) : 0),
      });

      const saved = await addPolicyVersion({
        policyId: policy._id,
        key,
        fileName: file.name,
        changeNote,
        effectiveDate: effectiveDate || null,
      });
      if (!saved?.success) throw new Error(saved?.message);

      toast.success(saved.message || "Draft uploaded");
      queryClient.invalidateQueries({ queryKey: ["policy", policy._id] });
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      setUploading(null);
      onDone();
    } catch (error) {
      toast.error(error?.message || "The upload failed. Try again.");
      setUploading(null);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="policy-file">File</Label>
        <Input
          id="policy-file"
          type="file"
          accept={POLICY_FILE_ACCEPT}
          disabled={uploading}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <p
          className={`text-xs ${fileProblem ? "text-destructive" : "text-muted-foreground"}`}
        >
          {fileProblem ||
            (file
              ? `${file.name} · ${formatFileSize(file.size)}`
              : `PDF, Word or image, up to ${formatFileSize(POLICY_MAX_BYTES)}.`)}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="policy-change-note">
          {isFirst ? "Notes (optional)" : "What changed"}
        </Label>
        <Textarea
          id="policy-change-note"
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          placeholder={
            isFirst
              ? "Anything worth recording about this first version"
              : "e.g. New assembly point after the car park works. Staff see this."
          }
          rows={3}
          maxLength={2000}
          disabled={uploading}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="policy-effective">In force from (optional)</Label>
        <Input
          id="policy-effective"
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          disabled={uploading}
          className="w-48"
        />
      </div>

      {uploading ? (
        <div className="space-y-1">
          <Progress value={progress} />
          <p className="text-xs text-muted-foreground">
            {progress < 100 ? `Uploading… ${progress}%` : "Checking the file…"}
          </p>
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={uploading}
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          Upload draft
        </Button>
      </DialogFooter>
    </form>
  );
}
