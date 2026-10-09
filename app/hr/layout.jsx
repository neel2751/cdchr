import React from "react";
import { redirect } from "next/navigation";

import ReceptionShell from "./receptionShell";
import { hasPlanFeature } from "@/server/tenantServer/featureServer";
import { getBrandingForCurrentUser } from "@/server/tenantServer/tenantServer";

/**
 * The reception desk, closed when the company's plan excludes it.
 *
 * Same backstop as the employee portal: proxy.js gates `/hr` on the `reception`
 * flag, but only when the hostname resolves to the session's tenant. See
 * app/employee/layout.jsx.
 */
export const dynamic = "force-dynamic";

export default async function Layout({ children }) {
  if (!(await hasPlanFeature("reception"))) redirect("/unauthorized");

  // Fetched here because the shell is a client component: the desk shows the
  // company's own name and logo to whoever walks in.
  const branding = await getBrandingForCurrentUser();

  return <ReceptionShell branding={branding}>{children}</ReceptionShell>;
}
