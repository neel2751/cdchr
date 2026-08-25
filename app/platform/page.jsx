import TenantList from "./tenantList";
import { getPlatformStats } from "@/server/tenantServer/tenantServer";

export default async function PlatformHome({ searchParams }) {
  const params = await searchParams;

  // Fetched on the server: the headline counts never change per interaction, so
  // there is nothing for the client to refetch.
  const statsResult = await getPlatformStats();
  const stats = statsResult?.success ? JSON.parse(statsResult.data) : null;

  return <TenantList searchParams={params} stats={stats} />;
}
