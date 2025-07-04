import Navbar from "../../leaveManagement/components/nav";
import { siteMenu, siteSlugComponentmap } from "../../_components/menu";

export default async function IdPage({ params, searchParams }) {
  const search = await searchParams;
  const slug = (await params).id;
  const popSlug = slug.pop();
  const basePath = `/admin/siteAssign/${slug}`;

  return (
    <Navbar
      slug={popSlug}
      adminMenu={siteMenu}
      slugComponentmap={siteSlugComponentmap}
      basePath={basePath}
      searchParams={slug}
      filter={search}
    />
  );
}
