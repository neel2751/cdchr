import { platformRootDomain } from "@/lib/tenantHost";
import SignupForm from "./signupForm";
import { PLATFORM_APP_NAME } from "@/lib/tenant";
import { getSignupTrial } from "@/server/billingServer/trialOfferServer";

export const metadata = {
  title: `Create your workspace | ${PLATFORM_APP_NAME}`,
  description: "Set up a new company workspace and start managing your team.",
};

/**
 * Self-serve signup. Public by design — `proxy.js` only guards /admin,
 * /employee, /hr and /platform, so this route is reachable signed out.
 *
 * The root domain is read here rather than in the form: it comes from
 * PLATFORM_ROOT_DOMAIN, which is server-only, and the browser needs it purely
 * to render the "<you>.hr.example.com" preview.
 */
export const dynamic = "force-dynamic";

/**
 * `?offer=EXPO30` — a link handed out at an event — fills in the offer code
 * and shows its trial length from the first paint. A code that does not work
 * is left for the person to see and correct, not silently dropped.
 */
export default async function SignupPage({ searchParams }) {
  const { offer: code } = (await searchParams) || {};
  const standard = await getSignupTrial(null);
  const offered = code ? await getSignupTrial(String(code)) : null;

  return (
    <SignupForm
      rootDomain={platformRootDomain()}
      standardTrialDays={standard.trialDays}
      initialOffer={
        offered?.success
          ? {
              code: offered.offer.code,
              trialDays: offered.trialDays,
              label: offered.offer.label,
            }
          : code
            ? { code: String(code).toUpperCase(), success: false, message: offered?.message }
            : null
      }
    />
  );
}
