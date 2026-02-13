"use client";
import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { useSelectFormTemplate } from "@/hooks/useSelect/useSelect";
import { createQrCode } from "@/server/QrCodeServer/qrServer";
import React from "react";

export default function CreateQrCode({
  open,
  onOpenChange,
  title,
  description,
  initialValues,
  invalidateKeys,
}) {
  const data = useSelectFormTemplate();

  const fields = [
    {
      name: "title",
      labelText: "Title",
      type: "text",
      placeholder: "Enter title for QR Code",
      validationOptions: {
        required: "Title is required",
        minLength: {
          value: 3,
          message: "Title must be at least 3 characters long",
        },
        maxLength: {
          value: 100,
          message: "Title must be at most 100 characters long",
        },
      },
    },
    {
      name: "formTitle",
      labelText: "Form Title",
      type: "text",
      placeholder: "Enter title for the visitor form",
      validationOptions: {
        required: "Form Title is required",
        minLength: {
          value: 3,
          message: "Form Title must be at least 3 characters long",
        },
        maxLength: {
          value: 100,
          message: "Form Title must be at most 100 characters long",
        },
      },
    },
    {
      name: "successMessage",
      labelText: "Success Message",
      type: "text",
      placeholder: "Enter success message for visitors",
      validationOptions: {
        required: "Success Message is required",
        minLength: {
          value: 3,
          message: "Success Message must be at least 3 characters long",
        },
        maxLength: {
          value: 200,
          message: "Success Message must be at most 200 characters long",
        },
      },
    },
    {
      name: "templateId",
      labelText: "Form Template ID",
      type: "select",
      options: data || [],
      placeholder: "Enter the Form Template ID to use",
      validationOptions: {
        required: "Form Template ID is required",
      },
    },
    // {
    //   name: "customDomain",
    //   labelText: "Custom Domain (optional)",
    //   type: "text",
    //   placeholder: "form.cdcproperty.management",
    //   validationOptions: {
    //     pattern: {
    //       value:
    //         /^(https?:\/\/)?([a-zA-Z0-9-]+\.)?cdcproperty\.management(\/[a-zA-Z0-9-]+)*\/?$/,
    //       message:
    //         "Custom Domain must be a valid subdomain of cdcproperty.management",
    //     },
    //   },
    // },
    {
      name: "image",
      labelText: "Upload Image (optional)",
      type: "image",
      maxFileSize: 1024 * 1024 * 2, // 2MB
      maxFiles: 1,
      acceptedFileTypes: ["image/jpeg", "image/png", "image/svg+xml"],
    },
  ];

  const { mutate: handleSubmit } = useSubmitMutation({
    mutationFn: async (data) => await createQrCode(data),
    invalidateKey: invalidateKeys,
    onSuccessMessage: (message) => message || "QR Code created successfully!",
    onClose: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title ? title : "Create QR Code"}</DialogTitle>
          <DialogDescription>
            {description
              ? description
              : "Fill out the form below to create a new QR Code for visitor check-in."}
          </DialogDescription>
        </DialogHeader>
        <GlobalForm
          fields={fields}
          onSubmit={handleSubmit}
          initialValues={initialValues}
          btnName={"Create QR Code"}
        />
      </DialogContent>
    </Dialog>
  );
}
