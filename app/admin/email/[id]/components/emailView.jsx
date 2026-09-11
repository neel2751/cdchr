"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-query";
import { getOneSMTPEmail } from "@/server/email/emailSMTP";
import { EMAIL_FEATURE_LABEL } from "@/data/emailFeatures";
import { resolveSmtpHost } from "@/lib/smtp";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/** One labelled fact. */
function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-48 shrink-0 text-sm text-neutral-500">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/**
 * The account's settings, read-only.
 *
 * This used to render `JSON.stringify(newData)` — the raw Mongo document,
 * encrypted password field and all, dumped into a card. The fields below are
 * the ones the schema actually carries.
 */
export default function EmailView({ smtpId }) {
  const { data, isLoading, isError } = useFetchQuery({
    fetchFn: getOneSMTPEmail,
    params: smtpId,
    // The id belongs in the key. Without it every account on this screen shared
    // one cache entry, so opening a second one showed the first one's details.
    queryKey: ["oneSMTPEmail", smtpId],
  });

  const { newData: smtp } = data || {};

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (isError || !smtp?._id) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-neutral-500">
          This email account could not be loaded. It may have been removed, or
          you may not have permission to view it.
        </CardContent>
      </Card>
    );
  }

  const host = resolveSmtpHost(smtp);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{host || "Unnamed account"}</CardTitle>
          {smtp.isPrimary && <Badge>Primary</Badge>}
          <Badge variant={smtp.isActive ? "secondary" : "destructive"}>
            {smtp.isActive ? "Active" : "Inactive"}
          </Badge>
          {smtp.isTest && <Badge variant="outline">Test</Badge>}
        </div>
        <CardDescription>
          Used to send {smtp.feature ? `"${smtp.feature}"` : "all"} email for
          this company.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Row label="SMTP host">{host || "—"}</Row>
        <Row label="Port">
          {smtp.port || 587}
          <span className="ml-2 text-xs text-neutral-500">
            {smtp.secure ? "SSL" : "TLS / STARTTLS"}
          </span>
        </Row>
        <Row label="Username">{smtp.userName || "—"}</Row>
        <Row label="Password">
          {smtp.hasPassword ? (
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              Configured
            </Badge>
          ) : (
            <Badge variant="destructive">Not configured</Badge>
          )}
          <span className="ml-2 text-xs text-neutral-500">
            Change it on the Password tab.
          </span>
        </Row>
        <Row label="From name">{smtp.fromName || "—"}</Row>
        <Row label="Reply-to / inbox">{smtp.toEmail || "—"}</Row>
        <Row label="Used for">
          {EMAIL_FEATURE_LABEL[smtp.feature] || smtp.feature || "All email"}
        </Row>
        <Row label="Added">{formatDate(smtp.createdAt)}</Row>
        <Row label="Last updated">{formatDate(smtp.updatedAt)}</Row>
      </CardContent>
    </Card>
  );
}
