import OfficeEmployeeAttendance from "@/components/tabs/employee-attendance";
import { AvatarProvider } from "@/components/Avatar/AvatarContext";
import { encrypt } from "@/lib/algo";
import { getServerSideProps } from "@/server/session/session";
import { redirect } from "next/navigation";

export default async function MyAttendancePage({ searchParams }) {
  const sessionData = await getServerSideProps();

  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }

  const employeeId = sessionData?.props?.session?.user?._id;
  if (!employeeId) {
    redirect("/unauthorized");
  }

  const encryptedEmployeeId = encrypt(employeeId);

  return (
    <section className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-4">
      <AvatarProvider
        slug={[encryptedEmployeeId]}
        searchParams={searchParams || {}}
      >
        <OfficeEmployeeAttendance />
      </AvatarProvider>
    </section>
  );
}
