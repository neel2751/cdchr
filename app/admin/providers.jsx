"use client";

import { createContext, useContext, useState } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import SidebarWrapper from "@/components/sidebar/sidebarWrapper";
import SupportBanner from "@/components/supportBanner";
import AnnouncementBanner from "@/components/announcementBanner";
import ScreenViewLogger from "@/components/screenViewLogger";
import CompanyChoicePrompt from "@/components/companyChoicePrompt";

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
            {/* Records which screen is open. Mounted here so every admin
                screen is covered by one line rather than thirty. */}
            <ScreenViewLogger />
            {/* "Which company?" for the handful of people who work for more
                than one. Here rather than on the login form, so it lands after
                the two-factor gates and never has to answer which companies an
                address belongs to before a password is checked. */}
            <CompanyChoicePrompt />
            {/* Renders only during a support visit, above everything else. */}
            <SupportBanner />
            {/* Urgent announcements, on every admin page. Below the support
                banner: which company you are looking at outranks its news. */}
            <AnnouncementBanner />
            <SidebarWrapper>{children}</SidebarWrapper>
          </NuqsAdapter>
        </BrandingContext.Provider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </SessionProvider>
  );
};

export default AdminProviders;
