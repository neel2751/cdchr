"use client";

import { useMemo, useState } from "react";
import { format, isValid } from "date-fns";
import { ClockIcon, PencilIcon, SendIcon, XIcon } from "lucide-react";
import { useAvatar } from "@/components/Avatar/AvatarContext";
import { GlobalForm } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useFetchQuery } from "@/hooks/use-query";
import { useSubmitMutation } from "@/hooks/use-mutate";
import {
  NOTE_ONLY_REQUESTS,
  PROFILE_SECTIONS,
  REQUESTABLE_FIELDS,
} from "@/lib/profileFields";
import {
  cancelProfileChangeRequest,
  getMyProfileChangeRequests,
  requestProfileChange,
  updateMyProfile,
} from "@/server/officeServer/profileChangeServer";
import ProfilePhoto from "./profilePhoto";

const REQUESTS_KEY = ["my-profile-change-requests"];

/** A stored value as a person reads it. */
function displayValue(record, field) {
  const raw = record?.[field.name];
  if (raw === null || raw === undefined || raw === "") return "—";
  if (field.type === "date") {
    const date = new Date(raw);
    return isValid(date) ? format(date, "d MMM yyyy") : String(raw);
  }
  return String(raw);
}

/** The same value shaped for a form control. */
function formValue(record, field) {
  const raw = record?.[field.name];
  if (raw === null || raw === undefined) return "";
  if (field.type === "date") {
    const date = new Date(raw);
    return isValid(date) ? date : "";
  }
  return raw;
}

const STATUS_STYLE = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  cancelled: "bg-neutral-100 text-neutral-600",
};

/**
 * An employee's own record: shown, not edited — with two exceptions.
 *
 * The fields marked `self` in lib/profileFields.js are edited in place, because
 * nobody else knows a person's new phone number and nothing depends on it being
 * verified. Everything else is read-only with a way to ask, because changing it
 * is somebody's decision and the record should say who made it.
 *
 * The screen is generated from that table rather than laid out by hand, so a
 * field can only appear here in a state the server will actually honour.
 */
export default function MyProfile() {
  const { newData: record } = useAvatar();
  const [editSection, setEditSection] = useState(null);
  const [requestField, setRequestField] = useState(null);

  const { data } = useFetchQuery({
    fetchFn: getMyProfileChangeRequests,
    queryKey: REQUESTS_KEY,
  });
  const requests = useMemo(() => data?.newData || [], [data]);

  const pendingByField = useMemo(() => {
    const map = {};
    for (const row of requests) {
      if (row?.status === "pending") map[row.field] = row;
    }
    return map;
  }, [requests]);

  const { mutate: saveSection, isPending: isSaving } = useSubmitMutation({
    mutationFn: async (values) => await updateMyProfile(values),
    onSuccessMessage: () => "Saved",
    invalidateKey: ["employeeDeatils"],
    onClose: () => setEditSection(null),
  });

  const { mutate: sendRequest, isPending: isSending } = useSubmitMutation({
    mutationFn: async (values) => await requestProfileChange(values),
    onSuccessMessage: (message) => message || "Sent to HR",
    invalidateKey: REQUESTS_KEY,
    onClose: () => setRequestField(null),
  });

  const { mutate: withdraw } = useSubmitMutation({
    mutationFn: async (id) => await cancelProfileChangeRequest(id),
    onSuccessMessage: (message) => message || "Withdrawn",
    invalidateKey: REQUESTS_KEY,
    onClose: () => {},
  });

  const openSection = PROFILE_SECTIONS.find((s) => s.key === editSection);
  const openRequest = requestField ? REQUESTABLE_FIELDS[requestField] : null;

  return (
    <div className="space-y-6">
      <div>
        <CardTitle>My details</CardTitle>
        <CardDescription className="mt-1">
          Your address and emergency contact are yours to change. For anything
          else, ask HR — they keep the record and the change is logged against
          it.
        </CardDescription>
      </div>

      <ProfilePhoto />

      {PROFILE_SECTIONS.map((section) => {
        const selfFields = section.fields.filter((f) => f.access === "self");
        const requestable = section.fields.filter(
          (f) => f.access === "request"
        );

        return (
          <Card key={section.key}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">{section.title}</CardTitle>
                {section.description && (
                  <CardDescription>{section.description}</CardDescription>
                )}
              </div>
              {selfFields.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditSection(section.key)}
                >
                  <PencilIcon className="size-3.5 mr-1.5" />
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                {section.fields.map((field) => {
                  const pending = pendingByField[field.name];
                  return (
                    <div key={field.name} className="space-y-0.5">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {field.label}
                      </dt>
                      <dd className="text-sm text-primary break-words">
                        {displayValue(record, field)}
                      </dd>
                      {pending && (
                        <p className="text-xs text-amber-700 flex items-center gap-1">
                          <ClockIcon className="size-3" />
                          Change to &ldquo;{pending.newValue}&rdquo; waiting with
                          HR
                        </p>
                      )}
                      {field.hint && (
                        <p className="text-xs text-muted-foreground">
                          {field.hint}
                        </p>
                      )}
                    </div>
                  );
                })}
              </dl>

              {requestable.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-4 mt-4 border-t border-dashed">
                  {requestable.map((field) => (
                    <Button
                      key={field.name}
                      size="sm"
                      variant="ghost"
                      className="text-indigo-600 hover:text-indigo-700"
                      disabled={!!pendingByField[field.name]}
                      onClick={() => setRequestField(field.name)}
                    >
                      <SendIcon className="size-3.5 mr-1.5" />
                      {pendingByField[field.name]
                        ? `${field.label} — requested`
                        : `Request a change to ${field.label}`}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* The two things that never travel through a form, and the catch-all. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bank details &amp; NI</CardTitle>
          <CardDescription>
            Not shown here, and not changed here. HR confirms these with you
            directly — never put an account number or an NI number in a note.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {NOTE_ONLY_REQUESTS.map((entry) => (
            <Button
              key={entry.name}
              size="sm"
              variant="outline"
              disabled={!!pendingByField[entry.name]}
              onClick={() => setRequestField(entry.name)}
            >
              {pendingByField[entry.name]
                ? `${entry.label} — requested`
                : entry.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      {requests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What you have asked for</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {requests.map((row) => (
              <div
                key={row._id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-dashed pb-3 last:border-0 last:pb-0"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {row.label || row.field}
                    {row.newValue ? ` → ${row.newValue}` : ""}
                  </p>
                  {row.reason && (
                    <p className="text-xs text-muted-foreground">
                      {row.reason}
                    </p>
                  )}
                  {row.decisionNote && (
                    <p className="text-xs text-muted-foreground">
                      HR said: {row.decisionNote}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={`${
                      STATUS_STYLE[row.status] || STATUS_STYLE.cancelled
                    } capitalize`}
                    variant="secondary"
                  >
                    {row.status}
                  </Badge>
                  {row.status === "pending" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => withdraw(row._id)}
                    >
                      <XIcon className="size-3.5" />
                      <span className="sr-only">Withdraw</span>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Editing the fields that are yours */}
      <Dialog
        open={!!openSection}
        onOpenChange={(open) => !open && setEditSection(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{openSection?.title}</DialogTitle>
            <DialogDescription>
              Saved straight away. HR sees the change in the record&rsquo;s history.
            </DialogDescription>
          </DialogHeader>
          {openSection && (
            <GlobalForm
              btnName="Save"
              isLoading={isSaving}
              fields={openSection.fields
                .filter((f) => f.access === "self")
                .map((f) => ({
                  name: f.name,
                  labelText: f.label,
                  type: f.type,
                  placeholder: f.label,
                  size: true,
                }))}
              initialValues={Object.fromEntries(
                openSection.fields
                  .filter((f) => f.access === "self")
                  .map((f) => [f.name, formValue(record, f)])
              )}
              onSubmit={(values) => saveSection(values)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Asking for everything else */}
      <Dialog
        open={!!openRequest}
        onOpenChange={(open) => !open && setRequestField(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {openRequest?.noteOnly
                ? openRequest?.label
                : `Request a change to ${openRequest?.label}`}
            </DialogTitle>
            <DialogDescription>
              {openRequest?.blurb ||
                "HR reviews this and applies it if it is right. Nothing changes until they do."}
            </DialogDescription>
          </DialogHeader>
          {openRequest && (
            <GlobalForm
              btnName="Send to HR"
              isLoading={isSending}
              fields={[
                ...(openRequest.noteOnly
                  ? []
                  : [
                      {
                        name: "newValue",
                        labelText: `${openRequest.label} should be`,
                        type: openRequest.type === "date" ? "date" : "text",
                        placeholder: openRequest.label,
                        size: true,
                        validationOptions: {
                          required: "Enter the value it should be",
                        },
                      },
                    ]),
                {
                  name: "reason",
                  labelText: openRequest.noteOnly
                    ? "What needs changing?"
                    : "Why (optional)",
                  type: "textarea",
                  placeholder: openRequest.noteOnly
                    ? "Tell HR what is wrong"
                    : "Anything that helps HR check it",
                  size: true,
                  ...(openRequest.noteOnly
                    ? {
                        validationOptions: {
                          required: "Tell HR what needs changing",
                        },
                      }
                    : {}),
                },
              ]}
              onSubmit={(values) =>
                sendRequest({
                  field: requestField,
                  newValue: values.newValue,
                  reason: values.reason,
                })
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
