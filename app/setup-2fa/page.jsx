"use client";
import { SessionProvider } from "next-auth/react";
import ForcedTwoFactorSetup from "./forcedSetup";

export default function SetupTwoFactorPage() {
  return (
    <SessionProvider>
      <ForcedTwoFactorSetup />
    </SessionProvider>
  );
}
