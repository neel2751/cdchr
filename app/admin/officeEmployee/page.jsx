import OfficeEmplyee from "./officeEmplyee";
export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <OfficeEmplyee searchParams={param} />;
}
