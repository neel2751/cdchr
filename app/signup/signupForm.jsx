"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  checkWorkspaceAvailability,
  startSignup,
} from "@/server/authServer/signupServer";

const MIN_PASSWORD_LENGTH = 8;
const AVAILABILITY_DEBOUNCE_MS = 450;

/**
 * Derive a workspace address from a company name.
 *
 * Mirrors slugify() in scripts/seed-tenant.mjs. Kept on the client on purpose:
 * this runs on every keystroke, and a server round trip per character to
 * compute a pure string transform would be absurd. The server never trusts it —
 * slugComplaint() re-validates whatever arrives.
 */
function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/** Rough password strength, 0-4. Guidance for the person, never a gate. */
function passwordScore(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

const STRENGTH = [
  { label: "", bar: "" },
  { label: "Weak", bar: "bg-rose-500" },
  { label: "Fair", bar: "bg-amber-500" },
  { label: "Good", bar: "bg-lime-500" },
  { label: "Strong", bar: "bg-emerald-500" },
];

const HIGHLIGHTS = [
  {
    icon: Users,
    title: "Your whole team, one place",
    body: "Employees, departments, contracts and documents — set up in minutes.",
  },
  {
    icon: CalendarClock,
    title: "Attendance and leave that add up",
    body: "Clock-ins, rotas, holiday balances and reports without the spreadsheets.",
  },
  {
    icon: ShieldCheck,
    title: "Separated and secured",
    body: "Your company's data is isolated from every other, with two-factor sign-in for admins.",
  },
];

export default function SignupForm({ rootDomain = "" }) {
  const [form, setForm] = useState({
    companyName: "",
    slug: "",
    name: "",
    email: "",
    phoneNumber: "",
    password: "",
    confirmPassword: "",
  });
  // Once the address has been edited by hand, the company name stops driving it.
  const [slugTouched, setSlugTouched] = useState(false);
  // The last answer received, tagged with the address it was about.
  const [availability, setAvailability] = useState(null); // {slug, available, message}
  const [showPassword, setShowPassword] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [isPending, startTransition] = useTransition();

  const set = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleCompanyName = (event) => {
    const companyName = event.target.value;
    setForm((prev) => ({
      ...prev,
      companyName,
      slug: slugTouched ? prev.slug : slugify(companyName),
    }));
  };

  const handleSlug = (event) => {
    setSlugTouched(true);
    // Typed spaces and capitals become hyphens and lowercase as you go, so what
    // is shown is always what would actually be submitted.
    setForm((prev) => ({ ...prev, slug: slugify(event.target.value) }));
  };

  // Ask the server whether the address is free, once typing settles.
  useEffect(() => {
    const slug = form.slug;
    if (!slug) return;

    const timer = setTimeout(async () => {
      const result = await checkWorkspaceAvailability(slug);
      setAvailability({ slug, ...result });
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [form.slug]);

  // Only an answer about the address currently in the box counts. Comparing
  // rather than tracking a "checking" flag means a slow reply for an address
  // the person has since edited is ignored on its own, and the effect never has
  // to call setState on the render path.
  const checked = availability?.slug === form.slug ? availability : null;
  const checking = !!form.slug && !checked;

  const score = useMemo(() => passwordScore(form.password), [form.password]);
  const passwordsMatch =
    !form.confirmPassword || form.password === form.confirmPassword;

  const canSubmit =
    form.companyName.trim() &&
    form.name.trim() &&
    form.email.trim() &&
    form.phoneNumber.trim() &&
    form.password.length >= MIN_PASSWORD_LENGTH &&
    form.password === form.confirmPassword &&
    checked?.available &&
    !isPending;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      return toast.warning(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
      );
    }
    if (form.password !== form.confirmPassword) {
      return toast.warning("Passwords do not match");
    }
    if (!checked?.available) {
      return toast.warning(checked?.message || "Choose a workspace address");
    }

    startTransition(async () => {
      const res = await startSignup(form);
      if (res?.success) {
        setSentTo(form.email.trim());
      } else {
        toast.error(res?.message || "Something went wrong");
      }
    });
  };

  const addressSuffix = rootDomain ? `.${rootDomain}` : "";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel. Decorative and costly in height, so phones skip it. */}
      <aside className="relative hidden overflow-hidden bg-slate-900 p-12 text-slate-100 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-indigo-500/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-32 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <Image
            src="/images/Interiorlogo.svg"
            alt=""
            height={36}
            width={36}
            className="h-9 w-9"
          />
          <span className="text-lg font-semibold">HR Management</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">
            Everything your team needs, from day one.
          </h1>
          <p className="mt-4 text-slate-300">
            Create a workspace for your company and invite your people. No card
            required.
          </p>

          <ul className="mt-10 space-y-6">
            {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4.5 text-indigo-200" />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm text-slate-400">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/auth" className="text-slate-200 underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </aside>

      {/* Form column */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          {/* Phone-sized screens lose the brand panel, so the mark appears here. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Image
              src="/images/Interiorlogo.svg"
              alt=""
              height={32}
              width={32}
              className="h-8 w-8"
            />
            <span className="font-semibold">HR Management</span>
          </div>

          {sentTo ? (
            <CheckYourInbox email={sentTo} onBack={() => setSentTo("")} />
          ) : (
            <>
              <header className="mb-8">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Create your workspace
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  You&apos;ll be the super admin. Takes about a minute.
                </p>
              </header>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <Field
                  id="companyName"
                  label="Company name"
                  value={form.companyName}
                  onChange={handleCompanyName}
                  placeholder="Acme Construction Ltd"
                  autoComplete="organization"
                  autoFocus
                  required
                />

                <div className="space-y-1.5">
                  <Label htmlFor="slug">Workspace address</Label>
                  {/* One field visually, two elements really: an editable slug
                      and a fixed suffix nobody can type into. */}
                  <div
                    className={cn(
                      "border-input focus-within:border-ring focus-within:ring-ring/50 flex h-9 w-full items-center rounded-md border bg-transparent pr-3 shadow-xs transition-[color,box-shadow] focus-within:ring-[3px] dark:bg-input/30",
                      checked &&
                        !checked.available &&
                        "border-destructive focus-within:border-destructive focus-within:ring-destructive/20"
                    )}
                  >
                    <input
                      id="slug"
                      name="slug"
                      value={form.slug}
                      onChange={handleSlug}
                      placeholder="acme"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent px-3 text-base outline-none md:text-sm"
                    />
                    {addressSuffix && (
                      <span className="text-muted-foreground shrink-0 text-sm select-none">
                        {addressSuffix}
                      </span>
                    )}
                    <span className="ml-2 flex size-4 shrink-0 items-center justify-center">
                      {checking ? (
                        <Loader2 className="text-muted-foreground size-4 animate-spin" />
                      ) : checked?.available ? (
                        <Check className="size-4 text-emerald-600" />
                      ) : checked ? (
                        <X className="text-destructive size-4" />
                      ) : null}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-xs",
                      !checked
                        ? "text-muted-foreground"
                        : checked.available
                          ? "text-emerald-600"
                          : "text-destructive"
                    )}
                  >
                    {checking
                      ? "Checking availability…"
                      : checked
                        ? checked.message
                        : "This is where your team will sign in."}
                  </p>
                </div>

                <Divider>Your details</Divider>

                <Field
                  id="name"
                  label="Full name"
                  value={form.name}
                  onChange={set("name")}
                  placeholder="Jordan Blake"
                  autoComplete="name"
                  required
                />

                <Field
                  id="email"
                  label="Work email"
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  placeholder="you@acme.co.uk"
                  autoComplete="email"
                  inputMode="email"
                  hint="We'll send a confirmation link here."
                  required
                />

                <Field
                  id="phoneNumber"
                  label="Phone number"
                  type="tel"
                  value={form.phoneNumber}
                  onChange={set("phoneNumber")}
                  placeholder="07700 900123"
                  autoComplete="tel"
                  inputMode="tel"
                  required
                />

                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={set("password")}
                      placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                      autoComplete="new-password"
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>

                  {form.password && (
                    <div className="flex items-center gap-2 pt-0.5">
                      <div className="flex flex-1 gap-1">
                        {[1, 2, 3, 4].map((step) => (
                          <span
                            key={step}
                            className={cn(
                              "h-1 flex-1 rounded-full transition-colors",
                              step <= score ? STRENGTH[score].bar : "bg-muted"
                            )}
                          />
                        ))}
                      </div>
                      <span className="text-muted-foreground w-10 text-right text-xs">
                        {STRENGTH[score].label}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    value={form.confirmPassword}
                    onChange={set("confirmPassword")}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    aria-invalid={!passwordsMatch}
                    required
                  />
                  {!passwordsMatch && (
                    <p className="text-destructive text-xs">
                      Passwords do not match
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={!canSubmit}
                >
                  {isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ArrowRight />
                  )}
                  Create workspace
                </Button>

                <p className="text-muted-foreground text-center text-xs">
                  By creating a workspace you agree to keep your team&apos;s data
                  accurate and lawful.
                </p>

                <p className="text-center text-sm lg:hidden">
                  Already have an account?{" "}
                  <Link href="/auth" className="text-indigo-600 hover:underline">
                    Sign in
                  </Link>
                </p>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/** Label + input + optional hint, which is most of this form. */
function Field({ id, label, hint, ...props }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function Divider({ children }) {
  return (
    <div className="text-muted-foreground flex items-center gap-4 pt-2 text-xs uppercase">
      <span className="bg-border h-px flex-1" />
      {children}
      <span className="bg-border h-px flex-1" />
    </div>
  );
}

/**
 * The whole point of the two-step flow: nothing has been created yet, and this
 * screen has to say so clearly enough that nobody goes looking for a workspace
 * that is not there.
 */
function CheckYourInbox({ email, onBack }) {
  return (
    <div className="text-center">
      <span className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950">
        <MailCheck className="size-7 text-emerald-600" />
      </span>

      <h2 className="text-2xl font-semibold tracking-tight">Check your inbox</h2>
      <p className="text-muted-foreground mt-3 text-sm">
        We&apos;ve sent a confirmation link to{" "}
        <strong className="text-foreground">{email}</strong>. Click it and
        we&apos;ll create your workspace.
      </p>

      <div className="bg-muted/50 mt-6 space-y-3 rounded-lg border p-4 text-left text-sm">
        <p className="flex gap-3">
          <BadgeCheck className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <span className="text-muted-foreground">
            The link is valid for 24 hours and works once.
          </span>
        </p>
        <p className="flex gap-3">
          <ShieldCheck className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <span className="text-muted-foreground">
            Nothing has been created yet — your workspace is set up the moment
            you confirm.
          </span>
        </p>
      </div>

      <p className="text-muted-foreground mt-6 text-sm">
        Nothing arrived? Check your spam folder, or{" "}
        <button
          type="button"
          onClick={onBack}
          className="text-indigo-600 hover:underline"
        >
          try a different email
        </button>
        .
      </p>

      <Button asChild variant="outline" className="mt-6 w-full">
        <Link href="/auth">Back to sign in</Link>
      </Button>
    </div>
  );
}
