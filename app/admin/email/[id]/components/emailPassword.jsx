"use client";
import ChangePassword from "@/components/changePassword/password";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { updateSMTPPassword } from "@/server/email/emailSMTP";

export default function ChnageEmailPassword({ smtpId }) {
  const fields = [
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chnage Password</CardTitle>
        <CardDescription>
          Update your password to keep your account secure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChangePassword
          mutationFn={updateSMTPPassword}
          id={smtpId}
          fields={fields}
          queryKey={["getAllSMTPsAdvance"]}
        />
      </CardContent>
    </Card>
  );
}
