"use client";
import Image from "next/image";
import Link from "next/link";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import ReceptionLogout from "./logout";

export default function Layout({ children }) {
  const queryClient = new QueryClient();
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <div className="flex min-h-screen flex-col px-2 sm:py-0 py-2">
          <header className="sticky top-0 z-50 w-full border-b bg-white">
            <div className="container flex h-16 items-center justify-center mx-auto">
              <div className="flex items-center justify-center gap-2">
                <Image
                  src={"https://cdc.construction/images/CDC_LOGO.svg"}
                  alt="CDC HR"
                  width={80}
                  height={80}
                  className="h-8 w-auto"
                />
                <span className="bg-gradient-to-tr from-blue-900 to-red-600 text-transparent bg-clip-text font-bold text-xl sm:text-2xl hover:underline decoration-2 decoration-blue-500 hover:decoration-purple-600 transition-all duration-300 cursor-pointer text-pretty tracking-tight">
                  Creative Design & Construction Ltd.
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
