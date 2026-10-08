"use client";
import { useEffect } from "react";
import { FormProvider } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { KeyRound, Loader2, Lock, RefreshCw, Copy } from "lucide-react";
import { toast } from "sonner";
import useGlobalForm from "@/hooks/useGlobalForm";
import { FormInput, FormTextarea } from "@/components/form/form-field";
import {
  MIN_PASSWORD_LENGTH,
  describeStrength,
  generatePassword,
} from "@/lib/passwordStrength";

/**
 * Super-admin dialog to reset an employee's password.
 *
 * Built on the same react-hook-form context the rest of the app's forms use
 * (useGlobalForm runs in `onChange` mode), rather than the raw inputs this
 * previously held. That is what makes "passwords do not match" appear as you
 * type instead of arriving as a toast after pressing the button — the
 * validation was always available, this screen simply was not using it.
 *
 * `FormInput` is the same component GlobalForm renders, so the show/hide toggle
 * and error styling match every other password field without being rebuilt.
 *
 * @param {{ target: object|null,
 *           onOpenChange: (open:boolean)=>void,
 *           onConfirm: (payload:{newPassword:string, reason:string,
 *                                signOutEverywhere:boolean,
 *                                requirePasswordChange:boolean})=>void,
 *           isPending: boolean }} props
 */
const ResetPasswordDialog = ({ target, onOpenChange, onConfirm, isPending }) => {
  const open = Boolean(target);

  const method = useGlobalForm(
    {
      newPassword: "",
      confirmPassword: "",
      reason: "",
      // Both default ON. A reset is nearly always a response to a lockout or a
      // suspected compromise, and in that situation leaving old sessions alive
      // or letting the admin's chosen password stand indefinitely are the two
      // things you would regret.
      signOutEverywhere: true,
      requirePasswordChange: true,
    },
    null
  );

  const { watch, setValue, handleSubmit, reset } = method;
  const newPassword = watch("newPassword");
  const signOutEverywhere = watch("signOutEverywhere");
  const requirePasswordChange = watch("requirePasswordChange");
  const strength = describeStrength(newPassword);

  useEffect(() => {
    if (open) {
      reset({
        newPassword: "",
        confirmPassword: "",
        reason: "",
        signOutEverywhere: true,
        requirePasswordChange: true,
      });
    }
  }, [open, target?._id, reset]);

  const displayName =
    target?.name ||
    [target?.firstName, target?.lastName].filter(Boolean).join(" ") ||
    "—";

  /**
   * Fill both fields at once and reveal the value.
   *
   * Filling only the first would leave the admin retyping a 16-character random
   * string into the confirm box, which is exactly the transcription they are
   * least likely to get right.
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
      toast.success("Password generated and copied to your clipboard");
    } catch {
      // Clipboard access is denied in some contexts; the value is on screen
      // behind the eye toggle either way, so this is not a failure.
      toast.success("Password generated — use the eye icon to read it");
    }
  };

  const copyPassword = async () => {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy — reveal it with the eye icon instead");
    }
  };

  const submit = (values) => {
    onConfirm({
      newPassword: values.newPassword,
      reason: values.reason.trim(),
      signOutEverywhere: !!values.signOutEverywhere,
      requirePasswordChange: !!values.requirePasswordChange,
    });
  };

  const passwordField = {
    name: "newPassword",
    labelText: "New password",
    type: "password",
    placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`,
    validationOptions: {
      required: "A new password is required",
      minLength: {
        value: MIN_PASSWORD_LENGTH,
        message: `Must be at least ${MIN_PASSWORD_LENGTH} characters`,
      },
      // Re-check the confirm box whenever this one changes. Without it the
      // match error only refreshes when the *confirm* field is edited, so
      // correcting a typo up here left a stale "Passwords do not match" sitting
      // under a pair that now match perfectly well.
      deps: ["confirmPassword"],
    },
  };

  const confirmField = {
    name: "confirmPassword",
    labelText: "Confirm password",
    type: "password",
    placeholder: "Re-enter new password",
    validationOptions: {
      required: "Please confirm the password",
      // react-hook-form hands the whole form to `validate`, which is how this
      // can compare against another field — and why the mismatch now shows
      // under the box as it is typed.
      validate: (value, values) =>
        value === values.newPassword || "Passwords do not match",
    },
  };

  const reasonField = {
    name: "reason",
    labelText: "Reason (required)",
    placeholder:
      "e.g. Account locked after failed logins; employee requested reset",
    rows: 3,
    validationOptions: {
      required: "A reason is required — it is written to the audit log",
      validate: (value) =>
        value.trim().length > 0 || "A reason is required",
    },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for this employee. The action and your reason are
            recorded in the audit log.
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...method}>
          <form onSubmit={handleSubmit(submit)} className="space-y-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-gray-500">Employee</span>
              <span className="font-medium text-right">
                {displayName}
                {target?.email ? (
                  <span className="block text-xs text-gray-400">
                    {target.email}
                  </span>
                ) : null}
              </span>
            </div>

            {target?.isLocked ? (
              <Badge variant="destructive" className="gap-1">
                <Lock className="h-3 w-3" /> Account locked — reset will unlock
                it
              </Badge>
            ) : null}

            <FormInput field={passwordField} autoComplete="new-password" />

            {/* Strength is advice, not a gate — the same scorer the sign-up
                form uses, so both screens agree on what "Strong" means. */}
            {newPassword ? (
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

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={isPending}
              >
                <RefreshCw className="size-3.5" />
                Generate strong password
              </Button>
              {newPassword ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={copyPassword}
                  disabled={isPending}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              ) : null}
            </div>

            <FormInput field={confirmField} autoComplete="new-password" />

            <FormTextarea field={reasonField} />

            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-start justify-between gap-3">
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">
                    Sign out of all devices
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {signOutEverywhere
                      ? "Every existing session ends immediately — anyone already signed in as this person is returned to the login screen."
                      : "Sessions already signed in stay signed in, including any the old password opened."}
                  </span>
                </span>
                <Switch
                  checked={!!signOutEverywhere}
                  disabled={isPending}
                  onCheckedChange={(v) =>
                    setValue("signOutEverywhere", v, { shouldDirty: true })
                  }
                />
              </label>

              <label className="flex items-start justify-between gap-3 border-t pt-2">
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">
                    Require a password change at next login
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {requirePasswordChange
                      ? "They must set their own password before they can use the app, so this one is temporary and only you two have seen it."
                      : "The password you set here stays in place until they choose to change it."}
                  </span>
                </span>
                <Switch
                  checked={!!requirePasswordChange}
                  disabled={isPending}
                  onCheckedChange={(v) =>
                    setValue("requirePasswordChange", v, { shouldDirty: true })
                  }
                />
              </label>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <KeyRound />
                )}
                Reset password
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
};

export default ResetPasswordDialog;
