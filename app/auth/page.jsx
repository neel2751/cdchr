import { getRequestTenant } from "@/server/tenantServer/tenantServer";
import { platformRootDomain } from "@/lib/tenantHost";
import LoginScreen from "./loginUi";

/**
 * The sign-in page.
 *
 * A server component so the company's branding is resolved from the hostname
 * before the first byte, the same reasoning as app/admin/layout.jsx: a
 * client-side swap would show the platform default and then flash to the
 * tenant's. The difference is where the tenant comes from — the admin shell
 * reads it off the session, and here there is no session yet, so the Host
 * header is all there is to go on.
 */
// Must never be statically rendered: the whole page depends on which hostname
// asked for it. Declared explicitly because getRequestTenant() catches its own
// errors, which also swallows the DynamicServerError Next relies on to notice
// that headers() was read — without this, /auth prerenders once, unbranded, and
// every tenant is served that one copy.
export const dynamic = "force-dynamic";

/** Browser tab title and favicon, per company. */
export async function generateMetadata() {
  const { tenant } = await getRequestTenant();
  const branding = tenant?.branding;
  if (!branding) return { title: "Sign in" };

  return {
    title: `Sign in · ${branding.appName}`,
    description: `Sign in to ${tenant.name}`,
    ...(branding.faviconUrl && branding.faviconUrl !== "/favicon.ico"
      ? { icons: { icon: branding.faviconUrl } }
      : {}),
  };
}

export default async function AuthPage() {
  const { type, tenant } = await getRequestTenant();

  // resolveBranding() has already filled in the platform defaults, so an
  // unrecognised host still gets a complete, sensible object.
  const branding = tenant?.branding || null;

  // Tailwind v4 maps --color-primary to --primary, so overriding the variable
  // re-themes every component below that uses it — including the sign-in
  // button. Same escaping guard as the admin shell.
  const overrides = [
    branding?.primaryColor && `--primary:${branding.primaryColor};`,
    branding?.accentColor && `--accent:${branding.accentColor};`,
    branding?.radius && `--radius:${branding.radius};`,
  ]
    .filter(Boolean)
    .join("");

  // Offering "create a workspace" on a company's own sign-in page is noise —
  // nobody arriving at acme.example.com wants to found a different company.
  // It belongs on the platform's own address, where signup actually starts.
  const showSignup = type !== "tenant";

  return (
    <>
      {overrides && (
        <style
          // Values are set by a super admin of this company and land inside a
          // CSS declaration block, where the worst case is a declaration the
          // browser ignores. The brace/angle guard stops the block being
          // escaped to reach other selectors.
          dangerouslySetInnerHTML={{
            __html: `:root{${overrides.replace(/[<>{}]/g, "")}}`,
          }}
        />
      )}
      <LoginScreen
        branding={branding}
        companyName={tenant?.name || ""}
        // A suspended or deactivated company still resolves; it just should not
        // pretend everything is normal. See isTenantUsable().
        unusable={!!tenant && !tenant.usable}
        showSignup={showSignup}
        rootDomain={platformRootDomain()}
      />
    </>
  );
}
