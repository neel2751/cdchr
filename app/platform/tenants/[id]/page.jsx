import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTenantDetail } from "@/server/tenantServer/platformServer";
import TenantDetail from "./tenantDetail";

export const dynamic = "force-dynamic";

export default async function PlatformTenantPage({ params }) {
  const { id } = await params;
  const result = await getTenantDetail(id);

  if (!result?.success) {
    return (
      <div className="space-y-4">
        <Link
          href="/platform"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All companies
        </Link>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load company</p>
          <p className="mt-1 text-muted-foreground">{result?.message}</p>
        </div>
      </div>
    );
  }

  return <TenantDetail tenant={JSON.parse(result.data)} />;
}
