import { redirect } from "next/navigation";

import { getServerSideProps } from "@/server/session/session";
import ProvisioningStation from "./provisioningStation";

export const metadata = { title: "Tag provisioning" };

/**
 * The provisioning station.
 *
 * Where an accepted order becomes working hardware: keys are issued one at a
 * time, chips are written, and every one is verified on the bench before it
 * goes in a box. Platform staff only — this is the one screen in the product
 * that ever displays a live key.
 */
export default async function TagProvisioningPage() {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }
  if (sessionData?.props?.session?.user?.role !== "platformAdmin") {
    redirect("/unauthorized");
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <ProvisioningStation />
    </main>
  );
}
