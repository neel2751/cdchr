"use client";

import { useTransition } from "react";
import { FormProvider } from "react-hook-form";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { KeyRound, Loader2 } from "lucide-react";
import useGlobalForm from "@/hooks/useGlobalForm";
import { FormInput } from "@/components/form/form-field";
import { homePathForRole } from "@/lib/roleHome";
import {
  MIN_PASSWORD_LENGTH,
  describeStrength,
} from "@/lib/passwordStrength";
import { setOwnPassword } from "@/server/authServer/forcedPasswordServer";

/**
 * The only thing a person can do until they have replaced the password their
 * administrator set.
 *
 * Two fields and nothing else — no sidebar, no tabs, no link back into the app.
 * The current password is not asked for: they typed it moments ago to get here,
 * and asking again only invites them to write the temporary one down while they
 * fetch it.
 *
 * Same reusable form the rest of the app uses, so "Passwords do not match"
 * appears as it is typed rather than after pressing the button.
 */
export default function ForcedPasswordChange({ name, role }) {
  const [isPending, startTransition] = useTransition();

  const method = useGlobalForm(
    { newPassword: "", confirmPassword: "" },
    null
  );
  const { watch, handleSubmit } = method;
  const strength = describeStrength(watch("newPassword"));

  const newPasswordField = {
    name: "newPassword",
    labelText: "New password",
    type: "password",
    placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`,
    validationOptions: {
      required: "Choose a new password",
      minLength: {
        value: MIN_PASSWORD_LENGTH,
        message: `Must be at least ${MIN_PASSWORD_LENGTH} characters`,
      },
      // Re-checks the confirm box when this one is edited, so correcting a typo
      // here clears a mismatch shown below rather than leaving it stale.
      deps: ["confirmPassword"],
    },
  };

  const confirmField = {
    name: "confirmPassword",
    labelText: "Confirm new password",
    type: "password",
    placeholder: "Re-enter the new password",
    validationOptions: {
      required: "Confirm the new password",
      validate: (value, values) =>
        value === values.newPassword || "Passwords do not match",
    },
  };

  const submit = (values) => {
    startTransition(async () => {
      const res = await setOwnPassword({ newPassword: values.newPassword });
      if (!res?.success) {
        return toast.error(res?.message || "Could not set the password");
      }
      toast.success("Password updated");
      // A full navigation, not a router push: the middleware has to run again
      // to let them through.
      //
      // No session update() call — and therefore no useSession, which is what
      // made this page demand a <SessionProvider> it does not have. It is not
      // needed: the gate reads `mustChangePassword` live from the database on
      // each request, so clearing it there is enough. Refreshing the token
      // would only be necessary if the cookie were the source of truth, and
      // making it so is exactly what would strand somebody whose cookie still
      // said "change required" after they had changed it.
      window.location.assign(homePathForRole(role));
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle className="text-base tracking-tight">
              Set a new password
            </CardTitle>
          </div>
          <CardDescription className="tracking-tight">
            {name ? `${name}, your` : "Your"} password was reset by an
            administrator. Choose your own before continuing — they have seen
            the one you just used.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <FormProvider {...method}>
            <form onSubmit={handleSubmit(submit)} className="space-y-4">
              <FormInput
                field={newPasswordField}
                autoComplete="new-password"
                autoFocus
              />

              {watch("newPassword") ? (
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
              ) : null}

              <FormInput field={confirmField} autoComplete="new-password" />

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save and continue
              </Button>

              <Separator />

              {/* The only way off this page other than setting a password.
                  Without it, someone who opened it by mistake — or on the wrong
                  account — has nowhere to go. */}
              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => signOut({ callbackUrl: "/auth" })}
              >
                Sign out
              </Button>
            </form>
          </FormProvider>
        </CardContent>
      </Card>
    </div>
  );
}
