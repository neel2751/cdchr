import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ForcedPasswordChange from "./forcedChange";
import { passwordSecurityState } from "@/server/authServer/passwordSecurity";
import { homePathForRole } from "@/lib/roleHome";

/**
 * The forced password change, as its own page.
 *
 * Deliberately not a hop into /admin/account/<id>/password. That screen is the
 * account area — sidebar, tabs, personal details — and this is a gate standing
 * in front of the application: the person has just signed in with a password
 * their administrator chose and typed out to them, and nothing else should be
 * reachable, or even visible, until they replace it. Sending them into the full
 * account page both shows them the app they are not yet allowed to use and
 * buries the one thing they have to do among everything they do not.
 *
 * So: one card, two fields, no navigation away from it. The same shape as the
 * 2FA steps, which are the other two gates inside signing in.
 */
export const metadata = { title: "Set a new password" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth");

  // Read from the database, not the session. The cookie was minted before the
  // admin set the flag — and, after a successful change, still carries it — so
  // it is wrong in both directions. This is the same value the middleware gate
  // reads, which keeps the page and the gate from disagreeing.
  const state = await passwordSecurityState(session.user._id);
  if (state?.mustChangePassword !== true) {
    redirect(homePathForRole(session.user.role));
  }

  return (
    <ForcedPasswordChange
      name={session.user.name || session.user.email || ""}
      role={session.user.role}
    />
  );
}
