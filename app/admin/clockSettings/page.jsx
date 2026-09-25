import ClockSettingsClient from "./clockSettingsClient";

export const metadata = { title: "Clock In Settings" };

/**
 * Clocking in, set up in one place.
 *
 * Not gated here beyond the sidebar and proxy.js, which is the same treatment
 * the other admin screens get: each card's own server actions re-check the
 * role, and several of them are super admin only on their own account.
 */
export default function ClockSettingsPage() {
  return (
    <main className="w-full p-4 md:p-6">
      <ClockSettingsClient />
    </main>
  );
}
