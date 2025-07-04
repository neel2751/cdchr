import FilterAttendance from "./filterAttendance";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <FilterAttendance searchParams={param} />;
}
