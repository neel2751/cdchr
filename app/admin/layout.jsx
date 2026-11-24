import { redirect } from "next/navigation";

import { getBrandingForCurrentUser } from "@/server/tenantServer/tenantServer";
import {
  accessNotice,
  getMyCompanyAccess,
} from "@/server/tenantServer/myCompanyAccess";
import { planNotice } from "@/server/billingServer/planNotice";
import { auth } from "@/auth";
import AdminProviders from "./providers";

/**
 * The admin shell.
 *
 * A server component so the company's branding is resolved before the first
 * byte and the colour overrides ship inside the HTML — a client-side theme
 * swap would show the platform default first and then flash to the tenant's.
 */
// The admin area is authenticated and branded per company, so it must never be
// statically rendered. Required explicitly because getBrandingForCurrentUser()
// catches its own errors — which also swallows the DynamicServerError Next uses
// to notice `headers()` was read, leaving pages static and unbranded.
export const dynamic = "force-dynamic";

/**
 * Browser tab title and favicon, per company. Overrides the static metadata in
 * the root layout, which would otherwise show the platform default to everyone.
 */
export async function generateMetadata() {
  const branding = await getBrandingForCurrentUser();
  if (!branding) return {};
  return {
    title: branding.appName,
    description: `${branding.name} — ${branding.appName}`,
    ...(branding.faviconUrl && branding.faviconUrl !== "/favicon.ico"
      ? { icons: { icon: branding.faviconUrl } }
      : {}),
  };
}

export default async function AdminLayout({ children }) {
  // A locked company (lib/tenantAccess.js) goes to the page that says why.
  // proxy.js sends it there first; this is the backstop for when that check
  // could not be made, since the proxy fails open.
  const { access, role } = await getMyCompanyAccess();
  if (access.level === "locked") redirect("/account-paused");

  const branding = await getBrandingForCurrentUser();

  // Close to a limit that will stop them (lib/pricing.js) — the super admin
  // only, since only they can do anything about it.
  let usageNotice = null;
  if (role === "superAdmin") {
    const session = await auth();
    if (!session?.user?.impersonation) {
      usageNotice = await planNotice(session?.user?.tenantId);
    }
  }

  // Tailwind v4 maps --color-primary to --primary, so overriding the variable
  // here re-themes every component that uses it. Only emitted when the company
  // has actually set a colour, otherwise globals.css keeps its defaults.
  const overrides = [
    branding?.primaryColor && `--primary:${branding.primaryColor};`,
    branding?.accentColor && `--accent:${branding.accentColor};`,
    branding?.radius && `--radius:${branding.radius};`,
  ]
    .filter(Boolean)
    .join("");

  return (
    <>
      {overrides && (
        <style
          // Values come from a super admin of this company and are written into
          // a CSS declaration block, where the worst case is invalid CSS the
          // browser ignores. The closing-brace guard stops the block being
          // escaped to reach other selectors.
          dangerouslySetInnerHTML={{
            __html: `:root{${overrides.replace(/[<>{}]/g, "")}}`,
          }}
        />
      )}
      <AdminProviders
        branding={branding}
        accessNotice={accessNotice(access, role)}
        usageNotice={usageNotice}
        contactEmail={process.env.PLATFORM_SUPPORT_EMAIL || ""}
      >
        {children}
      </AdminProviders>
    </>
  );
}
