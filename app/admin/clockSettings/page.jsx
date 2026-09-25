import { redirect } from "next/navigation";

import { getServerSideProps } from "@/server/session/session";
import ClockSettingsClient from "./clockSettingsClient";

export const metadata = { title: "Attendance Settings" };

/**
 * Clocking in, set up in one place. Super admin only.
 *
 * Checked here as well as in the sidebar and proxy.js, because a settings page
 * is exactly the kind of URL that gets shared in a message and opened by
 * somebody it was not meant for. Every action behind it refuses a non-super
 * admin on its own account too — this just means they are told once, plainly,
 * instead of finding out one save button at a time.
 */
export default async function ClockSettingsPage() {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }
  if (sessionData?.props?.session?.user?.role !== "superAdmin") {
    redirect("/unauthorized");
  }

  return (
    <main className="w-full p-4 md:p-6">
      <ClockSettingsClient />
    </main>
  );
}
