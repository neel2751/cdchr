"use client";

import React, { Suspense, useEffect } from "react";
import { signIn, useSession, SessionProvider } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, LifeBuoy, Loader2, ShieldCheck } from "lucide-react";

import { GlobalForm } from "@/components/form/form";
import { CopyCode } from "@/components/clipboard";
import { describeLoginError } from "@/lib/authErrors";
import { toSafeRelativePath } from "@/lib/roleHome";

// Platform fallbacks, used when the host resolves to no tenant. They mirror
// resolveBranding() in lib/tenant.js so the page looks the same either way.
const DEFAULT_BRANDING = {
  appName: "HR Management",
  logoUrl: "/images/Interiorlogo.svg",
  loginBackgroundUrl: "",
  supportEmail: "",
};

export const LOGINFIELD = [
  {
    name: "email",
    labelText: "Email Address",
    type: "email",
    helperText: "*Please enter a valid email address.",
    placeholder: "Enter your email",
    inputMode: "email",
    size: true,
    validationOptions: {
      required: "Email is required",
      pattern: {
        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
        message: "Invalid email format. Please check and try again.",
      },
    },
  },
  {
    name: "password",
    labelText: "Password",
    type: "password",
    placeholder: "******",
    size: true,
    validationOptions: {
      required: "password is required",
      minLength: {
        value: 6,
        message: "Minimum length should be 6 characters",
      },
    },
  },
];

/**
 * Client shell for the sign-in page.
 *
 * The Suspense boundary has to sit outside LoginUi because that component reads
 * useSearchParams(), which suspends during prerender.
 */
export default function LoginScreen(props) {
  return (
    <SessionProvider>
      <Suspense fallback={<LoginSkeleton />}>
        <LoginUi {...props} />
      </Suspense>
    </SessionProvider>
  );
}

function LoginSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="text-muted-foreground size-6 animate-spin" />
    </div>
  );
}

export const LoginUi = ({
  branding,
  companyName = "",
  unusable = false,
  showSignup = true,
  rootDomain = "",
}) => {
  const brand = { ...DEFAULT_BRANDING, ...(branding || {}) };

  const searchParams = useSearchParams();
  const callback = searchParams.get("callbackUrl");
  const { data: session } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);
  const [unauthorizedId, setUnauthorizedId] = React.useState(""); // State to store the ID

  // Always a same-origin path. Auth.js derives absolute URLs from the request
  // URL, which behind a proxy is the internal address rather than the tenant's
  // domain — so the destination is resolved here instead of taken from it.
  const callBackcheck = toSafeRelativePath(
    callback,
    typeof window === "undefined" ? "" : window.location.origin
  );

  useEffect(() => {
    if (session) {
      router.push(callBackcheck); // Push to the callback URL or default to "/"
    }
  }, [session]);

  const handleSubmit = async (data) => {
    if (typeof window !== "undefined") {
      const fingerprintjs = await import("@fingerprintjs/fingerprintjs");
      const fp = await fingerprintjs.load();
      const { visitorId: deviceId } = await fp.get();

      setIsLoading(true);

      try {
        const res = await signIn("credentials", {
          redirect: false, // Prevent automatic page reload
          email: data.email,
          password: data.password,
          deviceId, // Send the device ID
        });

        if (res?.error) {
          // Auth.js v5 forwards only the short `code` of the error thrown in
          // authorize(); the wording is reconstructed here.
          const { message, deviceId: unauthorizedDeviceId } =
            describeLoginError(res.code);
          toast.error(message);
          if (unauthorizedDeviceId) setUnauthorizedId(unauthorizedDeviceId);
        } else {
          toast.success("Logged in successfully. Please wait..."); // Optionally show a toast notification
          // Deliberately ignores res.url — see toSafeRelativePath. A full page
          // load (not router.push) so the proxy re-runs with the new cookie.
          window.location.href = callBackcheck;
        }
      } catch (err) {
        console.log("Error during login:", err);
        toast.error("An unexpected error occurred. Please try again.");
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <BrandPanel brand={brand} companyName={companyName} />

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          {/* The brand panel is desktop-only, so phones get the mark here. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            {/* A plain <img>, not next/image: a tenant's logo URL is arbitrary,
                and next/image only accepts hosts listed in next.config.mjs,
                which is fixed at build time. Same call as the sidebar. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={brand.logoUrl}
              alt=""
              className="h-9 w-9 rounded-md object-contain"
            />
            <span className="text-lg font-semibold">{brand.appName}</span>
          </div>

          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {companyName ? (
                <>
                  Sign in to{" "}
                  <span className="text-foreground font-medium">
                    {companyName}
                  </span>
                  .
                </>
              ) : (
                "Sign in to continue to your workspace."
              )}
            </p>
          </header>

          {unusable && (
            <div className="mb-6 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p className="text-amber-900">
                <span className="font-medium">
                  This workspace is not active.
                </span>{" "}
                You may not be able to reach it after signing in. Please contact
                your administrator
                {brand.supportEmail ? " or support" : ""}.
              </p>
            </div>
          )}

          <GlobalForm
            fields={LOGINFIELD}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            btnName={"Sign in"}
          />

          <div className="mt-4 text-right text-sm">
            <a
              href="/forgot-password"
              className="text-primary hover:underline"
            >
              Forgot password?
            </a>
          </div>

          {unauthorizedId && (
            <div className="mt-6 rounded-md border border-yellow-400 bg-yellow-50 p-4">
              <p className="font-bold text-yellow-800">UNAUTHORIZED DEVICE</p>
              <p className="text-sm text-yellow-700">Your Hardware ID is:</p>

              <CopyCode code={unauthorizedId} />

              <p className="mt-3 text-xs text-gray-500 italic">
                * Copy the ID and send it to the Super Admin via WhatsApp or
                Email.
              </p>
            </div>
          )}

          {showSignup && (
            <div className="text-muted-foreground mt-6 border-t pt-6 text-center text-sm">
              Don&apos;t have a company account?{" "}
              <a href="/signup" className="text-primary hover:underline">
                Create a workspace
              </a>
            </div>
          )}

          {brand.supportEmail && (
            <p className="text-muted-foreground mt-6 flex items-center justify-center gap-1.5 text-xs">
              <LifeBuoy className="size-3.5" />
              Need help?{" "}
              <a
                href={`mailto:${brand.supportEmail}`}
                className="text-primary hover:underline"
              >
                {brand.supportEmail}
              </a>
            </p>
          )}
        </div>
      </main>
    </div>
  );
};

/**
 * The company's side of the page: its logo, its name, and its own background
 * image when it has set one. Decorative and tall, so phones skip it entirely.
 */
function BrandPanel({ brand, companyName }) {
  const hasImage = !!brand.loginBackgroundUrl;

  return (
    <aside className="relative hidden overflow-hidden bg-slate-900 p-12 text-slate-100 lg:flex lg:flex-col lg:justify-between">
      {hasImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.loginBackgroundUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Whatever the company uploads, the text on top has to stay
              readable — hence a fixed scrim rather than trusting the image. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-slate-950/70"
          />
        </>
      ) : (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-indigo-500/25 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -bottom-32 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl"
          />
        </>
      )}

      <div className="relative flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.logoUrl}
          alt=""
          className="h-10 w-10 rounded-md bg-white/10 object-contain p-1"
        />
        <span className="text-lg font-semibold">{brand.appName}</span>
      </div>

      <div className="relative max-w-md">
        <h2 className="text-4xl leading-tight font-semibold tracking-tight">
          {companyName ? `${companyName}` : "Your team, all in one place."}
        </h2>
        <p className="mt-4 text-slate-300">
          {companyName
            ? "Attendance, leave, rotas and documents — all in one place."
            : "Sign in to manage attendance, leave, rotas and documents."}
        </p>
      </div>

      <p className="relative flex items-center gap-2 text-sm text-slate-400">
        <ShieldCheck className="size-4" />
        Your company&apos;s data is kept separate and private.
      </p>
    </aside>
  );
}
