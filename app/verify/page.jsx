"use client";
import { SessionProvider } from "next-auth/react";
import VerifyTwoFactor from "./verify-2FA";

export default function page() {
  return (
    <SessionProvider>
      <VerifyTwoFactor />
    </SessionProvider>
  );
}
