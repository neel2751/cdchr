import Permission from "./permission";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <Permission searchParams={param} />;
}
