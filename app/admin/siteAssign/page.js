import SiteAssign from "./siteAssign";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <SiteAssign searchParams={param} />;
}
