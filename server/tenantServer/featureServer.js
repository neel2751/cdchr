"use server";

import { getServerSideProps } from "../session/session";
import { getTenantFeatures } from "@/lib/tenantFeatures";
import { isFeatureEnabled } from "@/lib/tenantPlan";

/**
 * The signed-in company's module flags, for client components.
 *
 * The sidebar and the route guard both gate on the server, but plenty of
 * surfaces are rendered client-side and cannot — a dashboard card, the options
 * in the permissions picker. Those need to know which modules the company has,
 * and this is the only way to tell them.
 *
 * Safe to expose: it reveals nothing beyond what the caller's own sidebar
 * already shows them, and it is scoped to the caller's own tenant — the id
 * comes from the session, never from an argument. It is NOT an authorisation
 * check. A client that ignores the answer still meets the real gate in
 * proxy.js and, for the modules that have one, in the action itself.
 *
 * Unlike lib/tenantFeatures.js (deliberately not a "use server" module, because
 * exporting an authorisation primitive as an endpoint is a bad idea), this
 * returns display state and is meant to be called from the browser.
 */
export async function getPlanFeatures() {
  try {
    const { props } = await getServerSideProps();
    const tenantId = props?.session?.user?.tenantId;
    const features = tenantId ? await getTenantFeatures(tenantId) : {};
    // Stringified `data` is the shape every action here returns and the one
    // `unwrap()` in hooks/use-query.js parses.
    return { success: true, data: JSON.stringify(features) };
  } catch {
    // `{}` means "everything on", matching getTenantFeatures and
    // isFeatureEnabled. A lookup failure must not blank the dashboard of a
    // company that pays for the module.
    return { success: true, data: JSON.stringify({}) };
  }
}

/**
 * Whether one module is on for the signed-in company.
 *
 * For server components that need a single flag and would otherwise repeat the
 * session-then-features dance. Layouts use this to close the portals that
 * proxy.js cannot always reach — see app/employee/layout.jsx.
 */
export async function hasPlanFeature(key) {
  const { data } = await getPlanFeatures();
  try {
    return isFeatureEnabled(JSON.parse(data), key);
  } catch {
    return true; // fail open, as everything else on this path does
  }
}
