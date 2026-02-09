import Gretting from "@/components/gretting/gretting";
import { reportMenu, reportSlugComponentmap } from "../../_components/menu";
import Navbar from "../../leaveManagement/components/nav";

export default async function Page({ params, searchParams }) {
  const slug = (await params).slug;
  const param = await searchParams;

  return (
    <Navbar
      slug={slug}
      searchParams={param}
      adminMenu={reportMenu}
      slugComponentmap={reportSlugComponentmap}
      basePath={"/admin/report"}
    >
      <Gretting />
    </Navbar>
  );
}
