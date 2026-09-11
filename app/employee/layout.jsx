import React from "react";
import { redirect } from "next/navigation";

import EmployeeShell from "./employeeShell";
import { hasPlanFeature } from "@/server/tenantServer/featureServer";

/**
 * The site-employee portal, closed when the company's plan excludes it.
 *
 * proxy.js already gates `/employee` through the `siteEmployees` flag, but only
 * when the request arrives on a hostname that resolves to the same tenant as the
 * session — on a single-domain deployment that condition never holds and the
 * check falls through. This is the backstop that does not depend on the
 * hostname, and it is why the gate lives in the layout rather than each page:
 * every route under /employee passes through here.
 *
 * Authentication is still proxy.js's job. This only answers "does this company
 * have the module", and fails open if it cannot tell.
 */
export const dynamic = "force-dynamic";

export default async function Layout({ children }) {
  if (!(await hasPlanFeature("siteEmployees"))) redirect("/unauthorized");

  return <EmployeeShell>{children}</EmployeeShell>;
}
