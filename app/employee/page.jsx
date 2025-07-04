"use client";
import React from "react";
import QRCodeSocket from "./generateCode";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();
export default function page() {
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <QRCodeSocket />
      </QueryClientProvider>
    </SessionProvider>
  );
}
