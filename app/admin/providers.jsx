"use client";

import { createContext, useContext, useState } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import SidebarWrapper from "@/components/sidebar/sidebarWrapper";
import SupportBanner from "@/components/supportBanner";

/**
 * The company's branding, resolved on the server and handed to the shell.
 * Defaults come from lib/tenant.js, so this is never null in practice — but
 * consumers should still tolerate an empty object.
 */
const BrandingContext = createContext({});

export const useBranding = () => useContext(BrandingContext) || {};

const AdminProviders = ({ children, branding }) => {
  // Created in state rather than at module scope so the cache is never shared
  // between requests during server rendering.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <BrandingContext.Provider value={branding || {}}>
          <NuqsAdapter>
            {/* Renders only during a support visit, above everything else. */}
            <SupportBanner />
            <SidebarWrapper>{children}</SidebarWrapper>
          </NuqsAdapter>
        </BrandingContext.Provider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </SessionProvider>
  );
};

export default AdminProviders;
