"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { GlobalForm } from "@/components/form/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";
import {
  getOneSMTPEmail,
  getUsedEmailFeatures,
  updateSMTPAdvance,
} from "@/server/email/emailSMTP";
import { EMAIL_FEATURES } from "@/data/emailFeatures";

// Same choices the create form offers, so an account can be edited into any
// shape it could have been created in.
const HOST_OPTIONS = [
  { value: "smtp.gmail.com", label: "Gmail" },
  { value: "outlook.office365.com", label: "Microsoft" },
  { value: "smtp.mail.yahoo.com", label: "Yahoo" },
  { value: "smtp.zoho.eu", label: "Zoho" },
  { value: "smtppro.zoho.eu", label: "Zoho Pro" },
  { value: "other", label: "Custom SMTP" },
];

const FIELDS = [
  {
    name: "host",
    labelText: "SMTP Host",
    type: "select",
    options: HOST_OPTIONS,
    placeholder: "Enter SMTP host",
    validationOptions: { required: "Host is required" },
  },
  {
    name: "otherHost",
    labelText: "Custom SMTP Host",
    type: "text",
    placeholder: "e.g. mail.yourcompany.com",
    showIf: { field: "host", value: "other" },
    validationOptions: {
      // Conditional rather than `required`, which would also fire while the
      // field is hidden and block every non-custom host from saving.
      validate: (value, formValues) =>
        formValues?.host !== "other" ||
        !!String(value || "").trim() ||
        "Enter your custom SMTP host",
    },
  },
  {
    name: "port",
    labelText: "Port",
    type: "select",
    options: [
      { value: 465, label: "465 (SSL)" },
      { value: 587, label: "587 (TLS)" },
    ],
  },
  {
    name: "fromName",
    labelText: "From Name",
    type: "text",
    placeholder: "Enter your name or company name",
  },
  // Placeholder — replaced below with the options still available, since only
  // one account per feature is allowed.
  {
    name: "feature",
    labelText: "Used for",
    type: "select",
    options: [],
    placeholder: "Choose what this sender is used for",
    validationOptions: { required: "Choose what this sender is used for" },
  },
  {
    name: "userName",
    labelText: "Username / Email",
    type: "text",
    size: true,
    placeholder: "Enter your email address",
    validationOptions: { required: "Username is required" },
  },
  {
    name: "toEmail",
    labelText: "To Email",
    type: "text",
    size: true,
    placeholder: "Enter recipient email address",
  },
];

/**
 * Edit an existing SMTP account.
 *
 * Was a `<div>EmailEdit</div>` placeholder that also received no id, so there
 * was nothing it could have edited even in principle.
 *
 * The password is deliberately absent: it is never sent to the browser, and
 * changing it has its own tab with confirmation.
 *
 * Note the two id forms. `getOneSMTPEmail` and `updateSMTPPassword` take the
 * ENCRYPTED id from the URL, while `updateSMTPAdvance` does a raw
 * `findByIdAndUpdate` and needs the plain `_id`. The plain one is taken from
 * the loaded record rather than decrypted here, so the encryption stays on the
 * server side of the boundary.
 */
export default function EmailEdit({ smtpId }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [saving, setSaving] = React.useState(false);

  const { data, isLoading } = useFetchQuery({
    fetchFn: getOneSMTPEmail,
    params: smtpId,
    queryKey: ["oneSMTPEmail", smtpId],
  });

  const { newData: smtp } = data || {};

  const { data: usedFeatures = [] } = useFetchSelectQuery({
    queryKey: ["usedEmailFeatures"],
    fetchFn: getUsedEmailFeatures,
  });

  // Only features that are still free, plus this account's own — otherwise the
  // form could not be saved without changing what it is used for.
  const fields = React.useMemo(
    () =>
      FIELDS.map((field) =>
        field.name === "feature"
          ? {
              ...field,
              options: EMAIL_FEATURES.filter(
                (f) =>
                  !usedFeatures.includes(f.value) || f.value === smtp?.feature
              ).map((f) => ({ value: f.value, label: f.label })),
            }
          : field
      ),
    [usedFeatures, smtp?.feature]
  );

  const onSubmit = async (values) => {
    if (!smtp?._id) return;
    setSaving(true);
    try {
      const res = await updateSMTPAdvance(smtp._id, values);
      if (res?.success) {
        toast.success(res.message || "Email account updated");
        queryClient.invalidateQueries({ queryKey: ["oneSMTPEmail", smtpId] });
        queryClient.invalidateQueries({ queryKey: ["getAllSMTPsAdvance"] });
        router.refresh();
      } else {
        toast.error(res?.message || "Could not update");
      }
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!smtp?._id) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-neutral-500">
          This email account could not be loaded.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit email account</CardTitle>
        <CardDescription>
          Changes apply to every message this company sends through this account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GlobalForm
          fields={fields}
          onSubmit={onSubmit}
          isLoading={saving}
          btnName="Save changes"
          // Editing, not creating: the form should keep showing what was saved
          // rather than emptying itself.
          resetForm={false}
          initialValues={{
            host: smtp.host || "",
            otherHost: smtp.otherHost || "",
            port: smtp.port || 587,
            fromName: smtp.fromName || "",
            feature: smtp.feature || "",
            userName: smtp.userName || "",
            toEmail: smtp.toEmail || "",
          }}
        />
      </CardContent>
    </Card>
  );
}
