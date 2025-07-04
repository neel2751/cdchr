import SiteProject from "./siteProject";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <SiteProject searchParams={param} />;
}
