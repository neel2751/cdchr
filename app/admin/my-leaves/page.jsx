import { getServerSideProps } from "@/server/session/session";
import { redirect } from "next/navigation";
import MyLeavesClient from "./my-leaves-client";

export default async function MyLeavesPage() {
  const sessionData = await getServerSideProps();

  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }

  const employeeId = sessionData?.props?.session?.user?._id;
  if (!employeeId) {
    redirect("/unauthorized");
  }

  return (
    <section className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-4">
      <MyLeavesClient />
    </section>
  );
}
