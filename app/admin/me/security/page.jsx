import PasswordChange from "@/components/tabs/password-change";
import SessionManagement from "@/components/tabs/session-management";
import ProfileShell from "../_components/profileShell";

export const metadata = { title: "Security" };

/**
 * Password, two-factor and signed-in devices on one page.
 *
 * They were two separate tabs on the old account screen, which split one
 * question — "is my account safe, and who is in it?" — across two places.
 * PasswordChange already carries the two-factor card, so the whole answer fits
 * in a single scroll.
 */
export default function MySecurityPage() {
  return (
    <ProfileShell
      tab="security"
      render={() => (
        <div className="space-y-8">
          <PasswordChange />
          <SessionManagement />
        </div>
      )}
    />
  );
}
