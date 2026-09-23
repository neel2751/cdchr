"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePickerSingle } from "@/components/form/formFields";
import { format } from "date-fns";
import { BadgeCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  RTW_DOCUMENT_TYPES,
  RTW_STATUS_BADGE,
  getRightToWorkStatus,
  sortRightToWorkChecks,
} from "@/lib/rightToWork";
import { formatVisaRemaining } from "@/lib/visaMilestones";

const prettyDate = (value) =>
  value ? format(new Date(value), "PPP") : "Never checked";

/**
 * Record a right-to-work check from a row action.
 *
 * The check is an event in its own right, so it is captured here rather than in
 * the employee form: it has its own date, its own evidence, and it is kept
 * forever alongside the previous ones. Because the usual reason for rechecking
 * is a renewed or switched visa, the dialog can update the visa dates in the
 * same submit — the new check is then stored against the new expiry.
 *
 * @param {{ target: { employeeId, employeeType, name, email, immigrationType,
 *                     immigrationCategory, visaStartDate, visaEndDate,
 *                     checks } | null,
 *           onOpenChange: (open: boolean) => void,
 *           onConfirm: (payload: object) => void,
 *           isPending: boolean }} props
 */
const RightToWorkDialog = ({ target, onOpenChange, onConfirm, isPending }) => {
  const open = Boolean(target);

  const [checkedAt, setCheckedAt] = useState(new Date());
  const [documentType, setDocumentType] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [note, setNote] = useState("");
  const [visaUpdated, setVisaUpdated] = useState(false);
  const [visaStartDate, setVisaStartDate] = useState(null);
  const [visaEndDate, setVisaEndDate] = useState(null);
  const [immigrationCategory, setImmigrationCategory] = useState("");

  // Reset every field when the dialog is pointed at a different employee, so
  // evidence typed for one person can never be submitted against another.
  // Adjusted during render rather than in an effect to avoid a second pass.
  const targetId = target?.employeeId ?? null;
  const [lastTargetId, setLastTargetId] = useState(targetId);
  if (targetId !== lastTargetId) {
    setLastTargetId(targetId);
    setCheckedAt(new Date());
    setDocumentType("");
    setShareCode("");
    setNote("");
    setVisaUpdated(false);
    setVisaStartDate(
      target?.visaStartDate ? new Date(target.visaStartDate) : null,
    );
    setVisaEndDate(target?.visaEndDate ? new Date(target.visaEndDate) : null);
    setImmigrationCategory(target?.immigrationCategory || "");
  }

  const history = sortRightToWorkChecks(target?.checks);
  const status = getRightToWorkStatus({
    immigrationType: target?.immigrationType,
    visaEndDate: target?.visaEndDate,
    checks: target?.checks,
  });
  const isBritish = target?.immigrationType === "British";
  const visaRemaining = target?.visaEndDate
    ? formatVisaRemaining(target.visaEndDate)
    : null;

  const handleConfirm = () => {
    if (!checkedAt) return toast.warning("Please pick the date of the check");
    if (checkedAt > new Date()) {
      return toast.warning("The check date cannot be in the future");
    }
    if (!documentType) {
      return toast.warning("Please choose what was checked");
    }
    if (visaUpdated && !visaEndDate) {
      return toast.warning("Please enter the new visa expiry date");
    }
    if (visaUpdated && visaStartDate && visaEndDate <= visaStartDate) {
      return toast.warning("The visa expiry must be after the visa start date");
    }
    onConfirm({
      checkedAt,
      documentType,
      shareCode: shareCode.trim(),
      note: note.trim(),
      visaUpdated,
      ...(visaUpdated
        ? {
            visaStartDate,
            visaEndDate,
            immigrationCategory: immigrationCategory.trim(),
          }
        : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-indigo-600" />
            Record right to work check
          </DialogTitle>
          <DialogDescription>
            Logs a new check against the visa currently on file. Previous checks
            are kept, so the full history stays visible.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-md border bg-neutral-50 p-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Employee</span>
              <span className="text-right font-medium">
                {target?.name || "—"}
                {target?.email ? (
                  <span className="block text-xs text-gray-400">
                    {target.email}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Visa expiry on file</span>
              <span className="text-right font-medium">
                {isBritish
                  ? "—"
                  : target?.visaEndDate
                    ? `${format(new Date(target.visaEndDate), "PPP")}${
                        visaRemaining ? ` · ${visaRemaining}` : ""
                      }`
                    : "Not recorded"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500">Last checked</span>
              <span className="flex items-center gap-2 text-right font-medium">
                {prettyDate(status.lastCheckedAt)}
                <Badge variant={RTW_STATUS_BADGE[status.level]}>
                  {status.label}
                </Badge>
              </span>
            </div>
            <p className="text-xs text-gray-500">{status.detail}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Date of check</Label>
              <DatePickerSingle date={checkedAt} setDate={setCheckedAt} />
            </div>
            <div className="space-y-1.5">
              <Label>What was checked</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select document" />
                </SelectTrigger>
                <SelectContent>
                  {RTW_DOCUMENT_TYPES.map((doc) => (
                    <SelectItem key={doc.value} value={doc.value}>
                      {doc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {documentType === "Share code" && (
            <div className="space-y-1.5">
              <Label htmlFor="rtw-share-code">Share code (optional)</Label>
              <Input
                id="rtw-share-code"
                placeholder="e.g. W12 345 678"
                value={shareCode}
                onChange={(e) => setShareCode(e.target.value)}
              />
            </div>
          )}

          {!isBritish && (
            <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={visaUpdated}
                  onCheckedChange={(v) => setVisaUpdated(Boolean(v))}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  The visa was renewed, extended or switched
                  <span className="block text-xs text-gray-500">
                    Tick this to update the visa details as part of the check.
                    The new check is stored against the new expiry date.
                  </span>
                </span>
              </label>

              {visaUpdated && (
                <div className="space-y-3 pt-1">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>New visa start date</Label>
                      <DatePickerSingle
                        date={visaStartDate}
                        setDate={setVisaStartDate}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>New visa expiry date</Label>
                      <DatePickerSingle
                        date={visaEndDate}
                        setDate={setVisaEndDate}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rtw-visa-category">
                      Visa category (optional)
                    </Label>
                    <Input
                      id="rtw-visa-category"
                      placeholder="e.g. Skilled Worker"
                      value={immigrationCategory}
                      onChange={(e) => setImmigrationCategory(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rtw-note">Notes (optional)</Label>
            <Textarea
              id="rtw-note"
              rows={2}
              maxLength={500}
              placeholder="e.g. Share code verified on the Home Office site, copy filed"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {history.length > 0 && (
            <div className="space-y-1.5">
              <Label>Previous checks ({history.length})</Label>
              <ScrollArea className="max-h-40 rounded-md border">
                <ul className="divide-y text-sm">
                  {history.map((check, index) => (
                    <li
                      key={check?._id || index}
                      className="space-y-0.5 px-3 py-2"
                    >
                      <div className="flex justify-between gap-3">
                        <span className="font-medium">
                          {prettyDate(check?.checkedAt)}
                        </span>
                        <span className="text-xs text-gray-500">
                          {check?.documentType || "—"}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        Visa expiry at the time:{" "}
                        {check?.visaEndDate
                          ? format(new Date(check.visaEndDate), "PPP")
                          : "—"}
                        {check?.checkedBy?.name
                          ? ` · by ${check.checkedBy.name}`
                          : ""}
                      </div>
                      {check?.note && (
                        <p className="text-xs text-gray-600">{check.note}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <BadgeCheck />
            )}
            Record check
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RightToWorkDialog;
