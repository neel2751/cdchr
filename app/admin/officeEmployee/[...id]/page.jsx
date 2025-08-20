import { AvatarProvider } from "@/components/Avatar/AvatarContext";
import Navbar from "../../leaveManagement/components/nav";
import { officeMenu, officeSlugComponentmap } from "../../_components/menu";
import EmployeeSidebar from "../components/employeeSidebar";

export default async function IdPage({ params, searchParams }) {
  const slug = (await params).id;
  const searchParam = await searchParams;
  const popSlug = slug.pop();
  const basePath = `/admin/officeEmployee/${slug}`;

  return (
    <AvatarProvider slug={slug} searchParams={searchParam}>
      <Navbar
        slug={popSlug}
        adminMenu={officeMenu}
        slugComponentmap={officeSlugComponentmap}
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
    </AvatarProvider>
  );
}
