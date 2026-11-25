import { redirect } from "next/navigation";

import { getServerSideProps } from "@/server/session/session";
import AccountsList from "./accountsList";

export const metadata = { title: "Billing accounts" };

/** Customers and their companies on one bill (accountServer.js). */
export default async function AccountsPage() {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) redirect(sessionData.redirect.destination);
  if (sessionData?.props?.session?.user?.role !== "platformAdmin") redirect("/unauthorized");
  return <AccountsList />;
}
