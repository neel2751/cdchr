import { platformRootDomain } from "@/lib/tenantHost";
import SignupForm from "./signupForm";

export const metadata = {
  title: "Create your workspace | HR Management",
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
export default function SignupPage() {
  return <SignupForm rootDomain={platformRootDomain()} />;
}
