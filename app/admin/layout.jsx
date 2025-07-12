"use client";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import SidebarWrapper from "@/components/sidebar/sidebarWrapper";
import { NuqsAdapter } from "nuqs/adapters/next/app";

const queryClient = new QueryClient();
const layout = ({ children }) => {
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <SidebarWrapper>{children}</SidebarWrapper>
        </NuqsAdapter>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </SessionProvider>
  );
};

export default layout;
