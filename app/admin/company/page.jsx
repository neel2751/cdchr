import Company from "./company";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <Company searchParams={param} />;
}
