import Navbar from "../../leaveManagement/components/nav";
import { SiteEmployeeProvider } from "@/components/Avatar/AvatarContext";
import { siteOfficeEmployeSlugComponentmap } from "../../_components/siteEmployeeSlugMap";
import EmployeeSidebar from "../components/employeeSidebar";
import { siteEmployeeMenu } from "../../_components/siteMenu";
import BackButton from "@/components/backButton/backButton";

export default async function IdPage({ params, searchParams }) {
  const slug = (await params).id;
  const searchParam = await searchParams;
  const popSlug = slug.pop();
  const basePath = `/admin/employee/${slug}`;

  return (
    <SiteEmployeeProvider slug={slug} searchParams={searchParam}>
      <div className="px-4 pt-4">
        <BackButton
          fallbackHref="/admin/employee"
          label="Back to Employee List"
        />
      </div>
      <Navbar
        slug={popSlug}
        adminMenu={siteEmployeeMenu}
        slugComponentmap={siteOfficeEmployeSlugComponentmap}
        basePath={basePath}
        className={"flex sm:flex-row flex-col gap-6"}
        className2={
          "sm:w-2/3 border p-4 rounded-xl border-dashed border-gray-300 max-h-max"
        }
        searchParams={slug}
      >
        <div className="sm:w-1/3">
          <EmployeeSidebar />
        </div>
      </Navbar>
    </SiteEmployeeProvider>
  );
}
