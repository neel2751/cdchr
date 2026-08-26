import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMyTenant } from "@/server/tenantServer/tenantSettingsServer";
import SettingsClient from "./settingsClient";

export const metadata = {
  title: "Company settings",
};

/**
 * Branding and custom domains for the signed-in user's own company.
 *
 * Guarded here as well as in proxy.js: this page changes what every user of the
 * company sees and which hostnames route to it.
 */
export default async function CompanySettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");
  if (session.user.role !== "superAdmin") redirect("/unauthorized");

  const result = await getMyTenant();

  if (!result?.success) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">
            Could not load company settings
          </p>
          <p className="mt-1 text-muted-foreground">{result?.message}</p>
        </div>
      </div>
    );
  }

  return <SettingsClient tenant={JSON.parse(result.data)} />;
}
