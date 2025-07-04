"use client";
import { PasswordConfirmProvider } from "@/context/usePasswordContext";
import React from "react";
import { DeviceSubmissionsDashboard } from "./deviceSubmissionDashboard";

export default function page() {
  return (
    <PasswordConfirmProvider>
      <DeviceSubmissionsDashboard />
    </PasswordConfirmProvider>
  );
}
