"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import SidebarWrapper from "@/components/sidebar/sidebarWrapper";
import SupportBanner from "@/components/supportBanner";
import AccessBanner from "@/components/accessBanner";
import AnnouncementBanner from "@/components/announcementBanner";
import ScreenViewLogger from "@/components/screenViewLogger";
import CompanyChoicePrompt from "@/components/companyChoicePrompt";
import {
  fillTerms,
  fillTermsDeep,
  resolveTerms,
} from "@/data/terminology";
import { resolveCompanyBlocks } from "@/data/fieldBlocks";

/**
 * The company's branding, resolved on the server and handed to the shell.
 * Defaults come from lib/tenant.js, so this is never null in practice — but
 * consumers should still tolerate an empty object.
 */
const BrandingContext = createContext({});

export const useBranding = () => useContext(BrandingContext) || {};

/**
 * The company's words for sites, site employees and the rest
 * (data/terminology.js), with the two ways to use them:
 *
 *   const { t, fill } = useTerms();
 *   t("siteEmployees")          // "Site Employees" / "Students"
 *   fill("Add new {site}")      // "Add new site" / "Add new class"
 *
 * Outside the admin shell there is no branding, and every call answers with
 * the construction words — what those screens said before.
 */
export const useTerms = () => {
  const terms = useBranding()?.terms;
  return useMemo(() => {
    const words = terms || resolveTerms(null);
    return {
      terms: words,
      t: (key) => words[key] ?? key,
      fill: (text) => fillTerms(text, words),
      fillDeep: (value) => fillTermsDeep(value, words),
    };
  }, [terms]);
};

/**
 * Which parts of the site employee form and lists this company uses
 * (data/fieldBlocks.js): `blocks.pay`, `blocks.rightToWork`, `blocks.guardian`.
 *
 * Outside the admin shell, the construction set — what those screens showed
 * before.
 */
export const useFieldBlocks = () => {
  const blocks = useBranding()?.fieldBlocks;
  return useMemo(() => blocks || resolveCompanyBlocks(null), [blocks]);
};

const AdminProviders = ({
  children,
  branding,
  accessNotice,
  usageNotice,
  contactEmail,
}) => {
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
            {/* Inside the content area, not above the shell: up here the
                fixed sidebar covered their text. */}
            <SidebarWrapper
              banners={
                <>
                  {/* The trial countdown, or the account being read-only —
                      see lib/tenantAccess.js. */}
                  <AccessBanner
                    notice={accessNotice}
                    contactEmail={contactEmail}
                  />
                  {/* Close to a limit that will stop them adding people. */}
                  <AccessBanner notice={usageNotice} />
                  {/* Urgent announcements, on every admin page. Below the
                      support banner: which company you are looking at
                      outranks its news. */}
                  <AnnouncementBanner />
                </>
              }
            >
              {children}
            </SidebarWrapper>
          </NuqsAdapter>
        </BrandingContext.Provider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </SessionProvider>
  );
};

export default AdminProviders;
