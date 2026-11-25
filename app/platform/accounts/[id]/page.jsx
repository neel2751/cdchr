import { redirect } from "next/navigation";

import { getServerSideProps } from "@/server/session/session";
import AccountDetail from "./accountDetail";

export const metadata = { title: "Billing account" };

export default async function AccountPage({ params }) {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) redirect(sessionData.redirect.destination);
  if (sessionData?.props?.session?.user?.role !== "platformAdmin") redirect("/unauthorized");
  const { id } = await params;
  return <AccountDetail accountId={id} />;
}
