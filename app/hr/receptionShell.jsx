"use client";
import Image from "next/image";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import ReceptionLogout from "./logout";
import { brandCompanyName } from "@/lib/tenant";

/**
 * The reception desk chrome.
 *
 * Split out of layout.jsx for the same reason as the employee portal's shell:
 * the providers need the client, so the plan check could not live in a
 * "use client" layout.
 *
 * `branding` arrives from the layout rather than a context: this is the only
 * thing on the reception desk that needs it, and the desk deliberately does
 * not mount the admin shell's providers. The header named one specific
 * customer and pointed its logo at that customer's own website, so every other
 * company's reception screen greeted visitors with the wrong firm.
 */
export default function ReceptionShell({ children, branding = null }) {
  const queryClient = new QueryClient();
  const companyName = brandCompanyName(branding);
  const logo = branding?.logoUrl || "/images/Interiorlogo.svg";
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <div className="flex min-h-screen flex-col px-2 sm:py-0 py-2">
          <header className="sticky top-0 z-50 w-full border-b bg-white flex items-center justify-between">
            <div className="container flex h-16 items-center justify-center mx-auto">
              <div className="flex items-center justify-center gap-2">
                <Image
                  src={logo}
                  alt=""
                  width={80}
                  height={80}
                  className="h-8 w-auto"
                />
                <span className="bg-gradient-to-tr from-blue-900 to-red-600 text-transparent bg-clip-text font-bold text-xl sm:text-2xl hover:underline decoration-2 decoration-blue-500 hover:decoration-purple-600 transition-all duration-300 cursor-pointer text-pretty tracking-tight">
                  {companyName}
                </span>
              </div>
            </div>
            <ReceptionLogout />
          </header>
          <main className="flex-1">
            <div className="container py-10 mx-auto">{children}</div>
          </main>
        </div>
      </QueryClientProvider>
    </SessionProvider>
  );
}
