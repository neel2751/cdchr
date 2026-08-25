import { redirect } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { getServerSession } from "next-auth";
import { options } from "@/app/api/auth/[...nextauth]/option";
import { PlatformProviders } from "./providers";
import PlatformNav from "./platformNav";

export const metadata = {
  title: "Platform Console",
  description: "Manage tenants, domains and branding",
};

/**
 * The provider-side console. Deliberately does not reuse the tenant sidebar —
 * nothing here belongs to any one company.
 *
 * proxy.js already gates /platform on role and host, but this check runs again
 * server-side: middleware can be bypassed by configuration mistakes, and this
 * layout is the last thing between a request and cross-tenant data.
 */
export default async function PlatformLayout({ children }) {
  const session = await getServerSession(options);

  if (!session?.user) redirect("/api/auth/signin");
  if (session.user.role !== "platformAdmin") redirect("/unauthorized");

  return (
    <SessionProvider session={session}>
      <PlatformProviders>
        <div className="min-h-screen bg-muted/30">
          <PlatformNav userName={session.user.name} />
          <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
        </div>
      </PlatformProviders>
    </SessionProvider>
  );
}
