"use client";
import React from "react";
import { GlobalForm } from "../form/form";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { toast } from "sonner";

export default function ChangePassword({ mutationFn, id, fields, queryKey }) {
  const [resetForm, setResetForm] = React.useState(false);
  const field = [
    {
      name: "currentPassword",
      type: "password",
      labelText: "Current Password",
      size: true,
      placeholder: "Enter current password",
      validationOptions: {
        required: "Current password is required",
        minLength: {
          value: 8,
          message: "Password must be at least 8 characters long",
        },
      },
    },
    {
      name: "newPassword",
      type: "password",
      labelText: "New Password",
      size: true,
      placeholder: "Enter new password",
      validationOptions: {
        required: "New password is required",
        minLength: {
          value: 8,
          message: "Password must be at least 8 characters long",
        },
      },
    },
    {
      name: "confirmPassword",
      type: "password",
      labelText: "Confirm Password",
      placeholder: "Confirm new password",
      validationOptions: {
        required: "Confirm password is required",
        validate: (value, formValues) =>
          value === formValues.newPassword || "Passwords do not match",
      },
    },
  ];

  const { mutate: handleSubmit, isPending } = useSubmitMutation({
    mutationFn: async (data) => mutationFn({ id, ...data }),
    onSuccessMessage: (message) => message || "Password changed successfully!",
    invalidateKey: queryKey,
    onClose: () => {
      setResetForm(true);
    },
  });

  const handleSubmitForm = (data) => {
    const { newPassword, confirmPassword } = data;
    if (newPassword !== confirmPassword)
      return toast.warning("New and Confirm Password do not match");
    handleSubmit(data);
  };

  return (
    <GlobalForm
      fields={fields || field}
      onSubmit={handleSubmitForm}
      btnName={"Change Password"}
      isLoading={isPending}
      resetForm={resetForm} // Reset form after submission
    />
  );
}
