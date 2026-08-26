import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMyCompanySettings } from "@/server/tenantServer/tenantSettingsServer";
import SettingsClient from "./settingsClient";

export const metadata = { title: "Company settings" };
export const dynamic = "force-dynamic";

/**
 * Branding and domains for every company this account owns.
 *
 * Not gated on the session's role: what matters is holding a super admin
 * *membership* of a company, which is what lets one person own several. The
 * server action re-checks that membership per company on every write.
 */
export default async function CompanySettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  const result = await getMyCompanySettings();

  if (!result?.success) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">
            Could not load company settings
          </p>
          <p className="mt-1 text-muted-foreground">{result?.message}</p>
        </div>
      </div>
    );
  }

  return <SettingsClient {...JSON.parse(result.data)} />;
}
