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
  testSMTPConnection,
  updateSMTPAdvance,
} from "@/server/email/emailSMTP";
import { toast } from "sonner";
import { useSubmitMutation } from "@/hooks/use-mutate";
import EmailForm from "./emailForm";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import EmailTable from "./emailTable";
import { useFetchQuery } from "@/hooks/use-query";

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
        { value: "other", label: "Custom SMTP" },
      ],
      placeholder: "Enter SMTP host",
    },
    {
      name: "otherHost",
      labelText: "Custom SMTP Host",
      type: "text",
      placeholder: "Enter your custom SMTP host",
      showIf: {
        field: "host",
        value: "other",
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
    {
      name: "feature",
      labelText: "Feature",
      type: "text",
      placeholder: "e.g., Invoice, HR Bot",
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
          "Are you sure you want to save without testing the connection?"
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
      console.error("Error submitting form:", error);
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
