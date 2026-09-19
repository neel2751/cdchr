import { EmployeeLeaveDeatails } from "@/app/admin/officeEmployee/components/employeeOtherDeatils";
import { BankHoliday } from "@/app/admin/leaveManagement/components/bankHoliday";
import { encrypt } from "@/lib/algo";
import { getServerSideProps } from "@/server/session/session";
import { redirect } from "next/navigation";
import SelfProvider from "../_components/selfProvider";

export const metadata = { title: "My leave" };

/**
 * Moved here from /admin/my-leaves, which still redirects.
 *
 * That page provided an empty `searchParams`, which employeeLeaveDetailsNew()
 * feeds to extractData() for a super admin — so a super admin opening their own
 * leave got nothing back. Passing their own encrypted id, the same one the rest
 * of /admin/me uses, makes the page work for every role instead of all but one.
 */
export default async function MyLeavePage() {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }

  const employeeId = sessionData?.props?.session?.user?._id;
  if (!employeeId) redirect("/unauthorized");

  return (
    <section className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-4">
      <SelfProvider slug={[encrypt(employeeId)]}>
        <EmployeeLeaveDeatails />
        {/* Bank holidays used to be a tab on the account page, which filed a
            calendar everyone shares under one person's settings. They belong
            here: the question they answer — "is that day already off, or does
            booking it cost me a day?" — is a leave question, and this is the
            page where it gets asked. */}
        <div className="mt-8">
          <BankHoliday className="xl:grid-cols-2" />
        </div>
      </SelfProvider>
    </section>
  );
}
