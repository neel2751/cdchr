"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  addSMTPAdvance,
  getAllSMTPsAdvance,
  getUsedEmailFeatures,
  testSMTPConnection,
  updateSMTPAdvance,
} from "@/server/email/emailSMTP";
import { EMAIL_FEATURES } from "@/data/emailFeatures";
import { toast } from "sonner";
import { useSubmitMutation } from "@/hooks/use-mutate";
import EmailForm from "./emailForm";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import EmailTable from "./emailTable";
import { useFetchQuery, useFetchSelectQuery } from "@/hooks/use-query";

const SMTPConfig = ({ queryKey }) => {
  const [showDialog, setShowDialog] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [initialValues, setInitialValues] = useState(null);

  const handleClose = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(false);
    setIsEdit(false);
  };

  const handleAdd = () => {
    setInitialValues(null);
    setIsEdit(false);
    setShowDialog(true);
  };
  const handleEdit = (item) => {
    setInitialValues(item);
    setIsEdit(true);
    setShowDialog(true);
  };

  const { mutate: handleSubmitForm } = useSubmitMutation({
    mutationFn: async (data) => addSMTPAdvance(data, initialValues?._id),
    onSuccessMessage: (message) =>
      message || "SMTP configuration saved successfully!",
    invalidateKey: queryKey,
    onClose: () => handleClose(),
  });

  const { data } = useFetchQuery({
    fetchFn: getAllSMTPsAdvance,
    queryKey: queryKey || ["getAllSMTPsAdvance"],
  });
  const { newData } = data || {};

  const { data: usedFeatures = [] } = useFetchSelectQuery({
    queryKey: ["usedEmailFeatures"],
    fetchFn: getUsedEmailFeatures,
  });

  // When editing, the account's own feature stays selectable — otherwise the
  // form could not be saved without changing it.
  const featureOptions = EMAIL_FEATURES.filter(
    (f) => !usedFeatures.includes(f.value) || f.value === initialValues?.feature
  ).map((f) => ({ value: f.value, label: f.label }));

  const password = initialValues
    ? {}
    : {
        name: "password",
        labelText: "Password / API Key",
        type: "password",
        placeholder: "Enter your password or API key",
      };

  const fields = [
    {
      name: "host",
      labelText: "SMTP Host",
      type: "select",
      options: [
        { value: "smtp.gmail.com", label: "Gmail" },
        { value: "outlook.office365.com", label: "Microsoft" },
        { value: "smtp.mail.yahoo.com", label: "Yahoo" },
        { value: "smtp.zoho.eu", label: "Zoho" },
        { value: "smtppro.zoho.eu", label: "Zoho Pro" },
        { value: "other", label: "Custom SMTP" },
      ],
      placeholder: "Enter SMTP host",
    },
    {
      name: "otherHost",
      labelText: "Custom SMTP Host",
      type: "text",
      placeholder: "e.g. mail.yourcompany.com",
      showIf: {
        field: "host",
        value: "other",
      },
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
    // A fixed list, not free text. `feature` is the key resolveAccount() looks
    // up when choosing a sender, so a typed value the app never asks for
    // produces an account that silently never sends. The old placeholder
    // suggested "Invoice, HR Bot" — neither of which exists.
    // Already-configured features are filtered out, because only one account
    // per feature is allowed and offering a taken one only leads to an error.
    {
      name: "feature",
      labelText: "Used for",
      type: "select",
      options: featureOptions,
      placeholder:
        featureOptions.length === 0
          ? "Every feature already has a sender"
          : "Choose what this sender is used for",
      validationOptions: { required: "Choose what this sender is used for" },
    },
    {
      name: "userName",
      labelText: "Username / Email",
      type: "text",
      size: initialValues ? true : false,
      placeholder: "Enter your email address",
    },
    password,
    {
      name: "toEmail",
      labelText: "To Email",
      type: "text",
      size: true,
      placeholder: "Enter recipient email address",
    },
    {
      name: "isTest",
      labelText: "Test Connection",
      type: "checkbox",
      description: "Check to test the SMTP connection",
    },
  ];

  const handleSubmit = async (data) => {
    try {
      // alert dialog like if isTest is not true are you sure you don't want to test the connection
      if (!data.isTest) {
        const confirmSave = confirm(
          "Are you sure you want to save without testing the connection?",
        );
        if (!confirmSave) return;

        if (data.isTest) {
          const res = await testSMTPConnection(data);
          if (res.success) {
            toast.success("SMTP connection successful!");
            handleSubmitForm(data);
          } else {
            toast.error("SMTP connection failed: " + res.message);
          }
        } else {
          handleSubmitForm(data);
        }
      }
    } catch (error) {
      console.log("Error submitting form:", error);
      toast.error("Failed to save SMTP configuration");
    }
  };

  return (
    <>
      <Card>
        <CardHeader className={"flex items-center justify-between"}>
          <div className="space-y-2">
            <CardTitle>Email SMTP Configuration</CardTitle>
            <CardDescription>
              Configure your SMTP settings to enable email functionalities in
              the application.
              <br /> You can add, edit, or delete SMTP configurations as needed.
            </CardDescription>
          </div>
          <Button onClick={handleAdd}>Add SMTP Configuration</Button>
        </CardHeader>
        <CardContent>
          <EmailTable
            newData={newData}
            onEdit={handleEdit}
            queryKey={queryKey}
          />
        </CardContent>
      </Card>
      <EmailForm
        showDialog={showDialog}
        setShowDialog={setShowDialog}
        initialValues={initialValues}
        isEdit={isEdit}
        handleSubmit={handleSubmit}
        fields={fields}
      />
    </>
  );
};

export default SMTPConfig;
