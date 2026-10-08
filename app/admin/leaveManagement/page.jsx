import { redirect } from "next/navigation";

import { getLeaveConfiguredState } from "@/server/leaveServer/leaveSetupServer";

// The landing decision depends on company state, so it cannot be cached.
export const dynamic = "force-dynamic";

/**
 * Where /admin/leaveManagement actually goes.
 *
 * A company that has not chosen its leave year lands on Setup rather than on a
 * dashboard of zeroes. That is not a nicety: until the leave year start month
 * has been decided and the leave types exist, nobody has an entitlement, and the
 * overview shows a working screen full of nothing with no indication of why.
 *
 * This was `permanentRedirect` to /overview. Permanent is a 308, which browsers
 * and proxies cache indefinitely — so the very first visit, made before leave was
 * set up, would pin every later visit to /overview no matter what. `redirect` is
 * a 307, which does not stick.
 *
 * Fails to /overview: a company whose setup state could not be read is far more
 * likely to be an established one than a brand new one, and sending an
 * established company to a setup wizard is the worse mistake.
 */
export default async function LeaveLandingPage() {
  let configured = true;

  try {
    const response = await getLeaveConfiguredState();
    if (response?.success && response.data) {
      configured = JSON.parse(response.data).configured !== false;
    }
  } catch {
    // Keep the established-company default.
  }

  redirect(`/admin/leaveManagement/${configured ? "overview" : "setup"}`);
}
