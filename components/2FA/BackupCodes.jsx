"use client";

import { useState } from "react";
import { Copy, Download, ShieldAlert, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * Shows a freshly issued set of recovery codes. This is the only time the codes
 * are ever readable, so the continue action stays locked until the user has
 * copied or downloaded them and ticked the acknowledgement.
 *
 * @param {string[]} codes    - plaintext codes, as returned by the server action
 * @param {Function} onDone   - called when the user confirms they have saved them
 * @param {string}  [doneLabel]
 */
export default function BackupCodes({ codes = [], onDone, doneLabel = "Continue" }) {
  const [saved, setSaved] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const asText = [
    "HR Management — two-factor recovery codes",
    `Generated: ${new Date().toLocaleString()}`,
    "",
    "Each code can be used once, in place of your authenticator app.",
    "Store them somewhere safe and offline.",
    "",
    ...codes,
    "",
  ].join("\n");

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setSaved(true);
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Could not copy — please download them instead");
    }
  };

  const download = () => {
    const blob = new Blob([asText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setSaved(true);
    toast.success("Recovery codes downloaded");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-sm tracking-tight text-amber-900">
          Save these now — they will not be shown again. If you lose your
          authenticator app, a recovery code is the only way back into your
          account. Each code works once.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3">
        {codes.map((code) => (
          <li
            key={code}
            className="text-center font-mono text-sm tracking-wider select-all"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={copyAll}
        >
          {saved ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          Copy
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={download}
        >
          <Download className="h-4 w-4" />
          Download
        </Button>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="codes-saved"
          checked={acknowledged}
          onCheckedChange={(v) => setAcknowledged(v === true)}
          disabled={!saved}
        />
        <Label
          htmlFor="codes-saved"
          className="text-sm font-normal leading-snug tracking-tight"
        >
          I have saved my recovery codes somewhere safe.
          {!saved && (
            <span className="block text-xs text-muted-foreground">
              Copy or download them first.
            </span>
          )}
        </Label>
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={!acknowledged}
        onClick={onDone}
      >
        {doneLabel}
      </Button>
    </div>
  );
}
