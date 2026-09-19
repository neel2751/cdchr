"use client";

import { useState } from "react";
import { FormProvider } from "react-hook-form";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { CheckIcon, Loader2, LogOutIcon, RefreshCw, XIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { FormInput } from "../form/form-field";
import useGlobalForm from "@/hooks/useGlobalForm";
import { useSubmitMutation } from "@/hooks/use-mutate";
import {
  MIN_PASSWORD_LENGTH,
  describeStrength,
  generatePassword,
} from "@/lib/passwordStrength";
import { changeOfficeEmployeePassword } from "@/server/officeServer/officeEmployeeDetails";
import { signOutAllDevices } from "@/server/authServer/authServer";
import { useAvatar } from "../Avatar/AvatarContext";
import { TwoFactorAuthCard } from "../2FA/2FA";

/**
 * What a password has to have, checked live.
 *
 * Replaces a static bullet list that sat next to a decorative illustration
 * hotlinked from notioly.com — which never rendered, because the CSP in
 * next.config.mjs allows images from 'self', our own S3 and Cloudinary and
 * nowhere else. A broken image beside the rules is worse than no image, and a
 * list that ticks itself off as you type is more use than either.
 */
const RULES = [
  {
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (v) => v.length >= MIN_PASSWORD_LENGTH,
  },
  { label: "A lowercase letter", test: (v) => /[a-z]/.test(v) },
  { label: "An uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { label: "A number", test: (v) => /\d/.test(v) },
  { label: "A special character", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export default function PasswordChange() {
  const { slug } = useAvatar();
  const [justChanged, setJustChanged] = useState(false);

  const method = useGlobalForm(
    { password: "", newPassword: "", confirmPassword: "" },
    null
  );
  const { watch, setValue, handleSubmit, reset } = method;
  const newPassword = watch("newPassword") || "";
  const strength = describeStrength(newPassword);

  const { mutate: submit, isPending } = useSubmitMutation({
    mutationFn: async (data) =>
      await changeOfficeEmployeePassword(data, slug?.[0]),
    onSuccessMessage: () => "Password updated",
    onClose: () => {
      reset({ password: "", newPassword: "", confirmPassword: "" });
      setJustChanged(true);
    },
  });

  const { mutate: endSessions, isPending: isEnding } = useSubmitMutation({
    mutationFn: async () => await signOutAllDevices(),
    onSuccessMessage: () => "Signed out everywhere — redirecting",
    // Nothing to invalidate: the next request from this tab would be refused
    // anyway. Leaving instead of pretending the page still works.
    onClose: () => signOut({ callbackUrl: "/auth" }),
  });

  /**
   * Fill both boxes and put the value on the clipboard.
   *
   * Filling only the first would leave a 16-character random string to be
   * retyped into the confirm box, which is the transcription most likely to go
   * wrong. Same helper the admin reset dialog uses, so "generated" means the
   * same strength on both screens.
   */
  const handleGenerate = async () => {
    const generated = generatePassword();
    setValue("newPassword", generated, {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue("confirmPassword", generated, {
      shouldValidate: true,
      shouldDirty: true,
    });
    try {
      await navigator.clipboard.writeText(generated);
      toast.success("Password generated and copied — save it somewhere safe");
    } catch {
      toast.success("Password generated — reveal it with the eye icon to copy");
    }
  };

  const currentField = {
    name: "password",
    labelText: "Current password",
    type: "password",
    placeholder: "Your password today",
    validationOptions: { required: "Your current password is required" },
  };

  const newField = {
    name: "newPassword",
    labelText: "New password",
    type: "password",
    placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`,
    validationOptions: {
      required: "A new password is required",
      validate: (value) =>
        RULES.every((rule) => rule.test(value || "")) ||
        "Meet all five requirements below",
      // Re-check the confirm box when this one changes, or correcting a typo
      // here leaves a stale "Passwords do not match" under a matching pair.
      deps: ["confirmPassword"],
    },
  };

  const confirmField = {
    name: "confirmPassword",
    labelText: "Confirm new password",
    type: "password",
    placeholder: "Re-enter the new password",
    validationOptions: {
      required: "Please confirm the new password",
      validate: (value, values) =>
        value === values.newPassword || "Passwords do not match",
    },
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Changing your password here does not sign out your other devices —
            use the control below if you want that too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormProvider {...method}>
            <form
              onSubmit={handleSubmit((values) => submit(values))}
              className="space-y-5 max-w-md"
            >
              <FormInput field={currentField} autoComplete="current-password" />

              <div className="space-y-2">
                <FormInput field={newField} autoComplete="new-password" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-indigo-600 hover:text-indigo-700 -ml-2"
                  onClick={handleGenerate}
                >
                  <RefreshCw className="size-3.5 mr-1.5" />
                  Generate a strong one
                </Button>
              </div>

              {newPassword && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={`h-1 flex-1 rounded-full ${
                          i <= strength.score ? strength.bar : "bg-neutral-200"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {strength.label
                      ? `Strength: ${strength.label}`
                      : "Strength: too short"}
                  </p>
                </div>
              )}

              <ul className="space-y-1">
                {RULES.map((rule) => {
                  const met = rule.test(newPassword);
                  return (
                    <li
                      key={rule.label}
                      className={`flex items-center gap-2 text-xs ${
                        met ? "text-emerald-700" : "text-muted-foreground"
                      }`}
                    >
                      {met ? (
                        <CheckIcon className="size-3.5 shrink-0" />
                      ) : (
                        <XIcon className="size-3.5 shrink-0 opacity-40" />
                      )}
                      {rule.label}
                    </li>
                  );
                })}
              </ul>

              <FormInput field={confirmField} autoComplete="new-password" />

              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                Update password
              </Button>

              {justChanged && (
                <p className="text-xs text-emerald-700">
                  Password updated. Any other device you are signed in on is
                  still signed in.
                </p>
              )}
            </form>
          </FormProvider>
        </CardContent>
      </Card>

      <TwoFactorAuthCard className="max-w-max" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign out everywhere</CardTitle>
          <CardDescription>
            Ends every session on every device. Use it if you have signed in
            somewhere you no longer trust, or after changing your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={isEnding}>
                {isEnding ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <LogOutIcon className="size-4 mr-2" />
                )}
                Sign out of all devices
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Sign out of all devices, including this one?
                </AlertDialogTitle>
                {/* Stated plainly because it cannot be otherwise: sessions are
                    JWTs refused by issue time, so there is no token this could
                    spare. Better to say so than to sign someone out of the page
                    they are standing on without warning. */}
                <AlertDialogDescription>
                  This ends every session, here included, and you will be
                  signed out immediately. Your password does not change — sign
                  back in with the one you use now.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => endSessions()}>
                  Sign out everywhere
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
