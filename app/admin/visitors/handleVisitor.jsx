"use client";
import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { handleOrUpdateVisitor } from "@/server/visitorServer";

import React from "react";

export default function HandleVisitor({
  open,
  onOpenChange,
  title,
  initialValues = null,
  description,
  queryKey = ["visitorList"],
}) {
  const fields = [
    {
      name: "visitorType",
      labelText: "Visitor Type",
      type: "select",
      options: [
        { value: "guest", label: "Guest" },
        { value: "contractor", label: "Contractor" },
        { value: "supplier", label: "Supplier" },
        { value: "other", label: "Other" },
      ],
      size: true,
      placeholder: "Select visitor type",
      validationOptions: {
        required: "Visitor type is required",
      },
    },

    {
      name: "visitorPurpose",
      labelText: "Visit Purpose",
      type: "select",
      options: [
        { value: "meeting", label: "Pre Arrange Meeting" },
        { value: "walkIn", label: "Walk In" },
        { value: "delivery", label: "Delivery" },
        { label: "Family Visit", value: "familyVisit" },
        { label: "Visit for Quotation", value: "quotationVisit" },
        { label: "Business Visit", value: "businessVisit" },
        { value: "other", label: "Other" },
      ],
      placeholder: "Select visit purpose",
      validationOptions: {
        required: "Visit purpose is required",
      },
    },
    {
      name: "otherPurpose",
      labelText: "Other Purpose",
      type: "textarea",
      size: true,
      placeholder: "Enter other purpose of visit",
      showIf: {
        field: "visitorPurpose",
        value: "other",
      },
      validationOptions: {
        required: "Other purpose is required",
      },
    },
  ];
  const newVisitorFields = [
    {
      name: "visitorName",
      labelText: "Name",
      type: "text",
      size: true,
      placeholder: "Enter visitor's name",
      validationOptions: {
        required: "Name is required",
      },
    },
    {
      name: "visitorEmail",
      labelText: "Email",
      type: "email",
      placeholder: "Enter visitor's email",
      validationOptions: {
        required: "Email is required",
        pattern: {
          value: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
          message: "Invalid email address",
        },
      },
    },
    {
      name: "visitorPhone",
      labelText: "Phone Number",
      type: "number",
      placeholder: "Enter visitor's phone number",
      validationOptions: {
        required: "Phone number is required",
        pattern: {
          value: /^\d{10}$/,
          message: "Phone number must be 10 digits",
        },
      },
    },
  ];

  const consetField = {
    name: "visitorConsent",
    labelText:
      "We collect your personal data to handle your visit. By checking this box, you consent to the processing of your personal data for this purpose.",
    type: "checkbox",
    size: true,
    placeholder: "Visitor consent",
    validationOptions: {
      required: "Visitor consent is required",
    },
  };

  const fieldsWithNewVisitor = [...newVisitorFields, ...fields, consetField];
  const allFields = initialValues ? fields : fieldsWithNewVisitor;

  const { mutate: handleVisitor } = useSubmitMutation({
    mutationFn: async (data) =>
      await handleOrUpdateVisitor({
        ...data,
        purposeId: initialValues ? initialValues.purposeId : null,
        visitorName: initialValues
          ? initialValues.visitorName
          : data.visitorName,
        visitorEmail: initialValues
          ? initialValues.visitorEmail
          : data.visitorEmail,
        visitorPhone: initialValues
          ? initialValues.visitorPhone
          : data.visitorPhone,
      }),
    onSuccessMessage: (message) => message || "Visitor handled successfully",
    invalidateKey: queryKey,
    onClose: () => {
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title ? title : "Visitor Details"}</DialogTitle>
          <DialogDescription>
            {description
              ? description
              : "Details of the visitor will be shown here."}
          </DialogDescription>
        </DialogHeader>
        <GlobalForm
          fields={allFields}
          onSubmit={handleVisitor}
          btnName={"Submit"}
          initialValues={initialValues}
        />
      </DialogContent>
    </Dialog>
  );
}
