import RoleType from "./roleType";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <RoleType searchParams={param} />;
}
