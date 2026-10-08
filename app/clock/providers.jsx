"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";

/**
 * The tap page needs both: the session to know who is clocking in, and the
 * query client for the tag lookup and the offline drain.
 *
 * The QueryClient is created inside state rather than at module scope so it is
 * never shared between requests on the server — the same reason
 * app/platform/providers.jsx does it that way.
 */
export default function ClockProviders({ children }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SessionProvider>
  );
}
