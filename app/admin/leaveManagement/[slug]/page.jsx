import Gretting from "@/components/gretting/gretting";
import { leaveMenu, slugComponentmap } from "../../_components/menu";
import Navbar from "../components/nav";

export default async function Page({ params, searchParams }) {
  const slug = (await params).slug;
  const param = await searchParams;

  return (
    <Navbar
      slug={slug}
      searchParams={param}
      adminMenu={leaveMenu}
      slugComponentmap={slugComponentmap}
      basePath={"/admin/leaveManagement"}
    >
      <Gretting />
    </Navbar>
  );
}
