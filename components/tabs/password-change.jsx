"use client";
import { Card, CardContent, CardDescription, CardTitle } from "../ui/card";
import { GlobalForm } from "../form/form";
import { useState } from "react";
import { useSubmitMutation } from "@/hooks/use-mutate";
import { changeOfficeEmployeePassword } from "@/server/officeServer/officeEmployeeDetails";
import { useAvatar } from "../Avatar/AvatarContext";
import { TwoFactorAuthCard } from "../2FA/2FA";
export default function PasswordChange() {
  const [resetForm, setResetForm] = useState(false);
  const { slug } = useAvatar();

  const { mutate: handleSubmit } = useSubmitMutation({
    mutationFn: async (data) =>
      await changeOfficeEmployeePassword(data, slug[0]),
    onSuccessMessage: () => "Password updated successfully",
    onClose: () => setResetForm(true),
  });

  const field = [
    {
      name: "password",
      labelText: "Current Password",
      type: "password",
      placeholder: "******",
      size: true,
      validationOptions: {
        required: "Password is required",
        minLength: {
          value: 8,
          message: "Minimum length should be 8 characters",
        },
      },
    },
    {
      name: "newPassword",
      labelText: "New Password",
      type: "password",
      placeholder: "******",
      size: true,
      validationOptions: {
        required: "New password is required",
        pattern: {
          value:
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
          message:
            "Password must be at least 8 characters long, contain uppercase and lowercase letters, numbers, and special characters.",
        },
        minLength: {
          value: 6,
          message: "Minimum length should be 6 characters",
        },
      },
    },
    {
      name: "confirmPassword",
      labelText: "Confirm Password",
      type: "password",
      placeholder: "******",
      size: true,
      validationOptions: {
        required: "Confirm password is required",
        pattern: {
          value:
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
          message:
            "Password must be at least 8 characters long, contain uppercase and lowercase letters, numbers, and special characters.",
        },
        minLength: {
          value: 8,
          message: "Minimum length should be 8 characters",
        },
        validate: (value, formValues) =>
          value === formValues.newPassword ||
          "New password and confirm password do not match",
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <CardTitle>Change Password</CardTitle>
        <CardDescription>
          Enter your current password and a new password to change your
          password.
        </CardDescription>
        <TwoFactorAuthCard />
        <Card
          className={"text-neutral-700 border- shadow-none p-2 max-w-max mt-4"}
        >
          <CardContent className={"flex items-center justify-between"}>
            <ul className="list-disc text-sm">
              <li>Minimum 8 characters</li>
              <li>Contain lowercase</li>
              <li>Contain uppercase</li>
              <li>Contain numbers</li>
              <li>Contain special characters</li>
            </ul>
            <img
              className="w-40 h-40"
              src="https://notioly.com/wp-content/uploads/2023/11/307.Writing.png"
            />
          </CardContent>
        </Card>
      </div>
      <GlobalForm
        fields={field}
        onSubmit={handleSubmit}
        btnName={"Update Password"}
        resetForm={resetForm}
      />
    </div>
  );
}
