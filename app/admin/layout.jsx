import { getBrandingForCurrentUser } from "@/server/tenantServer/tenantServer";
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
  const branding = await getBrandingForCurrentUser();

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
      <AdminProviders branding={branding}>{children}</AdminProviders>
    </>
  );
}
