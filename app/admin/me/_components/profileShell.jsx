import Link from "next/link";
import { redirect } from "next/navigation";
import { encrypt } from "@/lib/algo";
import { getEmployeeManageAccess } from "@/lib/employeeAccess";
import { getServerSideProps } from "@/server/session/session";
import EmployeeSidebar from "@/app/admin/officeEmployee/components/employeeSidebar";
import SelfProvider from "./selfProvider";
import { SELF_BASE_PATH, SELF_TABS } from "./selfMenu";

/**
 * The frame around /admin/me/profile, /admin/me/documents and
 * /admin/me/security.
 *
 * It resolves the viewer once, on the server, and hands the three tabs both the
 * record to show and what the viewer may do with it. The capability is derived
 * here rather than passed in, so a page cannot widen its own permissions by
 * rendering the shell differently.
 *
 * @param {object} props
 * @param {string} props.tab which tab is active, matching SELF_TABS[].link
 * @param {(ctx: { can: { manage: boolean } }) => React.ReactNode} props.render
 */
export default async function ProfileShell({ tab, render }) {
  const sessionData = await getServerSideProps();
  if (sessionData?.redirect?.destination) {
    redirect(sessionData.redirect.destination);
  }

  const employeeId = sessionData?.props?.session?.user?._id;
  if (!employeeId) redirect("/unauthorized");

  // A super admin or an HR user looking at their own profile is still the same
  // person looking at their own record, and nothing about this area should take
  // away what they can already do. So the capability follows the role, not the
  // URL: they get the same edit and upload controls here that they have on the
  // employee detail page, and an ordinary employee gets the read-only view.
  const { canManage } = await getEmployeeManageAccess();
  const can = { manage: canManage };

  return (
    <SelfProvider slug={[encrypt(employeeId)]}>
      <section className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-4">
        <nav className="border-b border-stone-200 mb-4">
          <ul className="flex gap-1 overflow-x-auto">
            {SELF_TABS.map((item) => {
              const isActive = item.link === tab;
              return (
                <li key={item.link}>
                  <Link
                    href={`${SELF_BASE_PATH}/${item.link}`}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm ${
                      isActive
                        ? "bg-indigo-100 text-indigo-600 font-medium"
                        : "text-neutral-700 hover:bg-stone-100"
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex sm:flex-row flex-col gap-6">
          {/* The identity card the old account page carried. Read-only, and the
              natural home for the profile photo when that lands. */}
          <div className="sm:w-1/3">
            <EmployeeSidebar />
          </div>
          <div className="sm:w-2/3 border border-dashed border-gray-300 rounded-xl p-4 max-h-max">
            {render({ can })}
          </div>
        </div>
      </section>
    </SelfProvider>
  );
}
