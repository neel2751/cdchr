import { auth } from "@/auth";
import { companyAccess, describeAccess } from "@/lib/tenantAccess";
import { getCompanyAccess } from "./tenantAccessState";

/**
 * The signed-in person's company access, for the layouts that gate on it.
 *
 * NOT "use server": layouts call it on the server. A browser has no need to
 * ask, and the banner it feeds is rendered before the page reaches one.
 */
export async function getMyCompanyAccess() {
  try {
    const session = await auth();
    const user = session?.user;
    // A support visit is read-only already, and is the platform admin looking
    // at a company — the company's own state is not theirs to be stopped by.
    if (!user?.tenantId || user?.impersonation) {
      return { access: companyAccess(null), role: user?.role || null };
    }
    return {
      access: await getCompanyAccess(user.tenantId),
      role: user.role,
    };
  } catch (error) {
    console.log("getMyCompanyAccess failed:", error?.message);
    return { access: companyAccess(null), role: null };
  }
}

/**
 * What the banner says to this person, or null for nothing.
 *
 * The owner hears about the trial from the first day, because they are the
 * one who has to act. Everybody else hears only once something has changed
 * for them — read-only — and is told who to ask, not to choose a plan.
 */
export function accessNotice(access, role) {
  if (!access) return null;
  const owner = role === "superAdmin";
  const show =
    access.level === "readOnly" ||
    access.level === "locked" ||
    (owner && (access.level === "grace" || access.reason === "trial"));
  if (!show) return null;
  const text = describeAccess(access, { owner });
  if (!text) return null;
  return {
    level: access.level,
    reason: access.reason,
    text,
    owner,
    // The trial countdown is information; everything after it needs action.
    // A demo company is read-only on purpose; nothing is wrong.
    tone:
      access.level === "full" || access.reason === "demo"
        ? "info"
        : access.level === "grace"
          ? "warning"
          : "danger",
  };
}
