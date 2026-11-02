"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, FileUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  REVIEW_INTERVAL_OPTIONS,
  addMonthsToDay,
  describeReviewDue,
  reviewUrgency,
} from "@/lib/policies";
import {
  markPolicyReviewed,
  updatePolicyReviewSchedule,
} from "@/server/policyServer/policyServer";

// Radix Select cannot hold an empty value.
const NO_INTERVAL = "none";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

/** A working day as the "YYYY-MM-DD" a date input wants. */
const toInputDate = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

/** Today in the UK, as a working day — what the server counts from. */
function ukToday() {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  return new Date(`${key}T00:00:00Z`);
}

const intervalLabel = (months) =>
  months % 12 === 0
    ? `Every ${months === 12 ? "year" : `${months / 12} years`}`
    : `Every ${months} months`;

const URGENCY_CARD = {
  overdue: "border-red-200 bg-red-50",
  soon: "border-amber-200 bg-amber-50",
  ok: "",
};

/**
 * When this policy is next looked at, and every time it has been.
 *
 * Two ways to review, said plainly on the page because the second is easy to
 * miss: mark it reviewed when nothing needs to change, or publish a new
 * version, which counts as the review on its own.
 *
 * PolicyDetail remounts this whenever the policy is saved, so the schedule
 * form always starts from what is stored.
 */
export default function ReviewPanel({ policy }) {
  const queryClient = useQueryClient();
  const [intervalValue, setIntervalValue] = useState(
    policy.reviewIntervalMonths ? String(policy.reviewIntervalMonths) : NO_INTERVAL,
  );
  const [nextDate, setNextDate] = useState(toInputDate(policy.nextReviewDate));
  const [reviewOpen, setReviewOpen] = useState(false);

  const published = policy.status === "active";
  const urgency = reviewUrgency(policy.daysUntilReview);
  const reviews = policy.reviews || [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["policy", policy._id] });
    queryClient.invalidateQueries({ queryKey: ["policies"] });
    queryClient.invalidateQueries({ queryKey: ["policyReviewsDue"] });
  };

  const scheduleDirty =
    intervalValue !== (policy.reviewIntervalMonths ? String(policy.reviewIntervalMonths) : NO_INTERVAL) ||
    nextDate !== toInputDate(policy.nextReviewDate);

  const { mutate: saveSchedule, isPending: savingSchedule } = useMutation({
    mutationFn: () =>
      updatePolicyReviewSchedule(policy._id, {
        intervalMonths: intervalValue === NO_INTERVAL ? null : Number(intervalValue),
        // Left out unless the manager changed it, which tells the server to
        // work it out from the interval. "" is a deliberate clear.
        nextReviewDate:
          nextDate !== toInputDate(policy.nextReviewDate) ? nextDate : undefined,
      }),
    onSuccess: (res) => {
      if (!res?.success) return toast.error(res?.message || "Could not save");
      toast.success(res.message || "Saved");
      refresh();
    },
    onError: (err) => toast.error(err?.message || "Could not save"),
  });

  return (
    <div className="space-y-4">
      <Card className={URGENCY_CARD[published ? urgency : "ok"]}>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="space-y-0.5">
            <p className="font-medium">
              {!published
                ? "Reviews start once a version is published."
                : policy.nextReviewDate
                  ? `Next review ${formatDate(policy.nextReviewDate)}`
                  : "No review scheduled"}
            </p>
            <p className="text-sm text-muted-foreground">
              {published && policy.nextReviewDate
                ? `${describeReviewDue(policy.daysUntilReview)}. `
                : ""}
              {policy.lastReviewedAt
                ? `Last reviewed ${formatDate(policy.lastReviewedAt)}${policy.lastReviewedByName ? ` by ${policy.lastReviewedByName}` : ""}.`
                : published
                  ? "Not reviewed since it was published."
                  : ""}
            </p>
          </div>
          {published ? (
            <Button onClick={() => setReviewOpen(true)}>
              <CalendarCheck className="mr-1.5 size-4" />
              Mark as reviewed
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Review</Label>
              <Select value={intervalValue} onValueChange={setIntervalValue}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REVIEW_INTERVAL_OPTIONS.map((months) => (
                    <SelectItem key={months} value={String(months)}>
                      {intervalLabel(months)}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_INTERVAL}>No regular review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next-review">Next review</Label>
              <Input
                id="next-review"
                type="date"
                value={nextDate}
                min={toInputDate(ukToday())}
                onChange={(e) => setNextDate(e.target.value)}
                disabled={!published && !policy.nextReviewDate}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Reminders go to the owner — or the HR mailbox if there is none — 30
            days before, 7 days before, on the day, and weekly while overdue.
            Every review starts the clock again.
          </p>
          <div className="flex justify-end">
            <Button
              variant="outline"
              disabled={!scheduleDirty || savingSchedule}
              onClick={() => saveSchedule()}
            >
              Save schedule
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <ul className="divide-y">
              {reviews.map((review) => {
                const late =
                  review.dueDate &&
                  new Date(review.reviewedAt) >
                    new Date(new Date(review.dueDate).getTime() + 86400000);
                return (
                  <li key={review._id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {review.outcome === "new-version" ? (
                        <>
                          <FileUp className="size-4 text-muted-foreground" />
                          <span className="font-medium">
                            Version {review.versionNumber} published
                          </span>
                        </>
                      ) : (
                        <>
                          <CalendarCheck className="size-4 text-muted-foreground" />
                          <span className="font-medium">Reviewed — no changes</span>
                        </>
                      )}
                      {late ? <Badge variant="secondary">Late</Badge> : null}
                    </div>
                    {review.note ? (
                      <p className="whitespace-pre-line text-sm">{review.note}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {formatDate(review.reviewedAt)}
                      {review.reviewedByName ? ` by ${review.reviewedByName}` : ""}
                      {review.dueDate ? ` · was due ${formatDate(review.dueDate)}` : ""}
                      {review.nextReviewDate
                        ? ` · next ${formatDate(review.nextReviewDate)}`
                        : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as reviewed</DialogTitle>
            <DialogDescription>
              Version {policy.currentVersionNumber} stays in force. If it needs
              to change, upload a new version instead — that counts as the
              review.
            </DialogDescription>
          </DialogHeader>
          <MarkReviewedForm
            policy={policy}
            onDone={() => {
              setReviewOpen(false);
              refresh();
            }}
            onCancel={() => setReviewOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Inside DialogContent, so every open starts from the policy's own interval. */
function MarkReviewedForm({ policy, onDone, onCancel }) {
  const suggested = policy.reviewIntervalMonths
    ? toInputDate(addMonthsToDay(ukToday(), policy.reviewIntervalMonths))
    : "";
  const [note, setNote] = useState("");
  const [nextDate, setNextDate] = useState(suggested);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      markPolicyReviewed(policy._id, {
        note,
        // Left out when it is still the suggestion, so the server works the
        // date out itself against the UK day. "" is a deliberate "no more".
        nextReviewDate: nextDate !== suggested ? nextDate : undefined,
      }),
    onSuccess: (res) => {
      if (!res?.success) return toast.error(res?.message || "Could not save");
      toast.success(res.message || "Reviewed");
      onDone();
    },
    onError: (err) => toast.error(err?.message || "Could not save"),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="review-note">Notes (optional)</Label>
        <Textarea
          id="review-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Checked against the new fire risk assessment; still accurate."
          rows={3}
          maxLength={2000}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="review-next">Next review</Label>
        <Input
          id="review-next"
          type="date"
          value={nextDate}
          min={toInputDate(new Date(ukToday().getTime() + 86400000))}
          onChange={(e) => setNextDate(e.target.value)}
          className="w-48"
        />
        {!nextDate ? (
          <p className="text-xs text-muted-foreground">
            Leave empty to schedule no further review.
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          Mark as reviewed
        </Button>
      </DialogFooter>
    </form>
  );
}
