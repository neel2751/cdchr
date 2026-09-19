import EmployeeWeeklyRota from "@/components/tabs/weekly-rota";
import { encrypt } from "@/lib/algo";
import { getServerSideProps } from "@/server/session/session";
import { redirect } from "next/navigation";
import SelfProvider from "../_components/selfProvider";

export const metadata = { title: "My shifts" };

/** Moved here from /admin/my-weekly-shifts, which still redirects. */
export default async function MyShiftsPage() {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }

  const employeeId = sessionData?.props?.session?.user?._id;
  if (!employeeId) redirect("/unauthorized");

  return (
    <section className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-4">
      <SelfProvider slug={[encrypt(employeeId)]}>
        <EmployeeWeeklyRota />
      </SelfProvider>
    </section>
  );
}
