import Employee from "./employee";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <Employee searchParams={param} />;
}
