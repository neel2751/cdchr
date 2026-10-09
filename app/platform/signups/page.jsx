import PendingSignups from "./pendingSignups";
import { platformRootDomain } from "@/lib/tenantHost";
import { listPendingSignups } from "@/server/authServer/signupServer";

export const metadata = {
  title: "Pending signups",
  description: "Self-serve signups waiting on a confirmation link",
};

/**
 * Self-serve signups that have not been confirmed yet.
 *
 * Fetched on the server like the tenant list: the queue only changes when a
 * signup happens or an admin reissues a link, and the reissue refreshes the
 * route itself.
 */
export default async function PendingSignupsPage() {
  const result = await listPendingSignups();

  // Dates do not survive the boundary as Dates, and the client only ever
  // formats them, so they cross as ISO strings.
  const rows = (result?.success ? result.data : []).map((row) => ({
    ...row,
    lastSentAt: row.lastSentAt ? new Date(row.lastSentAt).toISOString() : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
  }));

  return (
    <PendingSignups
      rows={rows}
      // Server-only, and the browser wants it purely to show the address the
      // workspace would get.
      rootDomain={platformRootDomain()}
      error={result?.success ? "" : result?.message || "Could not load signups"}
    />
  );
}
