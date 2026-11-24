import { redirect } from "next/navigation";

import { getServerSideProps } from "@/server/session/session";
import PricingConsole from "./pricingConsole";

export const metadata = { title: "Plans & pricing" };

/**
 * The packages we sell, the price list around them, trial offer codes, and a
 * calculator for quoting. Platform-level, like the tag catalogue.
 */
export default async function PricingPage() {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }
  if (sessionData?.props?.session?.user?.role !== "platformAdmin") {
    redirect("/unauthorized");
  }
  return <PricingConsole />;
}
