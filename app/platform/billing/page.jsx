import { redirect } from "next/navigation";

import { getServerSideProps } from "@/server/session/session";
import BillingConsole from "./billingConsole";

export const metadata = { title: "Billing" };

/**
 * Invoicing and card payments, for platform staff.
 *
 * Separate from the provisioning station on purpose: making hardware and
 * billing for it are different jobs, usually done by different people, and
 * the one screen that can issue an invoice should not also be the one
 * somebody has open all day with a chip in their hand.
 */
export default async function BillingPage() {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }
  if (sessionData?.props?.session?.user?.role !== "platformAdmin") {
    redirect("/unauthorized");
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <BillingConsole />
    </main>
  );
}
