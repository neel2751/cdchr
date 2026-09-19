import OfficeEmployeeAttendance from "@/components/tabs/employee-attendance";
import { encrypt } from "@/lib/algo";
import { getServerSideProps } from "@/server/session/session";
import { redirect } from "next/navigation";
import SelfProvider from "../_components/selfProvider";

export const metadata = { title: "My attendance" };

/**
 * Moved here from /admin/my-attendance, which still redirects.
 *
 * No tab bar: this is a sidebar destination, reached daily, and wrapping it in
 * the profile tabs would put a nav above it that leads away from the thing the
 * person came to look at.
 */
export default async function MyAttendancePage() {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }

  const employeeId = sessionData?.props?.session?.user?._id;
  if (!employeeId) redirect("/unauthorized");

  return (
    <section className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-4">
      <SelfProvider slug={[encrypt(employeeId)]}>
        <OfficeEmployeeAttendance />
      </SelfProvider>
    </section>
  );
}
