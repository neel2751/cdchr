import EmployeeAnnouncements from "./employeeAnnouncements";

// A static segment, so it takes precedence over app/employee/[slug], which
// redirects anything it does not recognise back to the portal home.
export default async function Page({ searchParams }) {
  const param = await searchParams;
  return <EmployeeAnnouncements searchParams={param} />;
}
