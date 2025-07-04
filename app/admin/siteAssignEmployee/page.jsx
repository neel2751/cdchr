import AssignEmployee from "./assignEmployee";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <AssignEmployee searchParams={param} />;
}
