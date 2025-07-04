"use client";
import React, { Suspense } from "react";
import { LoginUi } from "./loginUi";
import { SessionProvider } from "next-auth/react";

const page = () => {
  return (
    <SessionProvider>
      <Suspense fallback={<div>Loading...</div>}>
        <LoginUi />
      </Suspense>
    </SessionProvider>
  );
};

export default page;
